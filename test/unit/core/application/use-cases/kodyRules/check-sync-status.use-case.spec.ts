import { Test } from '@nestjs/testing';
import { CheckSyncStatusUseCase } from '@/core/application/use-cases/kodyRules/check-sync-status.use-case';
import { INTEGRATION_SERVICE_TOKEN } from '@/core/domain/integrations/contracts/integration.service.contracts';
import { INTEGRATION_CONFIG_SERVICE_TOKEN } from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { PARAMETERS_SERVICE_TOKEN } from '@/core/domain/parameters/contracts/parameters.service.contract';
import { FindRulesInOrganizationByRuleFilterKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/find-rules-in-organization-by-filter.use-case';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { KodyLearningStatus } from '@/core/domain/parameters/types/configValue.type';
import { KodyRulesStatus } from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import { REQUEST } from '@nestjs/core';

describe('CheckSyncStatusUseCase', () => {
    let useCase: CheckSyncStatusUseCase;
    let mockIntegrationService: any;
    let mockIntegrationConfigService: any;
    let mockParametersService: any;
    let mockFindRulesUseCase: any;
    let mockLogger: any;
    let mockRequest: any;

    const mockOrgData = {
        organizationId: 'org-123',
        teamId: 'team-456',
    };

    const mockPlatformConfig = {
        configValue: {
            kodyLearningStatus: KodyLearningStatus.ENABLED,
        },
    };

    const mockCodeReviewConfig = {
        configValue: {
            repositories: [
                {
                    id: 'repo-1',
                    ideRulesSyncEnabled: true,
                    kodyRulesGeneratorEnabled: true,
                },
                {
                    id: 'repo-2',
                    ideRulesSyncEnabled: false,
                    kodyRulesGeneratorEnabled: false,
                },
            ],
        },
    };

    const mockRules = [
        {
            rules: [
                {
                    sourcePath: '/path/to/rule',
                    status: KodyRulesStatus.ACTIVE,
                },
            ],
        },
    ];

    beforeEach(async () => {
        mockIntegrationService = {
            findIntegrationConfigFormatted: jest.fn(),
        };

        mockIntegrationConfigService = {
            findIntegrationConfigFormatted: jest.fn(),
        };

        mockParametersService = {
            findByKey: jest.fn(),
        };

        mockFindRulesUseCase = {
            execute: jest.fn(),
        };

        mockLogger = {
            error: jest.fn(),
        };

        mockRequest = {
            user: {
                organization: {
                    uuid: 'org-123',
                },
            },
        };

        const module = await Test.createTestingModule({
            providers: [
                CheckSyncStatusUseCase,
                {
                    provide: INTEGRATION_SERVICE_TOKEN,
                    useValue: mockIntegrationService,
                },
                {
                    provide: INTEGRATION_CONFIG_SERVICE_TOKEN,
                    useValue: mockIntegrationConfigService,
                },
                {
                    provide: PARAMETERS_SERVICE_TOKEN,
                    useValue: mockParametersService,
                },
                {
                    provide: FindRulesInOrganizationByRuleFilterKodyRulesUseCase,
                    useValue: mockFindRulesUseCase,
                },
                {
                    provide: PinoLoggerService,
                    useValue: mockLogger,
                },
                {
                    provide: REQUEST,
                    useValue: mockRequest,
                },
            ],
        }).compile();

        useCase = module.get<CheckSyncStatusUseCase>(CheckSyncStatusUseCase);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('execute', () => {
        it('deve retornar configuração padrão quando ideRulesSyncEnabled é true e kodyRulesGeneratorEnabled é true', async () => {
            mockParametersService.findByKey
                .mockResolvedValueOnce(mockPlatformConfig)
                .mockResolvedValueOnce(mockCodeReviewConfig);

            const result = await useCase.execute('team-456', 'repo-1');

            expect(result).toEqual({
                ideRulesSyncEnabledFirstTime: true,
                kodyRulesGeneratorEnabledFirstTime: false,
            });

            expect(mockParametersService.findByKey).toHaveBeenCalledWith(
                ParametersKey.PLATFORM_CONFIGS,
                mockOrgData,
            );
            expect(mockParametersService.findByKey).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                mockOrgData,
            );
        });

        it('deve retornar ideRulesSyncEnabledFirstTime como false quando ideRulesSyncEnabled é false e existem regras IDE', async () => {
            const modifiedCodeReviewConfig = {
                configValue: {
                    repositories: [
                        {
                            id: 'repo-2',
                            ideRulesSyncEnabled: false,
                            kodyRulesGeneratorEnabled: false,
                        },
                    ],
                },
            };

            mockParametersService.findByKey
                .mockResolvedValueOnce(mockPlatformConfig)
                .mockResolvedValueOnce(modifiedCodeReviewConfig);

            mockFindRulesUseCase.execute.mockResolvedValue(mockRules);

            const result = await useCase.execute('team-456', 'repo-2');

            expect(result).toEqual({
                ideRulesSyncEnabledFirstTime: false,
                kodyRulesGeneratorEnabledFirstTime: false,
            });

            expect(mockFindRulesUseCase.execute).toHaveBeenCalledWith(
                'org-123',
                {},
                'repo-2',
            );
        });

        it('deve retornar ideRulesSyncEnabledFirstTime como true quando ideRulesSyncEnabled é false e não existem regras IDE', async () => {
            const modifiedCodeReviewConfig = {
                configValue: {
                    repositories: [
                        {
                            id: 'repo-2',
                            ideRulesSyncEnabled: false,
                            kodyRulesGeneratorEnabled: false,
                        },
                    ],
                },
            };

            mockParametersService.findByKey
                .mockResolvedValueOnce(mockPlatformConfig)
                .mockResolvedValueOnce(modifiedCodeReviewConfig);

            mockFindRulesUseCase.execute.mockResolvedValue([]);

            const result = await useCase.execute('team-456', 'repo-2');

            expect(result).toEqual({
                ideRulesSyncEnabledFirstTime: true,
                kodyRulesGeneratorEnabledFirstTime: false,
            });
        });

        it('deve retornar kodyRulesGeneratorEnabledFirstTime como false quando kodyRulesGeneratorEnabled é true', async () => {
            const modifiedCodeReviewConfig = {
                configValue: {
                    repositories: [
                        {
                            id: 'repo-1',
                            ideRulesSyncEnabled: true,
                            kodyRulesGeneratorEnabled: true,
                        },
                    ],
                },
            };

            mockParametersService.findByKey
                .mockResolvedValueOnce(mockPlatformConfig)
                .mockResolvedValueOnce(modifiedCodeReviewConfig);

            const result = await useCase.execute('team-456', 'repo-1');

            expect(result).toEqual({
                ideRulesSyncEnabledFirstTime: true,
                kodyRulesGeneratorEnabledFirstTime: false,
            });
        });

        it('deve retornar kodyRulesGeneratorEnabledFirstTime como true quando kodyRulesGeneratorEnabled é false e kodyLearningStatus é DISABLED', async () => {
            const disabledPlatformConfig = {
                configValue: {
                    kodyLearningStatus: KodyLearningStatus.DISABLED,
                },
            };

            const modifiedCodeReviewConfig = {
                configValue: {
                    repositories: [
                        {
                            id: 'repo-2',
                            ideRulesSyncEnabled: true,
                            kodyRulesGeneratorEnabled: false,
                        },
                    ],
                },
            };

            mockParametersService.findByKey
                .mockResolvedValueOnce(disabledPlatformConfig)
                .mockResolvedValueOnce(modifiedCodeReviewConfig);

            const result = await useCase.execute('team-456', 'repo-2');

            expect(result).toEqual({
                ideRulesSyncEnabledFirstTime: true,
                kodyRulesGeneratorEnabledFirstTime: true,
            });
        });

        it('deve retornar kodyRulesGeneratorEnabledFirstTime como false quando kodyRulesGeneratorEnabled é false e kodyLearningStatus é ENABLED', async () => {
            const modifiedCodeReviewConfig = {
                configValue: {
                    repositories: [
                        {
                            id: 'repo-2',
                            ideRulesSyncEnabled: true,
                            kodyRulesGeneratorEnabled: false,
                        },
                    ],
                },
            };

            mockParametersService.findByKey
                .mockResolvedValueOnce(mockPlatformConfig)
                .mockResolvedValueOnce(modifiedCodeReviewConfig);

            const result = await useCase.execute('team-456', 'repo-2');

            expect(result).toEqual({
                ideRulesSyncEnabledFirstTime: true,
                kodyRulesGeneratorEnabledFirstTime: false,
            });
        });

        it('deve retornar configuração padrão quando ocorre erro', async () => {
            mockParametersService.findByKey
                .mockResolvedValueOnce(mockPlatformConfig)
                .mockRejectedValueOnce(new Error('Database error'));

            const result = await useCase.execute('team-456', 'repo-1');

            expect(result).toEqual({
                ideRulesSyncEnabledFirstTime: true,
                kodyRulesGeneratorEnabledFirstTime: true,
            });

            expect(mockLogger.error).toHaveBeenCalledWith({
                message: 'Error checking sync status',
                error: expect.any(Error),
                context: 'CheckSyncStatusUseCase',
                metadata: {
                    organizationId: 'org-123',
                    teamId: 'team-456',
                    repositoryId: 'repo-1',
                },
            });
        });

        it('deve funcionar sem repositoryId e retornar configuração padrão', async () => {
            mockParametersService.findByKey
                .mockResolvedValueOnce(mockPlatformConfig)
                .mockResolvedValueOnce(mockCodeReviewConfig);

            const result = await useCase.execute('team-456');

            expect(result).toEqual({
                ideRulesSyncEnabledFirstTime: true,
                kodyRulesGeneratorEnabledFirstTime: true,
            });
        });

        it('deve lidar com repositório não encontrado retornando configuração padrão', async () => {
            const codeReviewConfigWithUnknownRepo = {
                configValue: {
                    repositories: [
                        {
                            id: 'repo-1',
                            ideRulesSyncEnabled: true,
                            kodyRulesGeneratorEnabled: true,
                        },
                    ],
                },
            };

            mockParametersService.findByKey
                .mockResolvedValueOnce(mockPlatformConfig)
                .mockResolvedValueOnce(codeReviewConfigWithUnknownRepo);

            const result = await useCase.execute('team-456', 'unknown-repo');

            expect(result).toEqual({
                ideRulesSyncEnabledFirstTime: true,
                kodyRulesGeneratorEnabledFirstTime: true,
            });
        });

        it('deve lidar com repositório não encontrado quando ideRulesSyncEnabled é false', async () => {
            const codeReviewConfigWithUnknownRepo = {
                configValue: {
                    repositories: [
                        {
                            id: 'repo-1',
                            ideRulesSyncEnabled: false,
                            kodyRulesGeneratorEnabled: false,
                        },
                    ],
                },
            };

            mockParametersService.findByKey
                .mockResolvedValueOnce(mockPlatformConfig)
                .mockResolvedValueOnce(codeReviewConfigWithUnknownRepo);

            mockFindRulesUseCase.execute.mockResolvedValue([]);

            const result = await useCase.execute('team-456', 'unknown-repo');

            expect(result).toEqual({
                ideRulesSyncEnabledFirstTime: true,
                kodyRulesGeneratorEnabledFirstTime: true,
            });
        });

        // Novos testes específicos para regras de negócio
        describe('Regras de negócio específicas', () => {
            it('deve retornar ideRulesSyncEnabledFirstTime=false quando ideRulesSyncEnabled=false E existem regras com sourcePath', async () => {
                const configWithIdeDisabled = {
                    configValue: {
                        repositories: [
                            {
                                id: 'repo-3',
                                ideRulesSyncEnabled: false,
                                kodyRulesGeneratorEnabled: true,
                            },
                        ],
                    },
                };

                const rulesWithSourcePath = [
                    {
                        rules: [
                            {
                                sourcePath: '/path/to/ide/rule',
                                status: KodyRulesStatus.ACTIVE,
                            },
                        ],
                    },
                ];

                mockParametersService.findByKey
                    .mockResolvedValueOnce(mockPlatformConfig)
                    .mockResolvedValueOnce(configWithIdeDisabled);

                mockFindRulesUseCase.execute.mockResolvedValue(rulesWithSourcePath);

                const result = await useCase.execute('team-456', 'repo-3');

                expect(result).toEqual({
                    ideRulesSyncEnabledFirstTime: false, // Não é primeira vez (já tem regras IDE)
                    kodyRulesGeneratorEnabledFirstTime: false, // Não é primeira vez (está habilitado)
                });

                expect(mockFindRulesUseCase.execute).toHaveBeenCalledWith(
                    'org-123',
                    {},
                    'repo-3',
                );
            });

            it('deve retornar ideRulesSyncEnabledFirstTime=true quando ideRulesSyncEnabled=false E NÃO existem regras com sourcePath', async () => {
                const configWithIdeDisabled = {
                    configValue: {
                        repositories: [
                            {
                                id: 'repo-4',
                                ideRulesSyncEnabled: false,
                                kodyRulesGeneratorEnabled: false,
                            },
                        ],
                    },
                };

                const rulesWithoutSourcePath = [
                    {
                        rules: [
                            {
                                // Sem sourcePath - regra não é IDE
                                status: KodyRulesStatus.ACTIVE,
                            },
                        ],
                    },
                ];

                mockParametersService.findByKey
                    .mockResolvedValueOnce(mockPlatformConfig)
                    .mockResolvedValueOnce(configWithIdeDisabled);

                mockFindRulesUseCase.execute.mockResolvedValue(rulesWithoutSourcePath);

                const result = await useCase.execute('team-456', 'repo-4');

                expect(result).toEqual({
                    ideRulesSyncEnabledFirstTime: true, // É primeira vez (não tem regras IDE)
                    kodyRulesGeneratorEnabledFirstTime: false, // Não é primeira vez (kodyLearningStatus=ENABLED)
                });
            });

            it('deve retornar ideRulesSyncEnabledFirstTime=true quando ideRulesSyncEnabled=false E não existem regras', async () => {
                const configWithIdeDisabled = {
                    configValue: {
                        repositories: [
                            {
                                id: 'repo-5',
                                ideRulesSyncEnabled: false,
                                kodyRulesGeneratorEnabled: false,
                            },
                        ],
                    },
                };

                mockParametersService.findByKey
                    .mockResolvedValueOnce(mockPlatformConfig)
                    .mockResolvedValueOnce(configWithIdeDisabled);

                mockFindRulesUseCase.execute.mockResolvedValue([]);

                const result = await useCase.execute('team-456', 'repo-5');

                expect(result).toEqual({
                    ideRulesSyncEnabledFirstTime: true, // É primeira vez (não tem regras)
                    kodyRulesGeneratorEnabledFirstTime: false, // Não é primeira vez (kodyLearningStatus=ENABLED)
                });
            });

            it('deve retornar ideRulesSyncEnabledFirstTime=true quando ideRulesSyncEnabled=false E regras existem mas nenhuma tem sourcePath', async () => {
                const configWithIdeDisabled = {
                    configValue: {
                        repositories: [
                            {
                                id: 'repo-6',
                                ideRulesSyncEnabled: false,
                                kodyRulesGeneratorEnabled: false,
                            },
                        ],
                    },
                };

                const rulesWithoutSourcePath = [
                    {
                        rules: [
                            {
                                // Sem sourcePath
                                status: KodyRulesStatus.ACTIVE,
                            },
                        ],
                    },
                    {
                        rules: [
                            {
                                // Sem sourcePath também
                                status: KodyRulesStatus.INACTIVE,
                            },
                        ],
                    },
                ];

                mockParametersService.findByKey
                    .mockResolvedValueOnce(mockPlatformConfig)
                    .mockResolvedValueOnce(configWithIdeDisabled);

                mockFindRulesUseCase.execute.mockResolvedValue(rulesWithoutSourcePath);

                const result = await useCase.execute('team-456', 'repo-6');

                expect(result).toEqual({
                    ideRulesSyncEnabledFirstTime: true, // É primeira vez (nenhuma regra tem sourcePath)
                    kodyRulesGeneratorEnabledFirstTime: false, // Não é primeira vez (kodyLearningStatus=ENABLED)
                });
            });

            it('deve retornar kodyRulesGeneratorEnabledFirstTime=false quando kodyRulesGeneratorEnabled=true (independente do IDE)', async () => {
                const configWithKodyEnabled = {
                    configValue: {
                        repositories: [
                            {
                                id: 'repo-7',
                                ideRulesSyncEnabled: false, // IDE desabilitado
                                kodyRulesGeneratorEnabled: true, // Kody habilitado
                            },
                        ],
                    },
                };

                mockParametersService.findByKey
                    .mockResolvedValueOnce(mockPlatformConfig)
                    .mockResolvedValueOnce(configWithKodyEnabled);

                mockFindRulesUseCase.execute.mockResolvedValue([]);

                const result = await useCase.execute('team-456', 'repo-7');

                expect(result).toEqual({
                    ideRulesSyncEnabledFirstTime: true, // É primeira vez (não tem regras IDE)
                    kodyRulesGeneratorEnabledFirstTime: false, // Não é primeira vez (está habilitado)
                });
            });

            it('deve retornar kodyRulesGeneratorEnabledFirstTime=true quando kodyRulesGeneratorEnabled=false E kodyLearningStatus=DISABLED', async () => {
                const disabledPlatformConfig = {
                    configValue: {
                        kodyLearningStatus: KodyLearningStatus.DISABLED,
                    },
                };

                const configWithKodyDisabled = {
                    configValue: {
                        repositories: [
                            {
                                id: 'repo-8',
                                ideRulesSyncEnabled: true,
                                kodyRulesGeneratorEnabled: false, // Kody desabilitado
                            },
                        ],
                    },
                };

                mockParametersService.findByKey
                    .mockResolvedValueOnce(disabledPlatformConfig)
                    .mockResolvedValueOnce(configWithKodyDisabled);

                const result = await useCase.execute('team-456', 'repo-8');

                expect(result).toEqual({
                    ideRulesSyncEnabledFirstTime: true, // É primeira vez (IDE habilitado)
                    kodyRulesGeneratorEnabledFirstTime: true, // É primeira vez (kodyLearningStatus=DISABLED)
                });
            });

            it('deve retornar kodyRulesGeneratorEnabledFirstTime=false quando kodyRulesGeneratorEnabled=false E kodyLearningStatus=ENABLED', async () => {
                const configWithKodyDisabled = {
                    configValue: {
                        repositories: [
                            {
                                id: 'repo-9',
                                ideRulesSyncEnabled: true,
                                kodyRulesGeneratorEnabled: false, // Kody desabilitado
                            },
                        ],
                    },
                };

                mockParametersService.findByKey
                    .mockResolvedValueOnce(mockPlatformConfig) // kodyLearningStatus=ENABLED
                    .mockResolvedValueOnce(configWithKodyDisabled);

                const result = await useCase.execute('team-456', 'repo-9');

                expect(result).toEqual({
                    ideRulesSyncEnabledFirstTime: true, // É primeira vez (IDE habilitado)
                    kodyRulesGeneratorEnabledFirstTime: false, // Não é primeira vez (kodyLearningStatus=ENABLED)
                });
            });

            it('deve validar ambas as props independentemente - IDE false com regras, Kody false com ENABLED', async () => {
                const configWithBothDisabled = {
                    configValue: {
                        repositories: [
                            {
                                id: 'repo-10',
                                ideRulesSyncEnabled: false, // IDE desabilitado
                                kodyRulesGeneratorEnabled: false, // Kody desabilitado
                            },
                        ],
                    },
                };

                const rulesWithSourcePath = [
                    {
                        rules: [
                            {
                                sourcePath: '/path/to/ide/rule',
                                status: KodyRulesStatus.ACTIVE,
                            },
                        ],
                    },
                ];

                mockParametersService.findByKey
                    .mockResolvedValueOnce(mockPlatformConfig) // kodyLearningStatus=ENABLED
                    .mockResolvedValueOnce(configWithBothDisabled);

                mockFindRulesUseCase.execute.mockResolvedValue(rulesWithSourcePath);

                const result = await useCase.execute('team-456', 'repo-10');

                expect(result).toEqual({
                    ideRulesSyncEnabledFirstTime: false, // Não é primeira vez (tem regras IDE)
                    kodyRulesGeneratorEnabledFirstTime: false, // Não é primeira vez (kodyLearningStatus=ENABLED)
                });
            });

            it('deve validar ambas as props independentemente - IDE false sem regras, Kody false com DISABLED', async () => {
                const disabledPlatformConfig = {
                    configValue: {
                        kodyLearningStatus: KodyLearningStatus.DISABLED,
                    },
                };

                const configWithBothDisabled = {
                    configValue: {
                        repositories: [
                            {
                                id: 'repo-11',
                                ideRulesSyncEnabled: false, // IDE desabilitado
                                kodyRulesGeneratorEnabled: false, // Kody desabilitado
                            },
                        ],
                    },
                };

                mockParametersService.findByKey
                    .mockResolvedValueOnce(disabledPlatformConfig) // kodyLearningStatus=DISABLED
                    .mockResolvedValueOnce(configWithBothDisabled);

                mockFindRulesUseCase.execute.mockResolvedValue([]); // Sem regras

                const result = await useCase.execute('team-456', 'repo-11');

                expect(result).toEqual({
                    ideRulesSyncEnabledFirstTime: true, // É primeira vez (não tem regras IDE)
                    kodyRulesGeneratorEnabledFirstTime: true, // É primeira vez (kodyLearningStatus=DISABLED)
                });
            });
        });
    });

    describe('getCodeReviewConfigs', () => {
        it('deve retornar configValue do codeReviewConfig', async () => {
            mockParametersService.findByKey.mockResolvedValue(mockCodeReviewConfig);

            const result = await useCase['getCodeReviewConfigs'](mockOrgData);

            expect(result).toEqual(mockCodeReviewConfig.configValue);
            expect(mockParametersService.findByKey).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                mockOrgData,
            );
        });
    });

    describe('getFormattedRepositories', () => {
        it('deve chamar integrationConfigService com parâmetros corretos', async () => {
            const mockRepositories = [{ id: 'repo-1', name: 'Repository 1' }];
            mockIntegrationConfigService.findIntegrationConfigFormatted.mockResolvedValue(
                mockRepositories,
            );

            const result = await useCase['getFormattedRepositories'](mockOrgData);

            expect(result).toEqual(mockRepositories);
            expect(mockIntegrationConfigService.findIntegrationConfigFormatted).toHaveBeenCalledWith(
                'repositories',
                mockOrgData,
            );
        });
    });
});
