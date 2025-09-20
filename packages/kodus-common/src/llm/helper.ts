import { ChatAnthropic } from '@langchain/anthropic';
import { ChatNovitaAI } from '@langchain/community/chat_models/novita';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Runnable } from '@langchain/core/runnables';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogle } from '@langchain/google-gauth';
import { Callbacks } from '@langchain/core/callbacks/manager';

export const getChatGPT = (options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    verbose?: boolean;
    callbacks?: Callbacks;
    baseURL?: string;
    apiKey?: string;
}) => {
    const defaultOptions = {
        model: MODEL_STRATEGIES[LLMModelProvider.OPENAI_GPT_4_1].modelName,
        temperature: 0,
        cache: true,
        maxRetries: 10,
        maxConcurrency: 10,
        maxTokens:
            MODEL_STRATEGIES[LLMModelProvider.OPENAI_GPT_4_1].defaultMaxTokens,
        verbose: false,
        streaming: false,
        callbacks: [],
        baseURL: options?.baseURL ? options.baseURL : null,
        apiKey: options?.apiKey
            ? options.apiKey
            : process.env.API_OPEN_AI_API_KEY,
    };

    const finalOptions = options
        ? { ...defaultOptions, ...options }
        : defaultOptions;

    return new ChatOpenAI({
        modelName: finalOptions.model,
        openAIApiKey: finalOptions.apiKey,
        temperature: finalOptions.temperature,
        maxTokens: finalOptions.maxTokens,
        streaming: finalOptions.streaming,
        verbose: finalOptions.verbose,
        callbacks: finalOptions.callbacks,
        configuration: {
            baseURL: finalOptions.baseURL,
            apiKey: finalOptions.apiKey,
        },
    });
};

const getChatAnthropic = (
    options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        verbose?: boolean;
        callbacks?: Callbacks;
        json?: boolean;
    } | null,
) => {
    const defaultOptions = {
        model: MODEL_STRATEGIES[LLMModelProvider.CLAUDE_3_5_SONNET].modelName,
        temperature: 0,
        maxTokens:
            MODEL_STRATEGIES[LLMModelProvider.CLAUDE_3_5_SONNET]
                .defaultMaxTokens,
        verbose: false,
        streaming: false,
        callbacks: [],
        json: false,
    };

    const finalOptions = options
        ? { ...defaultOptions, ...options }
        : defaultOptions;

    return new ChatAnthropic({
        modelName: finalOptions.model,
        anthropicApiKey: process.env.API_ANTHROPIC_API_KEY,
        temperature: finalOptions.temperature,
        maxTokens: finalOptions.maxTokens,
        callbacks: finalOptions.callbacks,
    });
};

const getChatGemini = (
    options?: {
        model?: string;
        temperature?: number;
        topP?: number;
        maxTokens?: number;
        verbose?: boolean;
        callbacks?: Callbacks;
        json?: boolean;
    } | null,
) => {
    const defaultOptions = {
        model: MODEL_STRATEGIES[LLMModelProvider.GEMINI_2_5_PRO].modelName,
        temperature: 0,
        topP: 1,
        maxTokens:
            MODEL_STRATEGIES[LLMModelProvider.GEMINI_2_5_PRO].defaultMaxTokens,
        verbose: false,
        streaming: false,
        callbacks: [],
        json: false,
        maxReasoningTokens:
            MODEL_STRATEGIES[LLMModelProvider.GEMINI_2_5_PRO]
                .maxReasoningTokens,
    };

    const finalOptions = options
        ? { ...defaultOptions, ...options }
        : defaultOptions;

    return new ChatGoogle({
        model: finalOptions.model,
        apiKey: process.env.API_GOOGLE_AI_API_KEY,
        temperature: finalOptions.temperature,
        topP: finalOptions.topP,
        maxOutputTokens: finalOptions.maxTokens,
        verbose: finalOptions.verbose,
        callbacks: finalOptions.callbacks,
        maxReasoningTokens: finalOptions.maxReasoningTokens,
    });
};

const getChatVertexAI = (
    options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        verbose?: boolean;
        callbacks?: Callbacks;
        json?: boolean;
        maxReasoningTokens?: number;
    } | null,
) => {
    const defaultOptions = {
        model: MODEL_STRATEGIES[LLMModelProvider.VERTEX_GEMINI_2_5_PRO]
            .modelName,
        temperature: 0,
        maxTokens:
            MODEL_STRATEGIES[LLMModelProvider.VERTEX_GEMINI_2_5_PRO]
                .defaultMaxTokens,
        verbose: false,
        streaming: false,
        callbacks: [],
        maxReasoningTokens:
            MODEL_STRATEGIES[LLMModelProvider.VERTEX_GEMINI_2_5_PRO]
                .maxReasoningTokens,
    };

    const finalOptions = options
        ? { ...defaultOptions, ...options }
        : defaultOptions;

    const credentials = Buffer.from(
        process.env.API_VERTEX_AI_API_KEY || '',
        'base64',
    ).toString('utf-8');

    return new ChatVertexAI({
        model: finalOptions.model,
        authOptions: {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            credentials: JSON.parse(credentials),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            projectId: JSON.parse(credentials).project_id,
        },
        location: 'us-east5',
        temperature: finalOptions.temperature,
        maxOutputTokens: finalOptions.maxTokens,
        verbose: finalOptions.verbose,
        callbacks: finalOptions.callbacks,
        maxReasoningTokens: finalOptions.maxReasoningTokens,
    });
};

const getNovitaAI = (
    options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        verbose?: boolean;
        callbacks?: Callbacks;
    } | null,
) => {
    const defaultOptions = {
        model: MODEL_STRATEGIES[LLMModelProvider.NOVITA_DEEPSEEK_V3].modelName,
        temperature: 0,
        maxTokens:
            MODEL_STRATEGIES[LLMModelProvider.NOVITA_DEEPSEEK_V3]
                .defaultMaxTokens,
        verbose: false,
        streaming: false,
        callbacks: [],
    };

    if (options?.model) {
        options.model = `${options.model}`;
    }

    const finalOptions = options
        ? { ...defaultOptions, ...options }
        : defaultOptions;

    return new ChatNovitaAI({
        model: finalOptions.model,
        apiKey: process.env.API_NOVITA_AI_API_KEY,
        temperature: finalOptions.temperature,
        maxTokens: finalOptions.maxTokens,
        callbacks: finalOptions.callbacks,
    });
};

export enum LLMModelProvider {
    // OpenAI Models
    OPENAI_GPT_4O = 'openai:gpt-4o',
    OPENAI_GPT_4O_MINI = 'openai:gpt-4o-mini',
    OPENAI_GPT_4_1 = 'openai:gpt-4.1',
    OPENAI_GPT_O4_MINI = 'openai:o4-mini',

    // Anthropic Models
    CLAUDE_3_5_SONNET = 'anthropic:claude-3-5-sonnet-20241022',

    // Google AI Models
    GEMINI_2_0_FLASH = 'google:gemini-2.0-flash',
    GEMINI_2_5_PRO = 'google:gemini-2.5-pro',
    GEMINI_2_5_FLASH = 'google:gemini-2.5-flash',

    // Vertex AI Models (prefixed with 'vertex-' to differentiate)
    VERTEX_GEMINI_2_0_FLASH = 'vertex:gemini-2.0-flash',
    VERTEX_GEMINI_2_5_PRO = 'vertex:gemini-2.5-pro',
    VERTEX_GEMINI_2_5_FLASH = 'vertex:gemini-2.5-flash',
    VERTEX_CLAUDE_3_5_SONNET = 'vertex:claude-3-5-sonnet-v2@20241022',

    // Novita Models
    NOVITA_DEEPSEEK_V3 = 'novita:deepseek-v3',
    NOVITA_DEEPSEEK_V3_0324 = 'novita:deepseek-v3-0324',
    NOVITA_QWEN3_235B_A22B_THINKING_2507 = 'novita:qwen3-235b-a22b-thinking-2507',
    NOVITA_MOONSHOTAI_KIMI_K2_INSTRUCT = 'novita:moonshotai/kimi-k2-instruct',
}

type ChatAnthropicOptions = ConstructorParameters<typeof ChatAnthropic>[0];
type ChatOpenAIOptions = ConstructorParameters<typeof ChatOpenAI>[0];
type ChatGoogleAIOptions = ConstructorParameters<typeof ChatGoogle>[0];
type ChatVertexAIOptions = ConstructorParameters<typeof ChatVertexAI>[0];
type ChatNovitaAIOptions = ConstructorParameters<typeof ChatNovitaAI>[0];

export type FactoryInput =
    | ChatAnthropicOptions
    | ChatOpenAIOptions
    | ChatGoogleAIOptions
    | ChatVertexAIOptions
    | ChatNovitaAIOptions;

type FactoryArgs = FactoryInput & { baseURL?: string; json?: boolean };

export interface ModelStrategy {
    readonly provider: string;
    readonly factory: (args: FactoryArgs) => BaseChatModel | Runnable;
    readonly modelName: string;
    readonly defaultMaxTokens: number;
    readonly baseURL?: string;
    readonly inputMaxTokens?: number;
    readonly maxReasoningTokens?: number;
}

export const MODEL_STRATEGIES: Record<LLMModelProvider, ModelStrategy> = {
    // OpenAI
    [LLMModelProvider.OPENAI_GPT_4O]: {
        provider: 'openai',
        factory: getChatGPT as (args: FactoryArgs) => BaseChatModel | Runnable,
        modelName: 'gpt-4o',
        defaultMaxTokens: -1,
    },
    [LLMModelProvider.OPENAI_GPT_4O_MINI]: {
        provider: 'openai',
        factory: getChatGPT as (args: FactoryArgs) => BaseChatModel | Runnable,
        modelName: 'gpt-4o-mini',
        defaultMaxTokens: -1,
    },
    [LLMModelProvider.OPENAI_GPT_4_1]: {
        provider: 'openai',
        factory: getChatGPT as (args: FactoryArgs) => BaseChatModel | Runnable,
        modelName: 'gpt-4.1',
        defaultMaxTokens: -1,
    },
    [LLMModelProvider.OPENAI_GPT_O4_MINI]: {
        provider: 'openai',
        factory: getChatGPT as (args: FactoryArgs) => BaseChatModel | Runnable,
        modelName: 'o4-mini',
        defaultMaxTokens: -1,
    },

    // Anthropic
    [LLMModelProvider.CLAUDE_3_5_SONNET]: {
        provider: 'anthropic',
        factory: getChatAnthropic as (
            args: FactoryArgs,
        ) => BaseChatModel | Runnable,
        modelName: 'claude-3-5-sonnet-20241022',
        defaultMaxTokens: -1,
    },

    // Google Gemini
    [LLMModelProvider.GEMINI_2_0_FLASH]: {
        provider: 'google',
        factory: getChatGemini as (
            args: FactoryArgs,
        ) => BaseChatModel | Runnable,
        modelName: 'gemini-2.0-flash',
        defaultMaxTokens: 8000,
        maxReasoningTokens: 15000,
    },
    [LLMModelProvider.GEMINI_2_5_PRO]: {
        provider: 'google',
        factory: getChatGemini as (
            args: FactoryArgs,
        ) => BaseChatModel | Runnable,
        modelName: 'gemini-2.5-pro',
        defaultMaxTokens: 60000,
        inputMaxTokens: 1000000,
        maxReasoningTokens: 15000,
    },
    [LLMModelProvider.GEMINI_2_5_FLASH]: {
        provider: 'google',
        factory: getChatGemini as (
            args: FactoryArgs,
        ) => BaseChatModel | Runnable,
        modelName: 'gemini-2.5-flash',
        defaultMaxTokens: 60000,
        maxReasoningTokens: 15000,
    },

    // Vertex AI
    [LLMModelProvider.VERTEX_GEMINI_2_0_FLASH]: {
        provider: 'vertex',
        factory: getChatVertexAI as (
            args: FactoryArgs,
        ) => BaseChatModel | Runnable,
        modelName: 'gemini-2.0-flash',
        defaultMaxTokens: 8000,
        maxReasoningTokens: 15000,
    },
    [LLMModelProvider.VERTEX_GEMINI_2_5_PRO]: {
        provider: 'vertex',
        factory: getChatVertexAI as (
            args: FactoryArgs,
        ) => BaseChatModel | Runnable,
        modelName: 'gemini-2.5-pro',
        defaultMaxTokens: 60000,
        maxReasoningTokens: 15000,
    },
    [LLMModelProvider.VERTEX_GEMINI_2_5_FLASH]: {
        provider: 'vertex',
        factory: getChatVertexAI as (
            args: FactoryArgs,
        ) => BaseChatModel | Runnable,
        modelName: 'gemini-2.5-flash',
        defaultMaxTokens: 60000,
        maxReasoningTokens: 15000,
    },

    [LLMModelProvider.VERTEX_CLAUDE_3_5_SONNET]: {
        provider: 'vertex',
        factory: getChatVertexAI as (
            args: FactoryArgs,
        ) => BaseChatModel | Runnable,
        modelName: 'claude-3-5-sonnet-v2@20241022',
        defaultMaxTokens: 4000,
        inputMaxTokens: 200000,
        maxReasoningTokens: 15000,
    },

    // Deepseek
    [LLMModelProvider.NOVITA_DEEPSEEK_V3]: {
        provider: 'novita',
        factory: getNovitaAI as (args: FactoryArgs) => BaseChatModel | Runnable,
        modelName: 'deepseek/deepseek_v3',
        defaultMaxTokens: 20000,
    },
    [LLMModelProvider.NOVITA_DEEPSEEK_V3_0324]: {
        provider: 'novita',
        factory: getNovitaAI as (args: FactoryArgs) => BaseChatModel | Runnable,
        modelName: 'deepseek/deepseek-v3-0324',
        defaultMaxTokens: 20000,
    },
    [LLMModelProvider.NOVITA_QWEN3_235B_A22B_THINKING_2507]: {
        provider: 'novita',
        factory: getNovitaAI as (args: FactoryArgs) => BaseChatModel | Runnable,
        modelName: 'qwen/qwen3-235b-a22b-thinking-2507',
        defaultMaxTokens: 20000,
    },
    [LLMModelProvider.NOVITA_MOONSHOTAI_KIMI_K2_INSTRUCT]: {
        provider: 'novita',
        factory: getNovitaAI as (args: FactoryArgs) => BaseChatModel | Runnable,
        modelName: 'moonshotai/kimi-k2-instruct',
        defaultMaxTokens: 20000,
    },
};
