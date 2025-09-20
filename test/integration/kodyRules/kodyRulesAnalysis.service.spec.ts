// Mock Sentry and OpenTelemetry to avoid initialization issues in tests
jest.mock('@sentry/node', () => ({
    init: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    configureScope: jest.fn(),
    withScope: jest.fn(),
    getCurrentHub: jest.fn(),
    addBreadcrumb: jest.fn(),
}));

jest.mock('@opentelemetry/api', () => ({
    trace: {
        getTracer: jest.fn(() => ({
            startSpan: jest.fn(() => ({
                setAttributes: jest.fn(),
                setStatus: jest.fn(),
                recordException: jest.fn(),
                end: jest.fn(),
            })),
        })),
    },
    context: {
        active: jest.fn(),
        with: jest.fn(),
    },
}));

jest.mock('@/core/infrastructure/adapters/services/logger/pino.service');

import { Test, TestingModule } from '@nestjs/testing';
import { KodyRulesAnalysisService } from '@/ee/codeBase/kodyRulesAnalysis.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { PromptRunnerService } from '@kodus/kodus-common/llm';
import { KODY_RULES_SERVICE_TOKEN } from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { KodyRulesService } from '@/ee/kodyRules/service/kodyRules.service';
import {
    AIAnalysisResult,
    CodeSuggestion,
} from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { LabelType } from '@/shared/utils/codeManagement/labels';

describe('KodyRulesAnalysisService - replaceKodyRuleIdsWithLinks', () => {
    let service: KodyRulesAnalysisService;
    let mockLogger: jest.Mocked<PinoLoggerService>;
    let mockKodyRulesService: jest.Mocked<KodyRulesService>;
    let mockPromptRunnerService: jest.Mocked<PromptRunnerService>;

    const mockOrgData: OrganizationAndTeamData = {
        organizationId: 'org-123',
        organizationName: 'Test Organization',
        teamId: 'team-456',
        teamName: 'Test Team',
    };

    const prNumber = 123;

    // Mock Kody Rules data
    const mockKodyRules = {
        'c555b451-4bb3-4fb8-8a20-06b16ca3f479': {
            uuid: 'c555b451-4bb3-4fb8-8a20-06b16ca3f479',
            title: 'Toda variável declarada no código deve ser iniciada com um valor default',
            repositoryId: 'repo-456',
        },
        'a2e8b0c1-f3d4-4a5b-8c6d-7e9f0a1b2c3d': {
            uuid: 'a2e8b0c1-f3d4-4a5b-8c6d-7e9f0a1b2c3d',
            title: 'Use Proper Error Handling',
            repositoryId: 'global',
        },
        'broken-rule-1': {
            uuid: 'broken-rule-1',
            title: 'Broken Rule 1',
            repositoryId: 'repo-789',
        },
        'broken-rule-2': {
            uuid: 'broken-rule-2',
            title: 'Broken Rule 2',
            repositoryId: 'global',
        },
        'violated-rule-1': {
            uuid: 'violated-rule-1',
            title: 'Violated Rule 1',
            repositoryId: 'repo-101',
        },
        'violated-rule-2': {
            uuid: 'violated-rule-2',
            title: 'Violated Rule 2',
            repositoryId: 'global',
        },
    };

    beforeEach(async () => {
        // Reset all mocks before each test
        jest.clearAllMocks();

        mockLogger = {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            info: jest.fn(),
        } as any;

        mockKodyRulesService = {
            findById: jest.fn(),
        } as any;

        mockPromptRunnerService = {
            run: jest.fn(),
            builder: jest.fn().mockReturnValue({
                withSystemPrompt: jest.fn().mockReturnThis(),
                withUserPrompt: jest.fn().mockReturnThis(),
                withParser: jest.fn().mockReturnThis(),
                withConfig: jest.fn().mockReturnThis(),
                execute: jest.fn().mockResolvedValue({ result: [] }),
            }),
        } as any;

        // Setup mock environment
        process.env.API_USER_INVITE_BASE_URL = 'https://example.com';

        // Mock the PinoLoggerService constructor
        (
            PinoLoggerService as jest.MockedClass<typeof PinoLoggerService>
        ).mockImplementation(() => mockLogger as any);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                KodyRulesAnalysisService,
                { provide: PinoLoggerService, useValue: mockLogger },
                {
                    provide: PromptRunnerService,
                    useValue: mockPromptRunnerService,
                },
                {
                    provide: KODY_RULES_SERVICE_TOKEN,
                    useValue: mockKodyRulesService,
                },
            ],
        }).compile();

        service = module.get<KodyRulesAnalysisService>(
            KodyRulesAnalysisService,
        );

        // Setup findById mock to return appropriate rule data
        mockKodyRulesService.findById.mockImplementation((ruleId: string) => {
            return Promise.resolve(mockKodyRules[ruleId] || null);
        });
    });

    describe('🔄 replaceKodyRuleIdsWithLinks', () => {
        it('deve substituir IDs UUID válidos no texto do suggestionContent por links corretos', async () => {
            // Cenário 1: IDs UUID válidos no texto do suggestionContent
            const validUuid1 = 'c555b451-4bb3-4fb8-8a20-06b16ca3f479';
            const validUuid2 = 'a2e8b0c1-f3d4-4a5b-8c6d-7e9f0a1b2c3d';

            const suggestions: AIAnalysisResult = {
                codeSuggestions: [
                    {
                        id: 'suggestion-1',
                        relevantFile: 'test.ts',
                        language: 'typescript',
                        suggestionContent: `Esta variável viola a regra ${validUuid1} do projeto.`,
                        improvedCode: 'const value = "";',
                        label: LabelType.KODY_RULES,
                        relevantLinesStart: 10,
                        relevantLinesEnd: 10,
                    } as CodeSuggestion,
                    {
                        id: 'suggestion-2',
                        relevantFile: 'test.ts',
                        language: 'typescript',
                        suggestionContent: `Aplicar a regra \`${validUuid2}\` para melhorar o código.`,
                        improvedCode: 'let value: string = "";',
                        label: LabelType.KODY_RULES,
                        relevantLinesStart: 15,
                        relevantLinesEnd: 15,
                    } as CodeSuggestion,
                ],
                overallSummary: 'Test summary',
            };

            const result = await service['replaceKodyRuleIdsWithLinks'](
                suggestions,
                mockOrgData,
                prNumber,
            );

            expect(result.codeSuggestions).toHaveLength(2);

            // Verifica se o primeiro UUID foi substituído por link
            expect(result.codeSuggestions[0].suggestionContent).toBe(
                'Esta variável viola a regra [Toda variável declarada no código deve ser iniciada com um valor default](https://example.com/settings/code-review/repo-456/kody-rules/c555b451-4bb3-4fb8-8a20-06b16ca3f479) do projeto.',
            );

            // Verifica se o segundo UUID foi substituído por link
            expect(result.codeSuggestions[1].suggestionContent).toBe(
                'Aplicar a regra [Use Proper Error Handling](https://example.com/settings/code-review/global/kody-rules/a2e8b0c1-f3d4-4a5b-8c6d-7e9f0a1b2c3d) para melhorar o código.',
            );
        });

        it('deve adicionar texto de violação e criar link para sugestões com brokenKodyRulesIds', async () => {
            // Cenário 2: IDs no brokenKodyRulesIds
            const suggestions: AIAnalysisResult = {
                codeSuggestions: [
                    {
                        id: 'suggestion-3',
                        relevantFile: 'Models/Aula.cs',
                        language: 'csharp',
                        suggestionContent:
                            'A propriedade `TipoAula` não está sendo inicializada com um valor padrão.',
                        improvedCode:
                            'public string TipoAula { get; set; } = string.Empty;',
                        label: LabelType.KODY_RULES,
                        brokenKodyRulesIds: ['broken-rule-1'],
                        relevantLinesStart: 34,
                        relevantLinesEnd: 34,
                    } as CodeSuggestion,
                    {
                        id: 'suggestion-4',
                        relevantFile: 'Models/Aula.cs',
                        language: 'csharp',
                        suggestionContent:
                            'A propriedade `Modalidade` não está sendo inicializada.',
                        improvedCode:
                            'public string Modalidade { get; set; } = string.Empty;',
                        label: LabelType.KODY_RULES,
                        brokenKodyRulesIds: ['broken-rule-2'],
                        relevantLinesStart: 38,
                        relevantLinesEnd: 38,
                    } as CodeSuggestion,
                ],
                overallSummary: 'Test summary',
            };

            const result = await service['replaceKodyRuleIdsWithLinks'](
                suggestions,
                mockOrgData,
                prNumber,
            );

            expect(result.codeSuggestions).toHaveLength(2);

            // Verifica se foi adicionado o texto de violação E criado link para a primeira sugestão
            expect(result.codeSuggestions[0].suggestionContent).toBe(
                'A propriedade `TipoAula` não está sendo inicializada com um valor padrão.\n\nKody Rule violation: [Broken Rule 1](https://example.com/settings/code-review/repo-789/kody-rules/broken-rule-1)',
            );

            // Verifica se foi adicionado o texto de violação E criado link para a segunda sugestão
            expect(result.codeSuggestions[1].suggestionContent).toBe(
                'A propriedade `Modalidade` não está sendo inicializada.\n\nKody Rule violation: [Broken Rule 2](https://example.com/settings/code-review/global/kody-rules/broken-rule-2)',
            );
        });

        it('deve adicionar texto de violação e criar link para sugestões com violatedKodyRulesIds', async () => {
            // Cenário 3: IDs no violatedKodyRulesIds
            const suggestions: AIAnalysisResult = {
                codeSuggestions: [
                    {
                        id: 'suggestion-5',
                        relevantFile: 'Models/Aula.cs',
                        language: 'csharp',
                        suggestionContent:
                            'A propriedade `Status` não está sendo inicializada.',
                        improvedCode:
                            'public string Status { get; set; } = string.Empty;',
                        label: LabelType.KODY_RULES,
                        violatedKodyRulesIds: ['violated-rule-1'],
                        relevantLinesStart: 50,
                        relevantLinesEnd: 50,
                    } as CodeSuggestion,
                    {
                        id: 'suggestion-6',
                        relevantFile: 'Models/Aula.cs',
                        language: 'csharp',
                        suggestionContent:
                            'A propriedade `Observacoes` não está sendo inicializada.',
                        improvedCode:
                            'public string Observacoes { get; set; } = string.Empty;',
                        label: LabelType.KODY_RULES,
                        violatedKodyRulesIds: ['violated-rule-2'],
                        relevantLinesStart: 54,
                        relevantLinesEnd: 54,
                    } as CodeSuggestion,
                ],
                overallSummary: 'Test summary',
            };

            const result = await service['replaceKodyRuleIdsWithLinks'](
                suggestions,
                mockOrgData,
                prNumber,
            );

            expect(result.codeSuggestions).toHaveLength(2);

            // Verifica se foi adicionado o texto de violação E criado link para a primeira sugestão
            expect(result.codeSuggestions[0].suggestionContent).toBe(
                'A propriedade `Status` não está sendo inicializada.\n\nKody Rule violation: [Violated Rule 1](https://example.com/settings/code-review/repo-101/kody-rules/violated-rule-1)',
            );

            // Verifica se foi adicionado o texto de violação E criado link para a segunda sugestão
            expect(result.codeSuggestions[1].suggestionContent).toBe(
                'A propriedade `Observacoes` não está sendo inicializada.\n\nKody Rule violation: [Violated Rule 2](https://example.com/settings/code-review/global/kody-rules/violated-rule-2)',
            );
        });

        it('deve processar sugestões mistas com diferentes tipos de referências de regras', async () => {
            // Cenário combinado: testando todos os tipos em uma única execução
            const suggestions: AIAnalysisResult = {
                codeSuggestions: [
                    // ID no texto
                    {
                        id: 'mixed-1',
                        relevantFile: 'test.ts',
                        language: 'typescript',
                        suggestionContent:
                            'Seguir a regra c555b451-4bb3-4fb8-8a20-06b16ca3f479 para inicialização.',
                        improvedCode: 'const value = "";',
                        label: LabelType.KODY_RULES,
                    } as CodeSuggestion,
                    // brokenKodyRulesIds
                    {
                        id: 'mixed-2',
                        relevantFile: 'Models/Test.cs',
                        language: 'csharp',
                        suggestionContent: 'Propriedade sem inicialização.',
                        improvedCode:
                            'public string Prop { get; set; } = string.Empty;',
                        label: LabelType.KODY_RULES,
                        brokenKodyRulesIds: [
                            'c555b451-4bb3-4fb8-8a20-06b16ca3f479',
                        ],
                    } as CodeSuggestion,
                    // violatedKodyRulesIds
                    {
                        id: 'mixed-3',
                        relevantFile: 'Models/Another.cs',
                        language: 'csharp',
                        suggestionContent:
                            'Outra propriedade sem inicialização.',
                        improvedCode:
                            'public string Another { get; set; } = string.Empty;',
                        label: LabelType.KODY_RULES,
                        violatedKodyRulesIds: [
                            'c555b451-4bb3-4fb8-8a20-06b16ca3f479',
                        ],
                    } as CodeSuggestion,
                    // Sugestão de outro tipo (não deve ser processada)
                    {
                        id: 'other-type',
                        relevantFile: 'test.ts',
                        language: 'typescript',
                        suggestionContent: 'Uma sugestão de performance.',
                        improvedCode: 'optimized code',
                        label: LabelType.PERFORMANCE_AND_OPTIMIZATION,
                    } as CodeSuggestion,
                ],
                overallSummary: 'Mixed test summary',
            };

            const result = await service['replaceKodyRuleIdsWithLinks'](
                suggestions,
                mockOrgData,
                prNumber,
            );

            expect(result.codeSuggestions).toHaveLength(4);

            // Primeiro: ID substituído por link
            expect(result.codeSuggestions[0].suggestionContent).toBe(
                'Seguir a regra [Toda variável declarada no código deve ser iniciada com um valor default](https://example.com/settings/code-review/repo-456/kody-rules/c555b451-4bb3-4fb8-8a20-06b16ca3f479) para inicialização.',
            );

            // Segundo: texto de violação adicionado E link criado (brokenKodyRulesIds)
            expect(result.codeSuggestions[1].suggestionContent).toBe(
                'Propriedade sem inicialização.\n\nKody Rule violation: [Toda variável declarada no código deve ser iniciada com um valor default](https://example.com/settings/code-review/repo-456/kody-rules/c555b451-4bb3-4fb8-8a20-06b16ca3f479)',
            );

            // Terceiro: texto de violação adicionado E link criado (violatedKodyRulesIds)
            expect(result.codeSuggestions[2].suggestionContent).toBe(
                'Outra propriedade sem inicialização.\n\nKody Rule violation: [Toda variável declarada no código deve ser iniciada com um valor default](https://example.com/settings/code-review/repo-456/kody-rules/c555b451-4bb3-4fb8-8a20-06b16ca3f479)',
            );

            // Quarto: não deve ser modificado (não é kody_rules)
            expect(result.codeSuggestions[3].suggestionContent).toBe(
                'Uma sugestão de performance.',
            );
        });

        it('deve retornar suggestions inalteradas quando não há codeSuggestions', async () => {
            const suggestions: AIAnalysisResult = {
                codeSuggestions: [],
                overallSummary: 'Empty test',
            };

            const result = await service['replaceKodyRuleIdsWithLinks'](
                suggestions,
                mockOrgData,
                prNumber,
            );

            expect(result).toEqual(suggestions);
        });

        it('deve lidar com erro do PromptRunnerService e continuar processamento', async () => {
            const suggestions: AIAnalysisResult = {
                codeSuggestions: [
                    {
                        id: 'error-test',
                        relevantFile: 'test.ts',
                        language: 'typescript',
                        suggestionContent: 'Erro na regra sem UUID válido.',
                        improvedCode: 'fixed code',
                        label: LabelType.KODY_RULES,
                    } as CodeSuggestion,
                ],
                overallSummary: 'Error test',
            };

            const result = await service['replaceKodyRuleIdsWithLinks'](
                suggestions,
                mockOrgData,
                prNumber,
            );

            // Deve retornar a sugestão original sem modificações
            expect(result.codeSuggestions[0].suggestionContent).toBe(
                'Erro na regra sem UUID válido.',
            );

            // Deve ter logado erro relacionado ao LLM fallback
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Error in LLM fallback for ID extraction',
                    context: 'KodyRulesAnalysisService',
                }),
            );
        });
    });
});
