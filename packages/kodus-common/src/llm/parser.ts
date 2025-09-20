import { MessageContentComplex } from '@langchain/core/messages';
import {
    BaseOutputParser,
    JsonOutputParser,
    StringOutputParser,
    StructuredOutputParser,
} from '@langchain/core/output_parsers';
import { PromptRunnerService } from './promptRunner.service';
import z from 'zod';
import { LLMModelProvider } from './helper';
import { ParserType } from './builder';
import { tryParseJSONObject } from '@/utils/json';

export class CustomStringOutputParser extends StringOutputParser {
    static override lc_name(): string {
        return 'CustomStringOutputParser';
    }
    lc_namespace = ['kodus', 'output_parsers', 'string'];

    protected override _messageContentComplexToString(
        content: MessageContentComplex,
    ): string {
        if (content?.type === 'reasoning') {
            return '';
        }
        return super._messageContentComplexToString(content);
    }
}

export class CustomJsonOutputParser extends JsonOutputParser {
    static override lc_name(): string {
        return 'CustomJsonOutputParser';
    }
    lc_namespace = ['kodus', 'output_parsers', 'json'];

    protected override _baseMessageContentToString(
        content: MessageContentComplex[],
    ): string {
        const noReasoningContent = content.filter(
            (c) => c.type !== 'reasoning',
        );
        const text = noReasoningContent.map((c) =>
            c.type === 'text' && c.text && typeof c.text === 'string'
                ? c.text
                : '',
        );
        return text.join('\n').trim();
    }
}

export class ZodOutputParser<T extends z.ZodObject> extends BaseOutputParser {
    static override lc_name(): string {
        return 'ZodOutputParser';
    }
    lc_namespace = ['kodus', 'output_parsers', 'zod'];

    private readonly structuredParser: BaseOutputParser<z.infer<T>>;

    constructor(
        private readonly config: {
            schema: T;
            promptRunnerService: PromptRunnerService;
            provider?: LLMModelProvider;
            fallbackProvider?: LLMModelProvider;
        },
    ) {
        super();
        this.structuredParser = StructuredOutputParser.fromZodSchema(
            this.config.schema as any,
        ) as BaseOutputParser<z.infer<T>>;
    }

    protected override _baseMessageContentToString(
        content: MessageContentComplex[],
    ): string {
        const noReasoningContent = content.filter(
            (c) => c.type !== 'reasoning',
        );
        const text = noReasoningContent.map((c) =>
            c.type === 'text' && c.text && typeof c.text === 'string'
                ? c.text
                : '',
        );
        return text.join('\n').trim();
    }

    public override getFormatInstructions(): string {
        return this.structuredParser.getFormatInstructions();
    }

    /**
     * Parses the raw string output from the LLM.
     * It attempts to extract and parse JSON, and if it fails,
     * it uses another LLM call to correct the format.
     */
    public override async parse(text: string): Promise<z.infer<T>> {
        if (!text) {
            throw new Error('Input text is empty or undefined');
        }

        const parseJsonPreprocessor = (
            value: unknown,
            ctx: z.RefinementCtx,
        ): unknown => {
            if (typeof value === 'string') {
                try {
                    let cleanResponse = value;

                    if (value.startsWith('```')) {
                        cleanResponse = value
                            .replace(/^```json\n/, '')
                            .replace(/\n```(\n)?$/, '')
                            .trim();
                    }

                    const parsedResponse = tryParseJSONObject(cleanResponse);

                    if (parsedResponse) {
                        return parsedResponse;
                    }

                    throw new Error(
                        'Failed to parse JSON from the provided string',
                    );
                } catch {
                    ctx.addIssue({
                        code: 'custom',
                        message: 'Invalid JSON string',
                    });
                    return z.NEVER;
                }
            }

            ctx.addIssue({
                code: 'custom',
                message: 'Input must be a string',
            });
            return z.NEVER;
        };

        try {
            return await this.structuredParser.parse(text);
        } catch {
            try {
                const preprocessorSchema = z.preprocess(
                    parseJsonPreprocessor,
                    this.config.schema,
                );

                return preprocessorSchema.parse(text);
            } catch {
                // If parsing fails, use the LLM to fix the JSON
                return this._runCorrectionChain(text);
            }
        }
    }

    /**
     * Internal method to run a new prompt chain to fix malformed JSON.
     */
    private async _runCorrectionChain(
        malformedOutput: string,
    ): Promise<z.infer<T>> {
        if (!this.config.schema) {
            throw new Error('Schema is required for JSON correction');
        }

        if (!malformedOutput) {
            throw new Error('Malformed output is empty or undefined');
        }

        const prompt = (input: string) =>
            `${input}\n\n${this.structuredParser.getFormatInstructions()}`;

        const result = await this.config.promptRunnerService
            .builder()
            .setProviders({
                main:
                    this.config.provider || LLMModelProvider.OPENAI_GPT_4O_MINI,
                fallback:
                    this.config.fallbackProvider ||
                    LLMModelProvider.OPENAI_GPT_4O,
            })
            .setParser(ParserType.CUSTOM, this.structuredParser)
            .setPayload(malformedOutput)
            .addPrompt({ prompt })
            .setTemperature(0)
            .setLLMJsonMode(true)
            .setRunName('fixAndExtractJson')
            .execute();

        if (!result || !this.config.schema.safeParse(result).success) {
            throw new Error('Failed to correct JSON even after LLM fallback.');
        }

        return result;
    }
}
