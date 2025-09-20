import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from '@nestjs/cache-manager';
import { PullRequestController } from '@/core/infrastructure/http/controllers/pullRequest.controller';
import { GetPullRequestAuthorsUseCase } from '@/core/application/use-cases/pullRequests/get-pull-request-authors-orderedby-contributions.use-case';
import { UpdatePullRequestToNewFormatUseCase } from '@/core/application/use-cases/pullRequests/update-pull-request-to-new-format.use-case';
import { GetEnrichedPullRequestsUseCase } from '@/core/application/use-cases/pullRequests/get-enriched-pull-requests.use-case';
import { EnrichedPullRequestsQueryDto } from '@/core/infrastructure/http/dtos/enriched-pull-requests-query.dto';
import { PaginatedEnrichedPullRequestsResponse } from '@/core/infrastructure/http/dtos/paginated-enriched-pull-requests.dto';

describe('PullRequestController', () => {
    let controller: PullRequestController;
    let mockGetPullRequestAuthorsUseCase: jest.Mocked<GetPullRequestAuthorsUseCase>;
    let mockUpdatePullRequestToNewFormatUseCase: jest.Mocked<UpdatePullRequestToNewFormatUseCase>;
    let mockGetEnrichedPullRequestsUseCase: jest.Mocked<GetEnrichedPullRequestsUseCase>;

    beforeEach(async () => {
        const mockGetPullRequestAuthorsUseCaseValue = {
            execute: jest.fn(),
        };

        const mockUpdatePullRequestToNewFormatUseCaseValue = {
            execute: jest.fn(),
        };

        const mockGetEnrichedPullRequestsUseCaseValue = {
            execute: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            imports: [
                CacheModule.register({
                    ttl: 5000,
                    max: 100,
                }),
            ],
            controllers: [PullRequestController],
            providers: [
                {
                    provide: GetPullRequestAuthorsUseCase,
                    useValue: mockGetPullRequestAuthorsUseCaseValue,
                },
                {
                    provide: UpdatePullRequestToNewFormatUseCase,
                    useValue: mockUpdatePullRequestToNewFormatUseCaseValue,
                },
                {
                    provide: GetEnrichedPullRequestsUseCase,
                    useValue: mockGetEnrichedPullRequestsUseCaseValue,
                },
            ],
        }).compile();

        controller = module.get<PullRequestController>(PullRequestController);
        mockGetPullRequestAuthorsUseCase = module.get(GetPullRequestAuthorsUseCase);
        mockUpdatePullRequestToNewFormatUseCase = module.get(UpdatePullRequestToNewFormatUseCase);
        mockGetEnrichedPullRequestsUseCase = module.get(GetEnrichedPullRequestsUseCase);
    });

    describe('getPullRequestExecutions', () => {
        it('should call GetEnrichedPullRequestsUseCase with correct parameters', async () => {
            // Arrange
            const query: EnrichedPullRequestsQueryDto = {
                repositoryId: 'test-repo-id',
                repositoryName: 'test-repo',
                limit: 20,
                page: 2,
            };

            const expectedResponse: PaginatedEnrichedPullRequestsResponse = {
                data: [
                    {
                        prId: 'pr-1',
                        prNumber: 123,
                        title: 'Test PR',
                        status: 'OPENED',
                        merged: false,
                        url: 'https://github.com/test/repo/pull/123',
                        baseBranchRef: 'main',
                        headBranchRef: 'feature',
                        repositoryName: 'test-repo',
                        repositoryId: 'test-repo-id',
                        openedAt: '2024-01-01T00:00:00Z',
                        closedAt: null,
                        createdAt: '2024-01-01T00:00:00Z',
                        updatedAt: '2024-01-01T00:00:00Z',
                        provider: 'GITHUB',
                        author: {
                            id: 'user-1',
                            username: 'testuser',
                            name: 'Test User',
                        },
                        isDraft: false,
                        automationExecution: {
                            uuid: 'execution-1',
                            status: 'SUCCESS' as any,
                            errorMessage: null,
                            createdAt: '2024-01-01T00:00:00Z',
                            updatedAt: '2024-01-01T00:00:00Z',
                            origin: 'webhook',
                        },
                        codeReviewTimeline: [
                            {
                                uuid: 'cre-1',
                                createdAt: '2024-01-01T00:00:00Z',
                                updatedAt: '2024-01-01T00:00:00Z',
                                status: 'SUCCESS' as any,
                                message: 'Code review completed',
                            },
                        ],
                        enrichedData: undefined,
                    },
                ],
                pagination: {
                    currentPage: 2,
                    totalPages: 5,
                    totalItems: 100,
                    itemsPerPage: 20,
                    hasNextPage: true,
                    hasPreviousPage: true,
                },
            };

            mockGetEnrichedPullRequestsUseCase.execute.mockResolvedValue(expectedResponse);

            // Act
            const result = await controller.getPullRequestExecutions(query);

            // Assert
            expect(mockGetEnrichedPullRequestsUseCase.execute).toHaveBeenCalledWith(query);
            expect(result).toEqual(expectedResponse);
        });

        it('should handle query without optional parameters', async () => {
            // Arrange
            const query: EnrichedPullRequestsQueryDto = {};

            const expectedResponse: PaginatedEnrichedPullRequestsResponse = {
                data: [],
                pagination: {
                    currentPage: 1,
                    totalPages: 0,
                    totalItems: 0,
                    itemsPerPage: 30,
                    hasNextPage: false,
                    hasPreviousPage: false,
                },
            };

            mockGetEnrichedPullRequestsUseCase.execute.mockResolvedValue(expectedResponse);

            // Act
            const result = await controller.getPullRequestExecutions(query);

            // Assert
            expect(mockGetEnrichedPullRequestsUseCase.execute).toHaveBeenCalledWith(query);
            expect(result).toEqual(expectedResponse);
        });

        it('should propagate errors from use case', async () => {
            // Arrange
            const query: EnrichedPullRequestsQueryDto = {
                repositoryId: 'test-repo-id',
            };

            const error = new Error('No organization found in request');
            mockGetEnrichedPullRequestsUseCase.execute.mockRejectedValue(error);

            // Act & Assert
            await expect(controller.getPullRequestExecutions(query)).rejects.toThrow('No organization found in request');
        });

        it('should handle repository filtering', async () => {
            // Arrange
            const query: EnrichedPullRequestsQueryDto = {
                repositoryId: 'specific-repo-id',
                repositoryName: 'specific-repo',
                limit: 10,
                page: 1,
            };

            const expectedResponse: PaginatedEnrichedPullRequestsResponse = {
                data: [
                    {
                        prId: 'pr-1',
                        prNumber: 123,
                        title: 'Filtered PR',
                        status: 'OPENED',
                        merged: false,
                        url: 'https://github.com/test/specific-repo/pull/123',
                        baseBranchRef: 'main',
                        headBranchRef: 'feature',
                        repositoryName: 'specific-repo',
                        repositoryId: 'specific-repo-id',
                        openedAt: '2024-01-01T00:00:00Z',
                        closedAt: null,
                        createdAt: '2024-01-01T00:00:00Z',
                        updatedAt: '2024-01-01T00:00:00Z',
                        provider: 'GITHUB',
                        author: {
                            id: 'user-1',
                            username: 'testuser',
                            name: 'Test User',
                        },
                        isDraft: false,
                        automationExecution: {
                            uuid: 'execution-1',
                            status: 'SUCCESS' as any,
                            errorMessage: null,
                            createdAt: '2024-01-01T00:00:00Z',
                            updatedAt: '2024-01-01T00:00:00Z',
                            origin: 'webhook',
                        },
                        codeReviewTimeline: [
                            {
                                uuid: 'cre-1',
                                createdAt: '2024-01-01T00:00:00Z',
                                updatedAt: '2024-01-01T00:00:00Z',
                                status: 'SUCCESS' as any,
                                message: 'Code review completed',
                            },
                        ],
                        enrichedData: undefined,
                    },
                ],
                pagination: {
                    currentPage: 1,
                    totalPages: 1,
                    totalItems: 1,
                    itemsPerPage: 10,
                    hasNextPage: false,
                    hasPreviousPage: false,
                },
            };

            mockGetEnrichedPullRequestsUseCase.execute.mockResolvedValue(expectedResponse);

            // Act
            const result = await controller.getPullRequestExecutions(query);

            // Assert
            expect(mockGetEnrichedPullRequestsUseCase.execute).toHaveBeenCalledWith(query);
            expect(result.data).toHaveLength(1);
            expect(result.data[0].repositoryId).toBe('specific-repo-id');
            expect(result.data[0].repositoryName).toBe('specific-repo');
        });
    });

    describe('Cache Configuration', () => {
        it('should have cache interceptor and TTL configured', () => {
            // This test verifies that the endpoint has the correct decorators
            // The actual cache behavior would be tested in e2e tests
            const metadata = Reflect.getMetadata('__interceptors__', controller.getPullRequestExecutions);
            const ttlMetadata = Reflect.getMetadata('cache_ttl', controller.getPullRequestExecutions);
            
            // These checks verify that the decorators are properly applied
            expect(metadata).toBeDefined();
            expect(ttlMetadata).toBe(300000); // 5 minutes
        });
    });
});
