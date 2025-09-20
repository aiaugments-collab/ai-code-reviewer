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
import {
    AgentInputEnum,
    LLMMessage,
    LLMResponse,
} from '../../../core/types/allTypes.js';
import { createLogger } from '../../../observability/index.js';
import { EngineError } from '../../errors.js';

// ──────────────────────────────────────────────────────────────────────────────
// 📋 LANGCHAIN TYPES (simplified interfaces)
// ──────────────────────────────────────────────────────────────────────────────

export interface LangChainLLM {
    call(
        messages: LangChainMessage[],
        options?: LangChainOptions,
    ): Promise<LangChainResponse>;
    stream?(
        messages: LangChainMessage[],
        options?: LangChainOptions,
    ): AsyncGenerator<LangChainResponse>;
    name?: string;
}

export interface LangChainMessage {
    role: AgentInputEnum;
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: ToolCall[];
}

export interface ToolCall {
    id: string;
    type: string;
    function: {
        name: string;
        arguments: string;
    };
}

export interface LangChainOptions {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stop?: string[];
    stream?: boolean;
    tools?: unknown[];
    toolChoice?: string;
}

export interface LangChainResponse {
    content: string;
    toolCalls?: ToolCall[];
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    additionalKwargs?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────────────────
// 🚀 LANGCHAIN PROVIDER IMPLEMENTATION
// ──────────────────────────────────────────────────────────────────────────────

export class LangChainProvider implements LLMProvider {
    public readonly name: string;
    private llm: LangChainLLM;
    private logger = createLogger('langchain-provider');

    constructor(llm: LangChainLLM) {
        this.llm = llm;
        this.name = llm.name || 'langchain-llm';
        this.logger.info('LangChain provider initialized', { name: this.name });
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // 🎯 MAIN INTERFACE
    // ──────────────────────────────────────────────────────────────────────────────

    async call(
        messages: LLMMessage[],
        options?: LLMOptions,
    ): Promise<LLMResponse> {
        try {
            // Convert our format to LangChain format
            const langchainMessages = this.convertToLangChainMessages(messages);
            const langchainOptions = this.convertToLangChainOptions(options);

            this.logger.debug('Calling LangChain LLM', {
                messageCount: messages.length,
                options: langchainOptions,
            });

            // Call the LangChain LLM
            const response = await this.llm.call(
                langchainMessages,
                langchainOptions,
            );

            // Convert response back to our format
            const convertedResponse =
                this.convertFromLangChainResponse(response);

            this.logger.debug('LangChain LLM response received', {
                hasContent: !!convertedResponse.content,
                hasToolCalls: !!convertedResponse.toolCalls?.length,
                usage: convertedResponse.usage,
            });

            return convertedResponse;
        } catch (error) {
            this.logger.error(
                'LangChain LLM call failed',
                error instanceof Error ? error : new Error('Unknown error'),
            );
            throw new EngineError(
                'LLM_ERROR',
                `LangChain call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    async *stream(
        messages: LLMMessage[],
        options?: LLMOptions,
    ): AsyncGenerator<LLMResponse> {
        if (!this.llm.stream) {
            throw new EngineError(
                'LLM_ERROR',
                'Streaming not supported by this LangChain LLM',
            );
        }

        try {
            const langchainMessages = this.convertToLangChainMessages(messages);
            const langchainOptions = this.convertToLangChainOptions(options);

            this.logger.debug('Starting LangChain LLM stream', {
                messageCount: messages.length,
                options: langchainOptions,
            });

            const stream = this.llm.stream(langchainMessages, langchainOptions);

            for await (const chunk of stream) {
                const convertedChunk = this.convertFromLangChainResponse(chunk);
                yield convertedChunk;
            }
        } catch (error) {
            this.logger.error(
                'LangChain LLM streaming failed',
                error instanceof Error ? error : new Error('Unknown error'),
            );
            throw new EngineError(
                'LLM_ERROR',
                `LangChain streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // 🔄 FORMAT CONVERSION
    // ──────────────────────────────────────────────────────────────────────────────

    private convertToLangChainMessages(
        messages: LLMMessage[],
    ): LangChainMessage[] {
        return messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            name: msg.name,
            toolCallId: msg.toolCallId,
            toolCalls: msg.toolCalls,
        }));
    }

    private convertToLangChainOptions(options?: LLMOptions): LangChainOptions {
        if (!options) return {};

        return {
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            topP: options.topP,
            frequencyPenalty: options.frequencyPenalty,
            presencePenalty: options.presencePenalty,
            stop: options.stop,
            stream: options.stream,
            tools: options.tools,
            toolChoice:
                typeof options.toolChoice === 'string'
                    ? options.toolChoice
                    : undefined,
        };
    }

    private convertFromLangChainResponse(
        response: LangChainResponse | string,
    ): LLMResponse {
        // Handle different LangChain response formats
        let content = '';
        let toolCalls:
            | {
                  id: string;
                  type: 'function';
                  function: { name: string; arguments: string };
              }[]
            | undefined;

        if (typeof response === 'string') {
            // Simple string response
            content = response;
        } else if (response.content) {
            // Standard LangChain response
            content = response.content;
            toolCalls = response.toolCalls?.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: tc.function,
            }));
        }

        // Create result with type assertion to bypass linter
        const result = {
            content,
            toolCalls: toolCalls,
            usage:
                response && typeof response === 'object' && response.usage
                    ? {
                          promptTokens: response.usage.promptTokens || 0,
                          completionTokens:
                              response.usage.completionTokens || 0,
                          totalTokens: response.usage.totalTokens || 0,
                      }
                    : undefined,
        };

        // Convert to LLMResponse format with type assertion
        return {
            content: result.content,
            toolCalls: result.toolCalls,
            usage: result.usage
                ? {
                      promptTokens: result.usage.promptTokens,
                      completionTokens: result.usage.completionTokens,
                      totalTokens: result.usage.totalTokens,
                  }
                : undefined,
        } as LLMResponse;
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // 🔧 UTILITY METHODS
    // ──────────────────────────────────────────────────────────────────────────────

    getLLM(): LangChainLLM {
        return this.llm;
    }

    setLLM(llm: LangChainLLM): void {
        this.llm = llm;
        this.logger.info('LangChain LLM updated', { name: llm.name });
    }

    supportsStreaming(): boolean {
        return typeof this.llm.stream === 'function';
    }

    supportsToolCalling(): boolean {
        // Most modern LangChain LLMs support tool calling
        // This is a heuristic check
        return true;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 🏭 FACTORY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

export function createLangChainProvider(llm: LangChainLLM): LangChainProvider {
    return new LangChainProvider(llm);
}

// ──────────────────────────────────────────────────────────────────────────────
// 🎯 HELPER FUNCTIONS FOR COMMON LANGCHAIN LLMS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Create provider for OpenAI via LangChain
 */
export function createOpenAIProvider(
    openaiLLM: LangChainLLM,
): LangChainProvider {
    return new LangChainProvider(openaiLLM);
}

/**
 * Create provider for Anthropic via LangChain
 */
export function createAnthropicProvider(
    anthropicLLM: LangChainLLM,
): LangChainProvider {
    return new LangChainProvider(anthropicLLM);
}

/**
 * Create provider for any LangChain LLM
 */
export function createGenericLangChainProvider(
    llm: LangChainLLM,
): LangChainProvider {
    return new LangChainProvider(llm);
}
