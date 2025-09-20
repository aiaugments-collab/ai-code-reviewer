import { GoogleGenerativeAI } from '@google/generative-ai';
import { createLogger } from '../../../observability/index.js';
import {
    AgentInputEnum,
    LLMMessage,
    LLMResponse,
} from '../../../core/types/allTypes.js';

// Simple provider interface for legacy providers
export interface LLMProvider {
    name: string;
    call(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
    stream?(
        messages: LLMMessage[],
        options?: LLMOptions,
    ): AsyncGenerator<LLMResponse>;
}

export interface LLMOptions {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    topP?: number;
    stop?: string[];
    frequencyPenalty?: number;
    presencePenalty?: number;
    stream?: boolean;
    tools?: Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    }>;
    toolChoice?:
        | 'auto'
        | 'none'
        | { type: 'function'; function: { name: string } };
}

export interface GeminiConfig {
    apiKey: string;
    model?: string;
    defaultOptions?: {
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        topK?: number;
    };
}

export class GeminiProvider implements LLMProvider {
    public readonly name = 'gemini';
    private client: GoogleGenerativeAI;
    private modelName: string;
    private logger = createLogger('gemini-provider');
    private defaultOptions: GeminiConfig['defaultOptions'];

    constructor(config: GeminiConfig) {
        this.client = new GoogleGenerativeAI(config.apiKey);
        this.modelName = config.model || 'gemini-1.5-flash'; // Use stable model by default
        this.defaultOptions = config.defaultOptions || {};

        this.logger.info('Gemini Provider initialized', {
            model: this.modelName,
            hasApiKey: !!config.apiKey,
        });
    }

    async call(
        messages: LLMMessage[],
        options?: LLMOptions,
    ): Promise<LLMResponse> {
        try {
            // Convert messages to simple string format
            const prompt = this.convertMessagesToPrompt(messages);

            // Merge options with defaults
            const mergedOptions = this.mergeOptions(options);

            this.logger.debug('Calling Gemini API', {
                model: this.modelName,
                messageCount: messages.length,
                promptLength: prompt.length,
                temperature: mergedOptions.temperature,
            });

            // Get model with current options
            const model = this.client.getGenerativeModel({
                model: this.modelName,
                generationConfig: mergedOptions,
            });

            // Generate content
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            const llmResponse: LLMResponse = {
                content: text,
                usage: {
                    promptTokens: response.usageMetadata?.promptTokenCount || 0,
                    completionTokens:
                        response.usageMetadata?.candidatesTokenCount || 0,
                    totalTokens: response.usageMetadata?.totalTokenCount || 0,
                },
            };

            this.logger.debug('Gemini API response received', {
                contentLength: llmResponse.content.length,
                usage: llmResponse.usage,
            });

            return llmResponse;
        } catch (error) {
            this.logger.error('Gemini API call failed', error as Error);
            throw new Error(
                `Gemini API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    async *stream(
        messages: LLMMessage[],
        options?: LLMOptions,
    ): AsyncGenerator<LLMResponse> {
        try {
            const prompt = this.convertMessagesToPrompt(messages);
            const mergedOptions = this.mergeOptions(options);

            this.logger.debug('Starting Gemini stream', {
                model: this.modelName,
                messageCount: messages.length,
            });

            const model = this.client.getGenerativeModel({
                model: this.modelName,
                generationConfig: mergedOptions,
            });

            const result = await model.generateContentStream(prompt);

            for await (const chunk of result.stream) {
                const text = chunk.text();
                if (text) {
                    yield {
                        content: text,
                        usage: chunk.usageMetadata
                            ? {
                                  promptTokens:
                                      chunk.usageMetadata.promptTokenCount || 0,
                                  completionTokens:
                                      chunk.usageMetadata
                                          .candidatesTokenCount || 0,
                                  totalTokens:
                                      chunk.usageMetadata.totalTokenCount || 0,
                              }
                            : undefined,
                    };
                }
            }
        } catch (error) {
            this.logger.error('Gemini streaming failed', error as Error);
            throw new Error(
                `Gemini streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    /**
     * Convert our LLMMessage format to a simple prompt string
     */
    private convertMessagesToPrompt(messages: LLMMessage[]): string {
        return messages
            .map((msg) => {
                switch (msg.role) {
                    case AgentInputEnum.SYSTEM:
                        return `SYSTEM: ${msg.content}`;
                    case AgentInputEnum.USER:
                        return `USER: ${msg.content}`;
                    case AgentInputEnum.ASSISTANT:
                        return `ASSISTANT: ${msg.content}`;
                    default:
                        return msg.content;
                }
            })
            .join('\n\n');
    }

    /**
     * Merge options with defaults
     */
    private mergeOptions(options?: LLMOptions) {
        return {
            temperature:
                options?.temperature ?? this.defaultOptions?.temperature ?? 0.7,
            maxOutputTokens:
                options?.maxTokens ?? this.defaultOptions?.maxTokens ?? 1000,
            topP: options?.topP ?? this.defaultOptions?.topP ?? 0.9,
            topK: this.defaultOptions?.topK ?? 40,
            stopSequences: options?.stop,
        };
    }

    /**
     * Get current model
     */
    getModel(): string {
        return this.modelName;
    }

    /**
     * Set model
     */
    setModel(model: string): void {
        this.modelName = model;
        this.logger.info('Model changed', { newModel: model });
    }

    /**
     * Test connection to Gemini API
     */
    async testConnection(): Promise<boolean> {
        try {
            const response = await this.call(
                [
                    {
                        role: AgentInputEnum.USER,
                        content:
                            'Hello! This is a connection test. Please respond with just "OK".',
                    },
                ],
                { maxTokens: 10 },
            );

            this.logger.info('Gemini connection test successful', {
                responseLength: response.content.length,
                usage: response.usage,
            });

            return true;
        } catch (error) {
            this.logger.error('Gemini connection test failed', error as Error);
            return false;
        }
    }
}

/**
 * Factory function to create Gemini provider
 */
export function createGeminiProvider(config: GeminiConfig): GeminiProvider {
    return new GeminiProvider(config);
}

/**
 * Helper to create Gemini provider from environment variables
 */
export function createGeminiProviderFromEnv(): GeminiProvider {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        throw new Error(
            'GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required',
        );
    }

    return new GeminiProvider({
        apiKey,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        defaultOptions: {
            temperature: process.env.GEMINI_TEMPERATURE
                ? parseFloat(process.env.GEMINI_TEMPERATURE)
                : 0.7,
            maxTokens: process.env.GEMINI_MAX_TOKENS
                ? parseInt(process.env.GEMINI_MAX_TOKENS)
                : 10000, // 🔥 AUMENTADO: De 1000 para 10000 tokens para respostas completas
            topP: process.env.GEMINI_TOP_P
                ? parseFloat(process.env.GEMINI_TOP_P)
                : 0.9,
            topK: process.env.GEMINI_TOP_K
                ? parseInt(process.env.GEMINI_TOP_K)
                : 40,
        },
    });
}
