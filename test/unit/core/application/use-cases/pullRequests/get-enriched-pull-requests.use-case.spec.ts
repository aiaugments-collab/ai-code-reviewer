import { Test, TestingModule } from '@nestjs/testing';
import { GetEnrichedPullRequestsUseCase } from '@/core/application/use-cases/pullRequests/get-enriched-pull-requests.use-case';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { 
    AUTOMATION_EXECUTION_SERVICE_TOKEN,
    IAutomationExecutionService 
} from '@/core/domain/automation/contracts/automation-execution.service';
import { 
    PULL_REQUESTS_SERVICE_TOKEN,
    IPullRequestsService 
} from '@/core/domain/pullRequests/contracts/pullRequests.service.contracts';
import { 
    CODE_REVIEW_EXECUTION_SERVICE,
    ICodeReviewExecutionService 
} from '@/core/domain/codeReviewExecutions/contracts/codeReviewExecution.service.contract';
import { AutomationExecutionEntity } from '@/core/domain/automation/entities/automation-execution.entity';
import { PullRequestsEntity } from '@/core/domain/pullRequests/entities/pullRequests.entity';
import { CodeReviewExecutionEntity } from '@/core/domain/codeReviewExecutions/entities/codeReviewExecution.entity';
import { AutomationStatus } from '@/core/domain/automation/enums/automation-status';

describe('GetEnrichedPullRequestsUseCase', () => {
    let useCase: GetEnrichedPullRequestsUseCase;
    let mockAutomationExecutionService: jest.Mocked<IAutomationExecutionService>;
    let mockPullRequestsService: jest.Mocked<IPullRequestsService>;
    let mockCodeReviewExecutionService: jest.Mocked<ICodeReviewExecutionService>;
    let mockLogger: jest.Mocked<PinoLoggerService>;

    const mockRequest = {
        user: {
            organization: {
                uuid: 'test-org-id',
            },
        },
    };

    beforeEach(async () => {
        const mockAutomationExecutionServiceValue = {
            find: jest.fn(),
        };

        const mockPullRequestsServiceValue = {
            findByNumberAndRepositoryId: jest.fn(),
        };

        const mockCodeReviewExecutionServiceValue = {
            find: jest.fn(),
        };

        const mockLoggerValue = {
            warn: jest.fn(),
            log: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GetEnrichedPullRequestsUseCase,
                {
                    provide: AUTOMATION_EXECUTION_SERVICE_TOKEN,
                    useValue: mockAutomationExecutionServiceValue,
                },
                {
                    provide: PULL_REQUESTS_SERVICE_TOKEN,
                    useValue: mockPullRequestsServiceValue,
                },
                {
                    provide: CODE_REVIEW_EXECUTION_SERVICE,
                    useValue: mockCodeReviewExecutionServiceValue,
                },
                {
                    provide: PinoLoggerService,
                    useValue: mockLoggerValue,
                },
                {
                    provide: 'REQUEST',
                    useValue: mockRequest,
                },
            ],
        }).compile();

        useCase = module.get<GetEnrichedPullRequestsUseCase>(GetEnrichedPullRequestsUseCase);
        mockAutomationExecutionService = module.get(AUTOMATION_EXECUTION_SERVICE_TOKEN);
        mockPullRequestsService = module.get(PULL_REQUESTS_SERVICE_TOKEN);
        mockCodeReviewExecutionService = module.get(CODE_REVIEW_EXECUTION_SERVICE);
        mockLogger = module.get(PinoLoggerService);
    });

    describe('execute', () => {
        it('should only return pull requests with code review history', async () => {
            // Arrange
            const query = {
                repositoryId: 'test-repo-id',
                repositoryName: 'test-repo',
                limit: 10,
                page: 1,
            };

            const mockAutomationExecutions = [
                new AutomationExecutionEntity({
                    uuid: 'execution-1',
                    pullRequestNumber: 123,
                    repositoryId: 'test-repo-id',
                    status: AutomationStatus.SUCCESS,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    origin: 'test',
                }),
                new AutomationExecutionEntity({
                    uuid: 'execution-2',
                    pullRequestNumber: 456,
                    repositoryId: 'test-repo-id',
                    status: AutomationStatus.SUCCESS,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    origin: 'test',
                }),
            ];

            const mockPullRequest = new PullRequestsEntity({
                uuid: 'pr-uuid',
                number: 123,
                title: 'Test PR',
                status: 'OPENED',
                merged: false,
                url: 'https://github.com/test/repo/pull/123',
                baseBranchRef: 'main',
                headBranchRef: 'feature-branch',
                repository: {
                    id: 'test-repo-id',
                    name: 'test-repo',
                    fullName: 'test/test-repo',
                    language: 'typescript',
                    url: 'https://github.com/test/repo',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
                openedAt: new Date().toISOString(),
                closedAt: null,
                files: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                totalAdded: 0,
                totalDeleted: 0,
                totalChanges: 0,
                provider: 'GITHUB',
                user: {
                    id: 'user-id',
                    username: 'testuser',
                    name: 'Test User',
                    email: 'test@example.com',
                },
                reviewers: [],
                assignees: [],
                organizationId: 'test-org-id',
                commits: [],
                syncedEmbeddedSuggestions: false,
                syncedWithIssues: false,
                prLevelSuggestions: [],
                isDraft: false,
            });

            const mockCodeReviewExecutions = [
                new CodeReviewExecutionEntity({
                    uuid: 'cre-uuid-1',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    automationExecution: { uuid: 'execution-1' },
                    status: AutomationStatus.SUCCESS,
                    message: 'Code review completed',
                }),
            ];

            mockAutomationExecutionService.find.mockResolvedValue(mockAutomationExecutions);
            mockPullRequestsService.findByNumberAndRepositoryId.mockResolvedValue(mockPullRequest);
            
            // Mock code review executions for execution-1 (has history)
            mockCodeReviewExecutionService.find
                .mockResolvedValueOnce(mockCodeReviewExecutions) // For execution-1
                .mockResolvedValueOnce([]); // For execution-2 (no history)

            // Act
            const result = await useCase.execute(query);

            // Assert
            expect(result.data).toHaveLength(1); // Only PR with code review history should be returned
            expect(result.data[0].prNumber).toBe(123);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Skipping PR without code review history',
                    metadata: expect.objectContaining({
                        prNumber: 456,
                        repositoryId: 'test-repo-id',
                        executionUuid: 'execution-2',
                    }),
                })
            );
        });

        it('should return empty array when no automation executions exist', async () => {
            // Arrange
            const query = {
                repositoryId: 'test-repo-id',
                repositoryName: 'test-repo',
                limit: 10,
                page: 1,
            };

            mockAutomationExecutionService.find.mockResolvedValue([]);

            // Act
            const result = await useCase.execute(query);

            // Assert
            expect(result.data).toHaveLength(0);
            expect(result.pagination.totalItems).toBe(0);
        });

        it('should return empty array when no automation executions have PR data', async () => {
            // Arrange
            const query = {
                repositoryId: 'test-repo-id',
                repositoryName: 'test-repo',
                limit: 10,
                page: 1,
            };

            const mockAutomationExecutions = [
                new AutomationExecutionEntity({
                    uuid: 'execution-1',
                    pullRequestNumber: null, // No PR number
                    repositoryId: null, // No repository ID
                    status: AutomationStatus.SUCCESS,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    origin: 'test',
                }),
            ];

            mockAutomationExecutionService.find.mockResolvedValue(mockAutomationExecutions);

            // Act
            const result = await useCase.execute(query);

            // Assert
            expect(result.data).toHaveLength(0);
            expect(result.pagination.totalItems).toBe(0);
        });

        it('should filter automation executions by organization ID', async () => {
            // Arrange
            const query = {
                repositoryId: 'test-repo-id',
                repositoryName: 'test-repo',
                limit: 10,
                page: 1,
            };

            const expectedFilter = {
                teamAutomation: {
                    team: {
                        organization: {
                            uuid: 'test-org-id',
                        },
                    },
                },
            };

            mockAutomationExecutionService.find.mockResolvedValue([]);

            // Act
            await useCase.execute(query);

            // Assert
            expect(mockAutomationExecutionService.find).toHaveBeenCalledWith(expectedFilter);
        });

        it('should throw error when no organization found in request', async () => {
            // Arrange
            const query = {
                repositoryId: 'test-repo-id',
                repositoryName: 'test-repo',
                limit: 10,
                page: 1,
            };

            // Mock request without organization
            const useCaseWithoutOrg = new GetEnrichedPullRequestsUseCase(
                mockLogger,
                mockAutomationExecutionService,
                mockPullRequestsService,
                mockCodeReviewExecutionService,
                { user: {} } as any, // Request without organization
            );

            // Act & Assert
            await expect(useCaseWithoutOrg.execute(query)).rejects.toThrow('No organization found in request');
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'No organization found in request',
                })
            );
        });

        it('should pass organization ID to pullRequestsService.findByNumberAndRepositoryId', async () => {
            // Arrange
            const query = {
                repositoryId: 'test-repo-id',
                repositoryName: 'test-repo',
                limit: 10,
                page: 1,
            };

            const mockAutomationExecutions = [
                new AutomationExecutionEntity({
                    uuid: 'execution-1',
                    pullRequestNumber: 123,
                    repositoryId: 'test-repo-id',
                    status: AutomationStatus.SUCCESS,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    origin: 'test',
                }),
            ];

            const mockPullRequest = new PullRequestsEntity({
                uuid: 'pr-uuid',
                number: 123,
                title: 'Test PR',
                status: 'OPENED',
                merged: false,
                url: 'https://github.com/test/repo/pull/123',
                baseBranchRef: 'main',
                headBranchRef: 'feature-branch',
                repository: {
                    id: 'test-repo-id',
                    name: 'test-repo',
                    fullName: 'test/test-repo',
                    language: 'typescript',
                    url: 'https://github.com/test/repo',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
                openedAt: new Date().toISOString(),
                closedAt: null,
                files: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                totalAdded: 0,
                totalDeleted: 0,
                totalChanges: 0,
                provider: 'GITHUB',
                user: {
                    id: 'user-id',
                    username: 'testuser',
                    name: 'Test User',
                    email: 'test@example.com',
                },
                reviewers: [],
                assignees: [],
                organizationId: 'test-org-id',
                commits: [],
                syncedEmbeddedSuggestions: false,
                syncedWithIssues: false,
                prLevelSuggestions: [],
                isDraft: false,
            });

            const mockCodeReviewExecutions = [
                new CodeReviewExecutionEntity({
                    uuid: 'cre-uuid-1',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    automationExecution: { uuid: 'execution-1' },
                    status: AutomationStatus.SUCCESS,
                    message: 'Code review completed',
                }),
            ];

            mockAutomationExecutionService.find.mockResolvedValue(mockAutomationExecutions);
            mockPullRequestsService.findByNumberAndRepositoryId.mockResolvedValue(mockPullRequest);
            mockCodeReviewExecutionService.find.mockResolvedValue(mockCodeReviewExecutions);

            // Act
            await useCase.execute(query);

            // Assert
            expect(mockPullRequestsService.findByNumberAndRepositoryId).toHaveBeenCalledWith(
                123,
                'test-repo-id',
                { organizationId: 'test-org-id' }
            );
        });
    });
});