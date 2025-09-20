import {
    BaseOutputParser,
    JsonOutputParser,
} from '@langchain/core/output_parsers';
import { CustomStringOutputParser, ZodOutputParser } from './parser';
import {
    PromptRole,
    PromptRunnerParams,
    PromptRunnerService,
} from './promptRunner.service';
import z from 'zod';

export enum ParserType {
    STRING = 'string',
    JSON = 'json',
    ZOD = 'zod',
    CUSTOM = 'custom',
}

//#region Types

/**
 * A type constraint for the output of the prompt execution.
 *
 * This type ensures that the output type matches the expected type based on the parser type.
 */
type OutputTypeConstraint<
    Mode extends ParserType,
    OutputType,
> = Mode extends ParserType.STRING ? string : OutputType;

/**
 * A type that ensures the output is a safe JSON object.
 *
 * This type is used to ensure that the output of the prompt execution is a valid JSON object.
 */
type SafeJsonOutput<T> =
    T extends Record<string, any> ? T : Record<string, any>;

//#region PromptBuilder

/**
 * A builder class for constructing and executing prompts with various configurations.
 *
 * This class allows you to set up prompts with different roles, payloads, and configurations,
 * and execute them using the `PromptRunnerService`.
 */
export class PromptBuilder {
    constructor(private readonly runner: PromptRunnerService) {}

    /**
     * Sets the main and optional fallback LLM providers.
     * @param config The configuration object containing the main and optional fallback providers.
     * - `main`: The main LLM provider to use.
     * - `fallback`: An optional fallback LLM provider.
     * @returns The PromptBuilderWithProviders instance for chaining.
     */
    setProviders(config: {
        main: PromptRunnerParams<void>['provider'];
        fallback?: PromptRunnerParams<void>['fallbackProvider'];
    }): PromptBuilderWithProviders {
        const params = {
            provider: config.main,
            fallbackProvider: config.fallback,
            parser: undefined,
            prompts: [],
            payload: undefined,
            runName: '',
            metadata: {},
            temperature: 0,
            jsonMode: false,
            callbacks: [],
            tags: [],
        };

        return new PromptBuilderWithProviders(this.runner, params);
    }
}

//#region WithProviders

/**
 * A builder class for constructing and executing prompts with various configurations.
 *
 * This class allows you to set up prompts with different roles, payloads, and configurations,
 * and execute them using the `PromptRunnerService`.
 */
class PromptBuilderWithProviders {
    constructor(
        private readonly runner: PromptRunnerService,
        private readonly params: Partial<PromptRunnerParams<void>> = {},
    ) {}

    /**
     * Sets a custom parser for the prompt execution.
     *
     * This parser will be used to parse the output of the LLM.
     * @param type The type of the parser to be used.
     * @param parserOrSchema The parser instance or Zod schema to be used.
     * @param config Optional configuration for the parser. Only used for Zod parsers.
     * - `provider`: The main LLM provider to use. @default LLMModelProvider.OPENAI_GPT_4O_MINI
     * - `fallbackProvider`: An optional fallback LLM provider. @default LLMModelProvider.OPENAI_GPT_4O
     * @template NewOutputType The expected output type of the parser.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    setParser(
        type: ParserType.STRING,
    ): ConfigurablePromptBuilderWithoutPayload<string, ParserType.STRING>;

    setParser<NewOutputType extends object>(
        type: ParserType.JSON,
    ): ConfigurablePromptBuilderWithoutPayload<NewOutputType, ParserType.JSON>;

    setParser<NewOutputType extends z.ZodObject>(
        type: ParserType.ZOD,
        parserOrSchema: NewOutputType,
        config?: Pick<
            PromptRunnerParams<void, NewOutputType>,
            'provider' | 'fallbackProvider'
        >,
    ): ConfigurablePromptBuilderWithoutPayload<
        z.infer<NewOutputType>,
        ParserType.ZOD
    >;

    setParser<NewOutputType>(
        type: ParserType.CUSTOM,
        parserOrSchema: PromptRunnerParams<void, NewOutputType>['parser'],
    ): ConfigurablePromptBuilderWithoutPayload<
        NewOutputType,
        ParserType.CUSTOM
    >;

    setParser<NewOutputType>(
        type: ParserType,
        parserOrSchema?:
            | PromptRunnerParams<void, NewOutputType>['parser']
            | z.ZodObject,
        config?: Pick<
            PromptRunnerParams<void, NewOutputType>,
            'provider' | 'fallbackProvider'
        >,
    ): ConfigurablePromptBuilderWithoutPayload<
        NewOutputType | string | z.infer<z.ZodObject>,
        ParserType
    > {
        switch (type) {
            case ParserType.STRING: {
                return new ConfigurablePromptBuilderWithoutPayload<
                    string,
                    ParserType.STRING
                >(
                    this.runner,
                    {
                        ...this.params,
                        parser: new CustomStringOutputParser(),
                    },
                    ParserType.STRING,
                );
            }
            case ParserType.JSON: {
                return new ConfigurablePromptBuilderWithoutPayload<
                    NewOutputType,
                    ParserType.JSON
                >(
                    this.runner,
                    {
                        ...this.params,
                        parser: new JsonOutputParser<
                            SafeJsonOutput<NewOutputType>
                        >(),
                    },
                    ParserType.JSON,
                );
            }
            case ParserType.CUSTOM: {
                if (
                    !parserOrSchema ||
                    !(parserOrSchema instanceof BaseOutputParser)
                ) {
                    throw new Error(
                        'Custom parser must be provided for CUSTOM type, and it must be an instance of BaseOutputParser',
                    );
                }

                return new ConfigurablePromptBuilderWithoutPayload<
                    NewOutputType,
                    ParserType.CUSTOM
                >(
                    this.runner,
                    {
                        ...this.params,
                        parser: parserOrSchema,
                    },
                    ParserType.CUSTOM,
                );
            }
            case ParserType.ZOD: {
                if (!parserOrSchema || !(parserOrSchema instanceof z.ZodType)) {
                    throw new Error(
                        'Zod schema must be provided for ZOD type, and it must be a valid Zod schema',
                    );
                }

                return new ConfigurablePromptBuilderWithoutPayload<
                    z.infer<typeof parserOrSchema>,
                    ParserType.ZOD
                >(
                    this.runner,
                    {
                        ...this.params,
                        parser: new ZodOutputParser({
                            schema: parserOrSchema,
                            promptRunnerService: this.runner,
                            provider: config?.provider,
                            fallbackProvider: config?.fallbackProvider,
                        }),
                    },
                    ParserType.ZOD,
                );
            }
            default: {
                throw new Error(`Unsupported parser type`);
            }
        }
    }
}

//#region Configurable

/**
 * A builder class for constructing and executing prompts with various configurations.
 *
 * This class allows you to set up prompts with different roles, payloads, and configurations,
 * and execute them using the `PromptRunnerService`.
 *
 * @template OutputType The expected output type of the prompt execution. Defaults to `string`.
 * @template Payload The type of the payload that will be passed to the prompt functions.
 * Defaults to `void`, meaning no payload is used. Inferred via `setPayload` method of ConfigurablePromptBuilderWithoutPayload.
 * @template OutputMode The type of the output parser to be used. Defaults to `ParserType.STRING`.
 * Can be `ParserType.STRING`, `ParserType.JSON`, or `ParserType.CUSTOM`.
 */
class ConfigurablePromptBuilder<
    OutputType,
    Payload,
    OutputMode extends ParserType,
> {
    protected params: Partial<PromptRunnerParams<Payload, OutputType>> = {};

    constructor(
        protected readonly runner: PromptRunnerService,
        initialParams: Partial<PromptRunnerParams<any>> = {},
        protected readonly parserType: ParserType = ParserType.STRING,
    ) {
        this.params = {
            provider: undefined,
            fallbackProvider: undefined,
            parser: undefined,
            prompts: [],
            payload: undefined,
            runName: '',
            metadata: {},
            temperature: 0,
            jsonMode: false,
            callbacks: [],
            tags: [],
            ...initialParams,
        };
    }

    /**
     * Sets the JSON mode for the prompt execution.
     *
     * This is related to the LLM provider's configuration
     * @param jsonMode Whether to enable JSON mode.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    setLLMJsonMode(
        jsonMode: NonNullable<
            PromptRunnerParams<Payload, OutputType>
        >['jsonMode'],
    ): this {
        this.params.jsonMode = jsonMode;
        return this;
    }

    /**
     * Adds a system or user prompt to the configuration. The prompts will be executed in the order they are added.
     *
     * **Note:** The `payload` from the `setPayload` call will be used for the entire execution.
     * If adding multiple prompts (e.g., system and user), ensure they use the same payload object.
     * @param config The configuration object containing the role and prompt function.
     * - `role`: The role of the prompt (system or user). Defaults to `User`.
     * - `prompt`: A function that returns the prompt string based on the provided payload.
     *   If a string is provided, it will be used as the prompt directly.
     *   If a function is provided, it will be called with the payload to generate the prompt string.
     * - `roleName`: Optional custom role name for custom roles.
     * - `type`: Optional type for the prompt, can be used for custom handling. Defaults to 'text'.
     * - `scope`: Optional scope for the prompt, can be `global`, `main`, or `fallback`. Defaults to `global`.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    addPrompt(
        config: NonNullable<
            PromptRunnerParams<Payload, OutputType>['prompts'][number]
        >,
    ): // explicitly typed so once we have a prompt, the payload cannot be changed
    ConfigurablePromptBuilder<OutputType, Payload, OutputMode> {
        if (!this.params.prompts) {
            this.params.prompts = [];
        }

        if (config.role === PromptRole.CUSTOM && !config.roleName) {
            throw new Error(
                'Custom prompt roles must have a roleName defined.',
            );
        }

        this.params.prompts.push(config);

        return this;
    }

    /**
     * Adds metadata for logging and tracing.
     * @param metadata A record of key-value pairs.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    addMetadata(
        metadata: NonNullable<
            PromptRunnerParams<Payload, OutputType>['metadata']
        >,
    ): this {
        if (!this.params.metadata) {
            this.params.metadata = {};
        }

        this.params.metadata = {
            ...(this.params.metadata || {}),
            ...(metadata || {}),
        };
        return this;
    }

    /**
     * Sets the temperature for the LLM. Defaults to 0.
     * @param temperature The creativity/randomness of the output.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    setTemperature(
        temperature: NonNullable<
            PromptRunnerParams<Payload, OutputType>['temperature']
        >,
    ): this {
        this.params.temperature = temperature;
        return this;
    }

    /**
     * Sets a name for the run, useful for tracing.
     * @param runName The name of the run.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    setRunName(
        runName: NonNullable<
            PromptRunnerParams<Payload, OutputType>['runName']
        >,
    ): this {
        this.params.runName = runName;
        return this;
    }

    /**
     * Adds a list of tags to the prompt configuration.
     *
     * Tags can be used for categorization or filtering in logs.
     * @param tags An array of strings representing the tags.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    addTags(
        tags: NonNullable<PromptRunnerParams<Payload, OutputType>['tags']>,
    ): this {
        if (!this.params.tags) {
            this.params.tags = [];
        }

        this.params.tags = [...(this.params.tags || []), ...(tags || [])];
        return this;
    }

    /**
     * Adds callback handlers for the prompt execution.
     *
     * Callbacks can be used to monitor or modify the execution process.
     * @param callbacks An array of callback handlers.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    addCallbacks(
        callbacks: NonNullable<
            PromptRunnerParams<Payload, OutputType>['callbacks']
        >,
    ): this {
        if (!this.params.callbacks) {
            this.params.callbacks = [];
        }

        this.params.callbacks = [
            ...(this.params.callbacks || []),
            ...(callbacks || []),
        ];

        return this;
    }

    /**
     * Sets the maximum number of reasoning tokens for the LLM.
     *
     * This can help control the length and complexity of the response.
     * @param maxReasoningTokens The maximum number of reasoning tokens.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    setMaxReasoningTokens(
        maxReasoningTokens: NonNullable<
            PromptRunnerParams<Payload, OutputType>['maxReasoningTokens']
        >,
    ): this {
        this.params.maxReasoningTokens = maxReasoningTokens;
        return this;
    }

    /**
     * Sets the maximum number of tokens for the LLM response.
     *
     * This can help control the length of the output.
     * @param maxTokens The maximum number of tokens.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    setMaxTokens(
        maxTokens: NonNullable<
            PromptRunnerParams<Payload, OutputType>['maxTokens']
        >,
    ): this {
        this.params.maxTokens = maxTokens;
        return this;
    }

    /**
     * Sets a custom property for the prompt execution.
     *
     * This can be used to pass additional configuration or context.
     *
     * !! MAY BREAK FUNCTIONALITY IF NOT USED PROPERLY !!
     * @param key The key for the custom property.
     * @param value The value for the custom property.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    setCustomProperty<K extends keyof PromptRunnerParams<Payload>>(
        key: K,
        value: NonNullable<PromptRunnerParams<Payload, OutputType>[K]>,
    ): this {
        this.params[key] = value;
        return this;
    }

    /**
     * Executes the prompt request with the configured parameters.
     * @returns A promise that resolves to the LLM response.
     */
    async execute(): Promise<OutputTypeConstraint<
        OutputMode,
        OutputType
    > | null> {
        if (!this.params.provider) {
            throw new Error(
                'LLM provider not set. Please call "setProviders()" before executing.',
            );
        }

        if (!this.params.parser) {
            throw new Error(
                'Output parser not set. Please call "setParser()" before executing.',
            );
        }

        if (!this.params.prompts || this.params.prompts.length === 0) {
            throw new Error(
                'No prompts defined. Please call "addPrompt()" to define at least one prompt.',
            );
        }

        return (await this.runner.runPrompt<Payload, OutputType>({
            ...this.params,
            provider: this.params.provider,
            parser: this.params.parser,
            prompts: this.params.prompts,
        })) as OutputTypeConstraint<OutputMode, OutputType> | null;
    }
}

//#region WithoutPayload

/**
 * A builder class for constructing and executing prompts with various configurations.
 *
 * This class allows you to set up prompts with different roles, payloads, and configurations,
 * and execute them using the `PromptRunnerService`.
 *
 * @template OutputType The expected output type of the prompt execution. Defaults to `string`.
 * @template OutputMode The type of the output parser to be used. Defaults to `ParserType.STRING`.
 * Can be `ParserType.STRING`, `ParserType.JSON`, or `ParserType.CUSTOM`.
 */
class ConfigurablePromptBuilderWithoutPayload<
    OutputType,
    OutputMode extends ParserType,
> extends ConfigurablePromptBuilder<OutputType, void, OutputMode> {
    /**
     * Sets the payload for the prompt execution.
     *
     * This payload will be used in the prompt functions defined in `addPrompt`.
     * @param payload The payload to be added.
     * @returns The ConfigurablePromptBuilder instance for chaining.
     */
    setPayload<P>(
        payload: P,
    ): ConfigurablePromptBuilder<OutputType, P, OutputMode> {
        return new ConfigurablePromptBuilder<OutputType, P, OutputMode>(
            this.runner,
            {
                ...this.params,
                payload,
            },
            this.parserType,
        );
    }
}
