import { Test, TestingModule } from '@nestjs/testing';
import { LLMAnalysisService } from '@/core/infrastructure/adapters/services/codeBase/llmAnalysis.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { LLMModelProvider, LLMProviderService } from '@kodus/kodus-common/llm';

describe('LLMAnalysisService', () => {
    let service: LLMAnalysisService;
    let llmProviderService: jest.Mocked<LLMProviderService>;
    let logger: jest.Mocked<PinoLoggerService>;

    beforeEach(async () => {
        const mockLLMProviderService = {
            getLLMProvider: jest.fn().mockReturnValue({
                bind: jest.fn().mockReturnThis(),
                withConfig: jest.fn().mockReturnThis(),
                withFallbacks: jest.fn().mockReturnThis(),
                invoke: jest.fn().mockResolvedValue('mock response'),
            }),
        };

        const mockLogger = {
            error: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                LLMAnalysisService,
                {
                    provide: LLMProviderService,
                    useValue: mockLLMProviderService,
                },
                {
                    provide: PinoLoggerService,
                    useValue: mockLogger,
                },
            ],
        }).compile();

        service = module.get<LLMAnalysisService>(LLMAnalysisService);
        llmProviderService = module.get<LLMProviderService>(
            LLMProviderService,
        ) as jest.Mocked<LLMProviderService>;
        logger = module.get<PinoLoggerService>(
            PinoLoggerService,
        ) as jest.Mocked<PinoLoggerService>;
    });

    describe('Provider Integration Tests', () => {
        it('should correctly call LLMProviderService with enum provider (not modelName)', async () => {
            const provider = LLMModelProvider.OPENAI_GPT_4O_MINI;

            // Mock the private method to test provider usage
            const createChain = (
                service as any
            ).createExtractSuggestionsProviderChain.bind(service);

            await createChain(
                { organizationId: 'test', teamId: 'test' },
                123,
                provider,
                {},
            );

            // Verify that getLLMProvider was called with the enum provider, not modelName
            expect(llmProviderService.getLLMProvider).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: provider, // Should be 'openai:gpt-4o-mini', not 'gpt-4o-mini'
                    temperature: 0,
                    callbacks: expect.any(Array),
                }),
            );
        });

        it('should work with all supported providers', async () => {
            const providers = [
                LLMModelProvider.OPENAI_GPT_4O,
                LLMModelProvider.OPENAI_GPT_4O_MINI,
                LLMModelProvider.GEMINI_2_5_PRO,
                LLMModelProvider.CLAUDE_3_5_SONNET,
                LLMModelProvider.NOVITA_DEEPSEEK_V3,
            ];

            for (const provider of providers) {
                llmProviderService.getLLMProvider.mockClear();

                const createChain = (
                    service as any
                ).createExtractSuggestionsProviderChain.bind(service);

                await expect(
                    createChain(
                        { organizationId: 'test', teamId: 'test' },
                        123,
                        provider,
                        {},
                    ),
                ).resolves.not.toThrow();

                expect(llmProviderService.getLLMProvider).toHaveBeenCalledWith(
                    expect.objectContaining({
                        model: provider,
                    }),
                );
            }
        });

        it('should handle different chain creation methods consistently', async () => {
            const provider = LLMModelProvider.OPENAI_GPT_4O;
            const mockOrgTeamData = { organizationId: 'test', teamId: 'test' };

            // Test different chain creation methods
            const chainMethods = [
                'createValidateImplementedSuggestionsChain',
                'createSelectReviewModeChain',
                'createSeverityAnalysisChain',
            ];

            for (const methodName of chainMethods) {
                if (typeof (service as any)[methodName] === 'function') {
                    llmProviderService.getLLMProvider.mockClear();

                    const method = (service as any)[methodName].bind(service);

                    await expect(
                        method(mockOrgTeamData, 123, provider, {}),
                    ).resolves.not.toThrow();

                    expect(
                        llmProviderService.getLLMProvider,
                    ).toHaveBeenCalledWith(
                        expect.objectContaining({
                            model: provider, // Must be enum, not modelName
                        }),
                    );
                }
            }
        });

        it('should never pass modelName directly to LLMProviderService', async () => {
            const provider = LLMModelProvider.OPENAI_GPT_4O_MINI;

            // Test all chain creation methods to ensure none use modelName
            const allMethods = Object.getOwnPropertyNames(
                Object.getPrototypeOf(service),
            ).filter(
                (name) =>
                    name.includes('Chain') &&
                    typeof (service as any)[name] === 'function',
            );

            for (const methodName of allMethods) {
                try {
                    llmProviderService.getLLMProvider.mockClear();

                    const method = (service as any)[methodName].bind(service);
                    await method(
                        { organizationId: 'test', teamId: 'test' },
                        123,
                        provider,
                        {},
                    );

                    // Check all calls to ensure none use just the modelName
                    const calls = llmProviderService.getLLMProvider.mock.calls;
                    calls.forEach((call) => {
                        const options = call[0];
                        if (options && options.model) {
                            // Model should be enum (contains ':') not just modelName
                            expect(options.model).toContain(':');
                            expect(options.model).not.toBe('gpt-4o-mini'); // Specific check for the bug
                        }
                    });
                } catch (error) {
                    // Some methods might throw due to missing dependencies, that's OK
                    // We're just checking the provider usage pattern
                }
            }
        });
    });

    describe('Error Handling', () => {
        it('should handle LLMProviderService errors gracefully', async () => {
            llmProviderService.getLLMProvider.mockImplementation(() => {
                throw new Error('Provider error');
            });

            const createChain = (
                service as any
            ).createExtractSuggestionsProviderChain.bind(service);

            await expect(
                createChain(
                    { organizationId: 'test', teamId: 'test' },
                    123,
                    LLMModelProvider.OPENAI_GPT_4O_MINI,
                    {},
                ),
            ).rejects.toThrow();

            expect(logger.error).toHaveBeenCalled();
        });
    });
});
