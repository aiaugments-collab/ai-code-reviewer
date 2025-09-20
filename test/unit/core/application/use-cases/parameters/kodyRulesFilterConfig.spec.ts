import { Test } from '@nestjs/testing';
import { UpdateOrCreateCodeReviewParameterUseCase } from '@/core/application/use-cases/parameters/update-or-create-code-review-parameter-use-case';
import { PARAMETERS_SERVICE_TOKEN } from '@/core/domain/parameters/contracts/parameters.service.contract';
import { INTEGRATION_CONFIG_SERVICE_TOKEN } from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { ParametersEntity } from '@/core/domain/parameters/entities/parameters.entity';
import {
    SuggestionControlConfig,
    LimitationType,
    GroupingModeSuggestions,
} from '@/config/types/general/codeReview.type';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';

describe('UpdateOrCreateCodeReviewParameterUseCase - Kody Rules Filter Config', () => {
    let useCase: UpdateOrCreateCodeReviewParameterUseCase;
    let mockParametersService: any;
    let mockIntegrationConfigService: any;
    let mockLogger: any;

    const mockOrgData: OrganizationAndTeamData = {
        organizationId: 'org1',
        teamId: '123',
    };

    beforeEach(async () => {
        mockParametersService = {
            findByKey: jest.fn(),
            createOrUpdateConfig: jest.fn(),
        };

        mockIntegrationConfigService = {
            findIntegrationConfigFormatted: jest.fn().mockResolvedValue([]),
        };

        mockLogger = {
            log: jest.fn(),
            error: jest.fn(),
        };

        const module = await Test.createTestingModule({
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
    });

    describe('🎯 Configuração applyFiltersToKodyRules', () => {
        it('deve adicionar applyFiltersToKodyRules=false como padrão quando criando nova configuração', async () => {
            // Cenário: Primeira configuração, sem config existente
            mockParametersService.findByKey.mockResolvedValue(null);

            await useCase.execute({
                organizationAndTeamData: mockOrgData,
                configValue: {
                    automatedReviewActive: true,
                    suggestionControl: {
                        maxSuggestions: 10,
                        limitationType: LimitationType.PR,
                        severityLevelFilter: SeverityLevel.HIGH,
                        // ✅ Sem applyFiltersToKodyRules definido
                    },
                },
            });

            // ✅ Verifica se foi chamado com padrão false
            expect(mockParametersService.createOrUpdateConfig).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                expect.objectContaining({
                    global: expect.objectContaining({
                        suggestionControl: expect.objectContaining({
                            applyFiltersToKodyRules: false, // ✅ Padrão aplicado
                        }),
                    }),
                }),
                mockOrgData
            );
        });

        it('deve preservar applyFiltersToKodyRules=true quando explicitamente definido', async () => {
            mockParametersService.findByKey.mockResolvedValue(null);

            await useCase.execute({
                organizationAndTeamData: mockOrgData,
                configValue: {
                    automatedReviewActive: true,
                    suggestionControl: {
                        maxSuggestions: 15,
                        applyFiltersToKodyRules: true, // ✅ Explicitamente habilitado
                    },
                },
            });

            // ✅ Verifica se preservou o valor explícito
            expect(mockParametersService.createOrUpdateConfig).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                expect.objectContaining({
                    global: expect.objectContaining({
                        suggestionControl: expect.objectContaining({
                            applyFiltersToKodyRules: true, // ✅ Valor preservado
                        }),
                    }),
                }),
                mockOrgData
            );
        });

        it('deve garantir backward compatibility adicionando applyFiltersToKodyRules=false para configs legadas', async () => {
            // Cenário: Config legada sem applyFiltersToKodyRules
            const existingLegacyConfig = {
                configValue: {
                    global: {
                        suggestionControl: {
                            severityLevelFilter: SeverityLevel.CRITICAL,
                            maxSuggestions: 5,
                            // ❌ Sem applyFiltersToKodyRules (config legada)
                        },
                        automatedReviewActive: true,
                    },
                },
            } as ParametersEntity;

            mockParametersService.findByKey.mockResolvedValue(existingLegacyConfig);

            await useCase.execute({
                organizationAndTeamData: mockOrgData,
                configValue: {
                    suggestionControl: {
                        severityLevelFilter: SeverityLevel.HIGH, // Mudança pequena
                    },
                },
            });

            // ✅ Verifica se adicionou o padrão para config legada
            expect(mockParametersService.createOrUpdateConfig).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                expect.objectContaining({
                    global: expect.objectContaining({
                        suggestionControl: expect.objectContaining({
                            applyFiltersToKodyRules: false, // ✅ Padrão adicionado
                            severityLevelFilter: SeverityLevel.HIGH, // ✅ Mudança aplicada
                        }),
                    }),
                }),
                mockOrgData
            );
        });

        it('deve permitir mudança de applyFiltersToKodyRules=false para true', async () => {
            // Cenário: Cliente quer habilitar filtros para Kody Rules
            const existingConfig = {
                configValue: {
                    global: {
                        suggestionControl: {
                            maxSuggestions: 10,
                            applyFiltersToKodyRules: false, // ✅ Atualmente desabilitado
                        },
                    },
                },
            } as ParametersEntity;

            mockParametersService.findByKey.mockResolvedValue(existingConfig);

            await useCase.execute({
                organizationAndTeamData: mockOrgData,
                configValue: {
                    suggestionControl: {
                        applyFiltersToKodyRules: true, // ✅ Cliente quer habilitar
                    },
                },
            });

            // ✅ Verifica se mudança foi aplicada
            expect(mockParametersService.createOrUpdateConfig).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                expect.objectContaining({
                    global: expect.objectContaining({
                        suggestionControl: expect.objectContaining({
                            applyFiltersToKodyRules: true, // ✅ Mudança aplicada
                        }),
                    }),
                }),
                mockOrgData
            );
        });

        it('deve manter outras configurações intactas ao alterar apenas applyFiltersToKodyRules', async () => {
            const existingCompleteConfig = {
                configValue: {
                    global: {
                        automatedReviewActive: true,
                        reviewOptions: {
                            security: true,
                            code_style: false,
                            kody_rules: true,
                        },
                        suggestionControl: {
                            maxSuggestions: 25,
                            limitationType: LimitationType.FILE,
                            severityLevelFilter: SeverityLevel.MEDIUM,
                            applyFiltersToKodyRules: false,
                        },
                    },
                },
            } as ParametersEntity;

            mockParametersService.findByKey.mockResolvedValue(existingCompleteConfig);

            await useCase.execute({
                organizationAndTeamData: mockOrgData,
                configValue: {
                    suggestionControl: {
                        applyFiltersToKodyRules: true, // ✅ Só mudando esta flag
                    },
                },
            });

            // ✅ Verifica se outras configs foram preservadas
            expect(mockParametersService.createOrUpdateConfig).toHaveBeenCalledWith(
                ParametersKey.CODE_REVIEW_CONFIG,
                expect.objectContaining({
                    global: expect.objectContaining({
                        automatedReviewActive: true, // ✅ Preservado
                        reviewOptions: expect.objectContaining({
                            security: true, // ✅ Preservado
                            code_style: false, // ✅ Preservado
                        }),
                        suggestionControl: expect.objectContaining({
                            maxSuggestions: 25, // ✅ Preservado
                            limitationType: LimitationType.FILE, // ✅ Preservado
                            severityLevelFilter: SeverityLevel.MEDIUM, // ✅ Preservado
                            applyFiltersToKodyRules: true, // ✅ Único valor alterado
                        }),
                    }),
                }),
                mockOrgData
            );
        });
    });
});
