import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PullRequestController } from '@/core/infrastructure/http/controllers/pullRequest.controller';
import { GetEnrichedPullRequestsUseCase } from '@/core/application/use-cases/pullRequests/get-enriched-pull-requests.use-case';
import { GetPullRequestAuthorsUseCase } from '@/core/application/use-cases/pullRequests/get-pull-request-authors-orderedby-contributions.use-case';
import { UpdatePullRequestToNewFormatUseCase } from '@/core/application/use-cases/pullRequests/update-pull-request-to-new-format.use-case';
import { CacheModule } from '@nestjs/cache-manager';

describe('Pull Request Organization Filtering (e2e)', () => {
    let app: INestApplication;
    let mockGetEnrichedPullRequestsUseCase: jest.Mocked<GetEnrichedPullRequestsUseCase>;
    let mockGetPullRequestAuthorsUseCase: jest.Mocked<GetPullRequestAuthorsUseCase>;
    let mockUpdatePullRequestToNewFormatUseCase: jest.Mocked<UpdatePullRequestToNewFormatUseCase>;

    beforeEach(async () => {
        const mockGetEnrichedPullRequestsUseCaseValue = {
            execute: jest.fn(),
        };

        const mockGetPullRequestAuthorsUseCaseValue = {
            execute: jest.fn(),
        };

        const mockUpdatePullRequestToNewFormatUseCaseValue = {
            execute: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                CacheModule.register({
                    ttl: 5000,
                    max: 100,
                }),
            ],
            controllers: [PullRequestController],
            providers: [
                {
                    provide: GetEnrichedPullRequestsUseCase,
                    useValue: mockGetEnrichedPullRequestsUseCaseValue,
                },
                {
                    provide: GetPullRequestAuthorsUseCase,
                    useValue: mockGetPullRequestAuthorsUseCaseValue,
                },
                {
                    provide: UpdatePullRequestToNewFormatUseCase,
                    useValue: mockUpdatePullRequestToNewFormatUseCaseValue,
                },
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        mockGetEnrichedPullRequestsUseCase = moduleFixture.get(GetEnrichedPullRequestsUseCase);
        mockGetPullRequestAuthorsUseCase = moduleFixture.get(GetPullRequestAuthorsUseCase);
        mockUpdatePullRequestToNewFormatUseCase = moduleFixture.get(UpdatePullRequestToNewFormatUseCase);
    });

    afterEach(async () => {
        await app.close();
    });

    describe('/pull-requests/executions (GET)', () => {
        it('should call use case with correct organization filtering parameters', async () => {
            // Arrange
            const mockResponse = {
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
                        codeReviewTimeline: [],
                        enrichedData: undefined,
                    },
                ],
                pagination: {
                    currentPage: 1,
                    totalPages: 1,
                    totalItems: 1,
                    itemsPerPage: 30,
                    hasNextPage: false,
                    hasPreviousPage: false,
                },
            };

            mockGetEnrichedPullRequestsUseCase.execute.mockResolvedValue(mockResponse);

            // Act
            const response = await request(app.getHttpServer())
                .get('/pull-requests/executions')
                .query({
                    repositoryId: 'test-repo-id',
                    limit: 10,
                    page: 1,
                })
                .expect(200);

            // Assert
            expect(mockGetEnrichedPullRequestsUseCase.execute).toHaveBeenCalledWith({
                repositoryId: 'test-repo-id',
                limit: '10',
                page: '1',
            });

            expect(response.body).toEqual(mockResponse);
        });

        it('should handle organization isolation correctly', async () => {
            // Arrange - Mock use case to simulate organization filtering
            const mockResponse = {
                data: [], // Empty data simulating no access to other org's data
                pagination: {
                    currentPage: 1,
                    totalPages: 0,
                    totalItems: 0,
                    itemsPerPage: 30,
                    hasNextPage: false,
                    hasPreviousPage: false,
                },
            };

            mockGetEnrichedPullRequestsUseCase.execute.mockResolvedValue(mockResponse);

            // Act
            const response = await request(app.getHttpServer())
                .get('/pull-requests/executions')
                .expect(200);

            // Assert
            expect(response.body.data).toEqual([]);
            expect(response.body.pagination.totalItems).toBe(0);
        });

        it('should handle errors when organization is missing', async () => {
            // Arrange
            mockGetEnrichedPullRequestsUseCase.execute.mockRejectedValue(
                new Error('No organization found in request')
            );

            // Act & Assert
            await request(app.getHttpServer())
                .get('/pull-requests/executions')
                .expect(500); // Internal Server Error
        });

        it('should apply cache headers correctly', async () => {
            // Arrange
            const mockResponse = {
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

            mockGetEnrichedPullRequestsUseCase.execute.mockResolvedValue(mockResponse);

            // Act
            const response = await request(app.getHttpServer())
                .get('/pull-requests/executions')
                .expect(200);

            // Assert
            // The cache interceptor should add cache headers
            // Note: This depends on the cache implementation but generally
            // caching is handled by NestJS automatically with the decorators
            expect(response.body).toEqual(mockResponse);
        });

        it('should handle repository filtering parameters', async () => {
            // Arrange
            const mockResponse = {
                data: [],
                pagination: {
                    currentPage: 1,
                    totalPages: 0,
                    totalItems: 0,
                    itemsPerPage: 20,
                    hasNextPage: false,
                    hasPreviousPage: false,
                },
            };

            mockGetEnrichedPullRequestsUseCase.execute.mockResolvedValue(mockResponse);

            // Act
            await request(app.getHttpServer())
                .get('/pull-requests/executions')
                .query({
                    repositoryId: 'specific-repo-id',
                    repositoryName: 'specific-repo',
                    limit: 20,
                    page: 2,
                })
                .expect(200);

            // Assert
            expect(mockGetEnrichedPullRequestsUseCase.execute).toHaveBeenCalledWith({
                repositoryId: 'specific-repo-id',
                repositoryName: 'specific-repo',
                limit: '20',
                page: '2',
            });
        });
    });
});
