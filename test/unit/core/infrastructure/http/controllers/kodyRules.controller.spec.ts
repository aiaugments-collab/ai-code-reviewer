import { Test } from '@nestjs/testing';
import { KodyRulesController } from '@/core/infrastructure/http/controllers/kodyRules.controller';
import { CreateOrUpdateKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/create-or-update.use-case';
import { FindByOrganizationIdKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/find-by-organization-id.use-case';
import { FindRuleInOrganizationByIdKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/find-rule-in-organization-by-id.use-case';
import { FindRulesInOrganizationByRuleFilterKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/find-rules-in-organization-by-filter.use-case';
import { DeleteByOrganizationIdKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/delete-by-organization-id.use-case';
import { DeleteRuleInOrganizationByIdKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/delete-rule-in-organization-by-id.use-case';
import { FindLibraryKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/find-library-kody-rules.use-case';
import { AddLibraryKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/add-library-kody-rules.use-case';
import { GenerateKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/generate-kody-rules.use-case';
import { ChangeStatusKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/change-status-kody-rules.use-case';
import { CheckSyncStatusUseCase } from '@/core/application/use-cases/kodyRules/check-sync-status.use-case';
import { CacheService } from '@/shared/utils/cache/cache.service';
import { REQUEST } from '@nestjs/core';

describe('KodyRulesController', () => {
    let controller: KodyRulesController;
    let mockCreateOrUpdateUseCase: any;
    let mockFindByOrganizationIdUseCase: any;
    let mockFindRuleInOrganizationByIdUseCase: any;
    let mockFindRulesInOrganizationByRuleFilterUseCase: any;
    let mockDeleteByOrganizationIdUseCase: any;
    let mockDeleteRuleInOrganizationByIdUseCase: any;
    let mockFindLibraryUseCase: any;
    let mockAddLibraryUseCase: any;
    let mockGenerateUseCase: any;
    let mockChangeStatusUseCase: any;
    let mockCheckSyncStatusUseCase: any;
    let mockCacheService: any;
    let mockRequest: any;

    const mockSyncStatusResult = {
        ideRulesSyncEnabledFirstTime: true,
        kodyRulesGeneratorEnabledFirstTime: false,
    };

    beforeEach(async () => {
        mockCreateOrUpdateUseCase = {
            execute: jest.fn(),
        };

        mockFindByOrganizationIdUseCase = {
            execute: jest.fn(),
        };

        mockFindRuleInOrganizationByIdUseCase = {
            execute: jest.fn(),
        };

        mockFindRulesInOrganizationByRuleFilterUseCase = {
            execute: jest.fn(),
        };

        mockDeleteByOrganizationIdUseCase = {
            execute: jest.fn(),
        };

        mockDeleteRuleInOrganizationByIdUseCase = {
            execute: jest.fn(),
        };

        mockFindLibraryUseCase = {
            execute: jest.fn(),
        };

        mockAddLibraryUseCase = {
            execute: jest.fn(),
        };

        mockGenerateUseCase = {
            execute: jest.fn(),
        };

        mockChangeStatusUseCase = {
            execute: jest.fn(),
        };

        mockCheckSyncStatusUseCase = {
            execute: jest.fn(),
        };

        mockCacheService = {
            getFromCache: jest.fn(),
            addToCache: jest.fn(),
        };

        mockRequest = {
            user: {
                organization: {
                    uuid: 'org-123',
                },
            },
        };

        const module = await Test.createTestingModule({
            controllers: [KodyRulesController],
            providers: [
                {
                    provide: CreateOrUpdateKodyRulesUseCase,
                    useValue: mockCreateOrUpdateUseCase,
                },
                {
                    provide: FindByOrganizationIdKodyRulesUseCase,
                    useValue: mockFindByOrganizationIdUseCase,
                },
                {
                    provide: FindRuleInOrganizationByIdKodyRulesUseCase,
                    useValue: mockFindRuleInOrganizationByIdUseCase,
                },
                {
                    provide: FindRulesInOrganizationByRuleFilterKodyRulesUseCase,
                    useValue: mockFindRulesInOrganizationByRuleFilterUseCase,
                },
                {
                    provide: DeleteByOrganizationIdKodyRulesUseCase,
                    useValue: mockDeleteByOrganizationIdUseCase,
                },
                {
                    provide: DeleteRuleInOrganizationByIdKodyRulesUseCase,
                    useValue: mockDeleteRuleInOrganizationByIdUseCase,
                },
                {
                    provide: FindLibraryKodyRulesUseCase,
                    useValue: mockFindLibraryUseCase,
                },
                {
                    provide: AddLibraryKodyRulesUseCase,
                    useValue: mockAddLibraryUseCase,
                },
                {
                    provide: GenerateKodyRulesUseCase,
                    useValue: mockGenerateUseCase,
                },
                {
                    provide: ChangeStatusKodyRulesUseCase,
                    useValue: mockChangeStatusUseCase,
                },
                {
                    provide: CheckSyncStatusUseCase,
                    useValue: mockCheckSyncStatusUseCase,
                },
                {
                    provide: CacheService,
                    useValue: mockCacheService,
                },
                {
                    provide: REQUEST,
                    useValue: mockRequest,
                },
            ],
        }).compile();

        controller = module.get<KodyRulesController>(KodyRulesController);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('checkSyncStatus', () => {
        it('deve retornar resultado do cache quando disponível', async () => {
            const teamId = 'team-456';
            const repositoryId = 'repo-789';
            const expectedCacheKey = 'check-sync-status:org-123:team-456:repo-789';

            mockCacheService.getFromCache.mockResolvedValue(mockSyncStatusResult);

            const result = await controller.checkSyncStatus(teamId, repositoryId);

            expect(result).toEqual(mockSyncStatusResult);
            expect(mockCacheService.getFromCache).toHaveBeenCalledWith(expectedCacheKey);
            expect(mockCheckSyncStatusUseCase.execute).not.toHaveBeenCalled();
            expect(mockCacheService.addToCache).not.toHaveBeenCalled();
        });

        it('deve executar use case e salvar no cache quando não há cache', async () => {
            const teamId = 'team-456';
            const repositoryId = 'repo-789';
            const expectedCacheKey = 'check-sync-status:org-123:team-456:repo-789';

            mockCacheService.getFromCache.mockResolvedValue(null);
            mockCheckSyncStatusUseCase.execute.mockResolvedValue(mockSyncStatusResult);

            const result = await controller.checkSyncStatus(teamId, repositoryId);

            expect(result).toEqual(mockSyncStatusResult);
            expect(mockCacheService.getFromCache).toHaveBeenCalledWith(expectedCacheKey);
            expect(mockCheckSyncStatusUseCase.execute).toHaveBeenCalledWith(teamId, repositoryId);
            expect(mockCacheService.addToCache).toHaveBeenCalledWith(
                expectedCacheKey,
                mockSyncStatusResult,
                900000, // 15 minutos em milissegundos
            );
        });

        it('deve gerar cache key correta sem repositoryId', async () => {
            const teamId = 'team-456';
            const expectedCacheKey = 'check-sync-status:org-123:team-456:no-repo';

            mockCacheService.getFromCache.mockResolvedValue(null);
            mockCheckSyncStatusUseCase.execute.mockResolvedValue(mockSyncStatusResult);

            const result = await controller.checkSyncStatus(teamId);

            expect(result).toEqual(mockSyncStatusResult);
            expect(mockCacheService.getFromCache).toHaveBeenCalledWith(expectedCacheKey);
            expect(mockCheckSyncStatusUseCase.execute).toHaveBeenCalledWith(teamId, undefined);
            expect(mockCacheService.addToCache).toHaveBeenCalledWith(
                expectedCacheKey,
                mockSyncStatusResult,
                900000,
            );
        });

        it('deve gerar cache key correta com repositoryId undefined', async () => {
            const teamId = 'team-456';
            const repositoryId = undefined;
            const expectedCacheKey = 'check-sync-status:org-123:team-456:no-repo';

            mockCacheService.getFromCache.mockResolvedValue(null);
            mockCheckSyncStatusUseCase.execute.mockResolvedValue(mockSyncStatusResult);

            const result = await controller.checkSyncStatus(teamId, repositoryId);

            expect(result).toEqual(mockSyncStatusResult);
            expect(mockCacheService.getFromCache).toHaveBeenCalledWith(expectedCacheKey);
            expect(mockCheckSyncStatusUseCase.execute).toHaveBeenCalledWith(teamId, undefined);
            expect(mockCacheService.addToCache).toHaveBeenCalledWith(
                expectedCacheKey,
                mockSyncStatusResult,
                900000,
            );
        });

        it('deve usar organization UUID correto na cache key', async () => {
            const teamId = 'team-456';
            const repositoryId = 'repo-789';
            const expectedCacheKey = 'check-sync-status:org-123:team-456:repo-789';

            mockCacheService.getFromCache.mockResolvedValue(null);
            mockCheckSyncStatusUseCase.execute.mockResolvedValue(mockSyncStatusResult);

            await controller.checkSyncStatus(teamId, repositoryId);

            expect(mockCacheService.getFromCache).toHaveBeenCalledWith(expectedCacheKey);
            expect(mockCacheService.addToCache).toHaveBeenCalledWith(
                expectedCacheKey,
                mockSyncStatusResult,
                900000,
            );
        });
    });
});
