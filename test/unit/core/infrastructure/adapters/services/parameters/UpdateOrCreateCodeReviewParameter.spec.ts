import {
    BehaviourForExistingDescription,
    CodeReviewConfigWithoutLLMProvider,
    LimitationType,
} from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { UpdateOrCreateCodeReviewParameterUseCase } from '@/core/application/use-cases/parameters/update-or-create-code-review-parameter-use-case';
import { INTEGRATION_CONFIG_SERVICE_TOKEN } from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { PARAMETERS_SERVICE_TOKEN } from '@/core/domain/parameters/contracts/parameters.service.contract';
import { ParametersEntity } from '@/core/domain/parameters/entities/parameters.entity';
import { IntegrationConfigService } from '@/core/infrastructure/adapters/services/integrations/integrationConfig.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { ParametersService } from '@/core/infrastructure/adapters/services/parameters.service';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { Test, TestingModule } from '@nestjs/testing';

describe('UpdateOrCreateCodeReviewParameterUseCase', () => {
    let useCase: UpdateOrCreateCodeReviewParameterUseCase;
    let parametersService: any;
    let integrationConfigService: any;

    const mockParametersService = {
        findByKey: jest.fn(),
        createOrUpdateConfig: jest.fn(),
    };

    const mockIntegrationConfigService = {
        findIntegrationConfigFormatted: jest.fn(),
    };

    const mockLogger = {
        error: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UpdateOrCreateCodeReviewParameterUseCase,
                {
                    provide: PARAMETERS_SERVICE_TOKEN,
                    useValue: mockParametersService,
                },
                {
                    provide: INTEGRATION_CONFIG_SERVICE_TOKEN,
                    useValue: mockIntegrationConfigService,
                },
                { provide: PinoLoggerService, useValue: mockLogger },
            ],
        }).compile();

        useCase = module.get<UpdateOrCreateCodeReviewParameterUseCase>(
            UpdateOrCreateCodeReviewParameterUseCase,
        );
        parametersService = module.get(PARAMETERS_SERVICE_TOKEN);
        integrationConfigService = module.get(INTEGRATION_CONFIG_SERVICE_TOKEN);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    const MOCK_TEAM_ID = 'team_id1';

    const BASIC_CONFIG_VALUE: Partial<CodeReviewConfigWithoutLLMProvider> = {
        automatedReviewActive: true,
        reviewOptions: {
            security: false,
            code_style: true,
            refactoring: true,
            error_handling: false,
            maintainability: false,
            potential_issues: true,
            documentation_and_comments: true,
            performance_and_optimization: true,
            kody_rules: true,
            breaking_changes: false,
        },
        suggestionControl: {
            maxSuggestions: 20,
            limitationType: LimitationType.PR,
            severityLevelFilter: SeverityLevel.MEDIUM,
        },
    };

    describe('🎯 Cenários Essenciais de Configuração', () => {
        it('deve criar nova configuração com applyFiltersToKodyRules=false por padrão', async () => {
            const body = {
                organizationAndTeamData: {
                    teamId: MOCK_TEAM_ID,
                } as OrganizationAndTeamData,
                configValue: BASIC_CONFIG_VALUE,
            };

            mockParametersService.findByKey.mockResolvedValue(null);
            mockIntegrationConfigService.findIntegrationConfigFormatted.mockResolvedValue([]);

            const mockResult = new ParametersEntity({
                uuid: 'uuid',
                configKey: ParametersKey.CODE_REVIEW_CONFIG,
                configValue: { global: BASIC_CONFIG_VALUE, repositories: [] },
            });

            mockParametersService.createOrUpdateConfig.mockResolvedValue(mockResult);

            const result = await useCase.execute(body);

            // ✅ Verifica que applyFiltersToKodyRules é false por padrão
            expect(parametersService.createOrUpdateConfig).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                expect.objectContaining({
                    global: expect.objectContaining({
                        suggestionControl: expect.objectContaining({
                            applyFiltersToKodyRules: false, // ✅ Padrão aplicado
                        }),
                    }),
                }),
                body.organizationAndTeamData,
            );
            expect(result).toBeInstanceOf(ParametersEntity);
        });

        it('deve preservar applyFiltersToKodyRules=true quando explicitamente definido', async () => {
            const body = {
                organizationAndTeamData: {
                    teamId: MOCK_TEAM_ID,
                } as OrganizationAndTeamData,
                configValue: {
                    ...BASIC_CONFIG_VALUE,
                    suggestionControl: {
                        ...BASIC_CONFIG_VALUE.suggestionControl!,
                        applyFiltersToKodyRules: true, // ✅ Valor explícito
                    },
                },
            };

            mockParametersService.findByKey.mockResolvedValue(null);
            mockIntegrationConfigService.findIntegrationConfigFormatted.mockResolvedValue([]);

            await useCase.execute(body);

            // ✅ Verifica que valor explícito é preservado
            expect(parametersService.createOrUpdateConfig).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                expect.objectContaining({
                    global: expect.objectContaining({
                        suggestionControl: expect.objectContaining({
                            applyFiltersToKodyRules: true, // ✅ Valor preservado
                        }),
                    }),
                }),
                body.organizationAndTeamData,
            );
        });

        it('deve atualizar configuração existente preservando outros valores', async () => {
            const existingConfig = {
                configValue: {
                    global: {
                        ...BASIC_CONFIG_VALUE,
                        reviewOptions: {
                            ...BASIC_CONFIG_VALUE.reviewOptions!,
                            security: true, // ✅ Valor diferente no existente
                        },
                    },
                    repositories: [],
                },
            };

            const body = {
                organizationAndTeamData: {
                    teamId: MOCK_TEAM_ID,
                } as OrganizationAndTeamData,
                configValue: {
                    suggestionControl: {
                        applyFiltersToKodyRules: true, // ✅ Apenas mudando esta flag
                    },
                },
            };

            mockParametersService.findByKey.mockResolvedValue(existingConfig);
            mockIntegrationConfigService.findIntegrationConfigFormatted.mockResolvedValue([]);

            await useCase.execute(body);

            // ✅ Verifica merge correto preservando valores existentes
            expect(parametersService.createOrUpdateConfig).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                expect.objectContaining({
                    global: expect.objectContaining({
                        automatedReviewActive: true, // ✅ Preservado
                        reviewOptions: expect.objectContaining({
                            security: true, // ✅ Valor do config existente preservado
                            code_style: true, // ✅ Valor do config existente preservado
                        }),
                        suggestionControl: expect.objectContaining({
                            applyFiltersToKodyRules: true, // ✅ Novo valor aplicado
                            maxSuggestions: 20, // ✅ Valor existente preservado
                            severityLevelFilter: SeverityLevel.MEDIUM, // ✅ Valor existente preservado
                        }),
                    }),
                }),
                body.organizationAndTeamData,
            );
        });

        it('deve lidar com configuração repositório específico', async () => {
            const body = {
                organizationAndTeamData: {
                    teamId: MOCK_TEAM_ID,
                } as OrganizationAndTeamData,
                configValue: {
                    suggestionControl: {
                        applyFiltersToKodyRules: true,
                    },
                },
                repositoryId: 'repo-123',
            };

            const existingConfig = {
                configValue: {
                    global: BASIC_CONFIG_VALUE,
                    repositories: [
                        {
                            id: 'repo-123',
                            name: 'Repo 123',
                            ...BASIC_CONFIG_VALUE,
                        },
                    ],
                },
            };

            mockParametersService.findByKey.mockResolvedValue(existingConfig);
            mockIntegrationConfigService.findIntegrationConfigFormatted.mockResolvedValue([]);

            await useCase.execute(body);

            // ✅ Verifica que repositório específico foi atualizado
            expect(parametersService.createOrUpdateConfig).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                expect.objectContaining({
                    repositories: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'repo-123',
                            suggestionControl: expect.objectContaining({
                                applyFiltersToKodyRules: true, // ✅ Atualizado para este repo
                            }),
                        }),
                    ]),
                }),
                body.organizationAndTeamData,
            );
        });
    });
});
