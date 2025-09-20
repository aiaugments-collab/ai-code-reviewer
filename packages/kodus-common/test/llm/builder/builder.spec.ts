/* eslint-disable @typescript-eslint/unbound-method */
import {
    PromptRunnerService,
    PromptBuilder,
    ParserType,
    PromptRole,
    LLMModelProvider,
} from '@/llm';
import { JsonOutputParser } from '@langchain/core/output_parsers';

// Mock the PromptRunnerService to isolate the builder's logic
const mockPromptRunnerService: jest.Mocked<PromptRunnerService> = {
    runPrompt: jest.fn(),
    // We don't need the other methods for this test
    builder: jest.fn(),
    createChain: jest.fn(),
    createProviderChain: jest.fn(),
} as unknown as jest.Mocked<PromptRunnerService>;

describe('PromptBuilder', () => {
    let builder: PromptBuilder;

    beforeEach(() => {
        // Reset mocks and create a new builder instance before each test
        jest.clearAllMocks();
        builder = new PromptBuilder(mockPromptRunnerService);
    });

    it('should correctly build all parameters and call runPrompt on execute', async () => {
        const payload = { name: 'World' };
        const mainProvider = LLMModelProvider.OPENAI_GPT_4O;
        const fallbackProvider = LLMModelProvider.CLAUDE_3_5_SONNET;
        const expectedResult = { greeting: 'Hello, World!' };

        mockPromptRunnerService.runPrompt.mockResolvedValue(expectedResult);

        const result = await builder
            .setProviders({ main: mainProvider, fallback: fallbackProvider })
            .setParser<{ greeting: string }>(ParserType.JSON)
            .setPayload(payload)
            .setRunName('full-e2e-test')
            .setTemperature(0.8)
            .addPrompt({
                role: PromptRole.SYSTEM,
                prompt: 'You are a helpful assistant.',
            })
            .addPrompt({
                role: PromptRole.USER,
                prompt: (p) => `Say hello to ${p?.name}.`,
            })
            .addTags(['test', 'builder'])
            .execute();

        expect(result).toEqual(expectedResult);
        expect(mockPromptRunnerService.runPrompt).toHaveBeenCalledTimes(1);

        const passedParams = mockPromptRunnerService.runPrompt.mock.calls[0][0];
        expect(passedParams.provider).toBe(mainProvider);
        expect(passedParams.fallbackProvider).toBe(fallbackProvider);
        expect(passedParams.parser).toBeInstanceOf(JsonOutputParser);
        expect(passedParams.payload).toEqual(payload);
        expect(passedParams.runName).toBe('full-e2e-test');
        expect(passedParams.temperature).toBe(0.8);
        expect(passedParams.prompts).toHaveLength(2);
        expect(passedParams.prompts[1].prompt).toBeInstanceOf(Function);
        expect(passedParams.tags).toEqual(['test', 'builder']);
    });

    describe('Validation and Error Handling', () => {
        it('should throw an error on execute if no prompts are added', async () => {
            const chain = builder
                .setProviders({ main: LLMModelProvider.OPENAI_GPT_4O })
                .setParser(ParserType.STRING);

            await expect(chain.execute()).rejects.toThrow(
                'No prompts defined. Please call "addPrompt()" to define at least one prompt.',
            );
        });

        it('should throw an error if a custom prompt role is used without a roleName', () => {
            const chain = builder
                .setProviders({ main: LLMModelProvider.OPENAI_GPT_4O })
                .setParser(ParserType.STRING);

            expect(() =>
                chain.addPrompt({
                    role: PromptRole.CUSTOM, // Missing roleName
                    prompt: 'This should fail',
                }),
            ).toThrow('Custom prompt roles must have a roleName defined.');
        });

        it('should throw an error if a custom parser type is used without a parser instance', () => {
            const chain = builder.setProviders({
                main: LLMModelProvider.OPENAI_GPT_4O,
            });
            expect(() =>
                // @ts-expect-error - Intentionally passing invalid arguments
                chain.setParser(ParserType.CUSTOM),
            ).toThrow('Custom parser must be provided for CUSTOM type');
        });
    });
});
