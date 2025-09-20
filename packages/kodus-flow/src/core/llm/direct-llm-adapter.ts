import {
    createLogger,
    getObservability,
    markSpanOk,
    applyErrorToSpan,
} from '../../observability/index.js';
import { normalizeLLMContent } from './normalizers.js';
import {
    SPAN_NAMES,
    createLLMCallSpan,
    GEN_AI_SYSTEM,
} from '../../observability/semantic-conventions.js';
import { EngineError } from '../errors.js';
import {
    AgentInputEnum,
    DEFAULT_LLM_SETTINGS,
    LangChainLLM,
    LangChainMessage,
    LangChainOptions,
    LLMAdapter,
    LLMRequest,
    LLMResponse,
    PlanningResult,
    ToolMetadataForLLM,
} from '../types/allTypes.js';

export class DirectLLMAdapter implements LLMAdapter {
    private llm: LangChainLLM;
    private logger = createLogger('direct-llm-adapter');

    constructor(langchainLLM: LangChainLLM) {
        this.llm = langchainLLM;

        this.logger.info('Direct LLM adapter initialized (SIMPLIFIED)', {
            llmName: langchainLLM.name || 'unknown-llm',
            hasStreaming: typeof langchainLLM.stream === 'function',
        });
    }

    analyzeContext(): Promise<{
        intent: string;
        urgency: 'low' | 'normal' | 'high';
        complexity: 'simple' | 'medium' | 'complex';
        selectedTool: string;
        confidence: number;
        reasoning: string;
    }> {
        throw new Error('Method not implemented.');
    }

    extractParameters(): Promise<Record<string, unknown>> {
        throw new Error('Method not implemented.');
    }

    generateResponse(): Promise<string> {
        throw new Error('Method not implemented.');
    }

    async createPlan(
        goal: string,
        technique: string = 'cot',
        context?: {
            systemPrompt?: string;
            userPrompt?: string;
            tools?: ToolMetadataForLLM[];
            previousPlans?: PlanningResult[];
            constraints?: string[];
            model?: string;
            temperature?: number;
            maxTokens?: number;
            maxReasoningTokens?: number;
            stop?: string[];
            signal?: AbortSignal;
        },
    ): Promise<PlanningResult> {
        const options: LangChainOptions = {
            ...DEFAULT_LLM_SETTINGS,
            model: context?.model,
            temperature:
                typeof context?.temperature === 'number'
                    ? context?.temperature
                    : DEFAULT_LLM_SETTINGS.temperature,
            maxTokens:
                typeof context?.maxTokens === 'number'
                    ? context?.maxTokens
                    : 20000,
            maxReasoningTokens: context?.maxReasoningTokens,
            stop: context?.stop ?? DEFAULT_LLM_SETTINGS.stop,
        };

        if (context?.tools && context.tools.length > 0) {
            options.tools = context.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            }));
            options.toolChoice = 'auto';
        }

        const systemPrompt =
            context?.systemPrompt ||
            `You are an AI assistant using the ${technique} planning technique.`;
        const userPrompt = context?.userPrompt || `Goal: ${goal}`;

        const messages: LangChainMessage[] = [
            {
                role: AgentInputEnum.SYSTEM,
                content: systemPrompt,
            },
            {
                role: AgentInputEnum.USER,
                content: userPrompt,
            },
        ];

        try {
            const obs = getObservability();
            // Prefer explicit model from context for observability naming
            const resolvedModelName =
                context?.model || this.llm.name || 'unknown';
            const providerName = this.normalizeProviderName(resolvedModelName);
            const spanOptions = createLLMCallSpan(
                providerName,
                resolvedModelName,
                {
                    operation: technique,
                    temperature: options.temperature,
                    maxTokens: options.maxTokens,
                },
            );
            spanOptions.attributes = {
                ...spanOptions.attributes,
                correlationId: obs.getContext()?.correlationId || '',
            };
            const span = obs.startSpan(SPAN_NAMES.LLM_CHAT, spanOptions);

            const response = await getObservability().withSpan(
                span,
                async () => {
                    try {
                        const res = await this.llm.call(messages, {
                            ...options,
                            signal: context?.signal,
                        });
                        // Record usage if present
                        if (typeof res !== 'string' && res?.usage) {
                            const usage = res.usage;
                            if (usage?.totalTokens !== undefined) {
                                span.setAttribute(
                                    'gen_ai.usage.total_tokens',
                                    usage.totalTokens,
                                );
                            }
                            if (usage?.promptTokens !== undefined) {
                                span.setAttribute(
                                    'gen_ai.usage.input_tokens',
                                    usage.promptTokens,
                                );
                            }
                            if (usage?.completionTokens !== undefined) {
                                span.setAttribute(
                                    'gen_ai.usage.output_tokens',
                                    usage.completionTokens,
                                );
                            }
                        }
                        markSpanOk(span);
                        return res;
                    } catch (err) {
                        applyErrorToSpan(
                            span,
                            err instanceof Error ? err : new Error(String(err)),
                        );
                        throw err;
                    }
                },
            );

            return response as any;
        } catch (error) {
            this.logger.error(
                'Planning failed',
                error instanceof Error ? error : new Error('Unknown error'),
            );
            throw new EngineError(
                'LLM_ERROR',
                `Planning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    /**
     * ✅ AJV: Parse planning response with industry-standard validation
     */
    // private parseFlexiblePlanningResponse(
    //     response: unknown,
    //     goal: string,
    //     technique: string,
    // ): PlanningResult {
    //     const llmValidated = validateLLMResponse(response);

    //     let extractedSteps: Array<{
    //         id: string;
    //         description: string;
    //         tool?: string;
    //         arguments?: Record<string, unknown>;
    //         dependencies?: string[];
    //         type:
    //             | 'analysis'
    //             | 'action'
    //             | 'decision'
    //             | 'observation'
    //             | 'verification';
    //     }> = [];
    //     let extractedReasoning = '';
    //     let extractedSignals: Record<string, unknown> = {};
    //     let extractedAudit: string[] = [];

    //     if (llmValidated.toolCalls && llmValidated.toolCalls.length > 0) {
    //         this.logger.debug('Extracting steps from function calls', {
    //             toolCallsCount: llmValidated.toolCalls.length,
    //         });

    //         extractedSteps = llmValidated?.toolCalls?.map((call, index) => {
    //             let parsedArgs: Record<string, unknown> = {};
    //             try {
    //                 parsedArgs = JSON.parse(call.function.arguments);
    //             } catch (error) {
    //                 this.logger.warn('Failed to parse tool call arguments', {
    //                     toolName: call.function.name,
    //                     arguments: call.function.arguments,
    //                     error,
    //                 });
    //             }

    //             return {
    //                 id: call.id || `step-${index + 1}`,
    //                 description: `Execute ${call.function.name}`,
    //                 tool: call.function.name,
    //                 arguments: parsedArgs,
    //                 dependencies: index > 0 ? [`step-${index}`] : [],
    //                 type: 'action' as const,
    //             };
    //         });

    //         extractedReasoning =
    //             llmValidated.content || 'Generated from function calls';
    //     } else {
    //         // Traditional text parsing: use AJV validation
    //         this.logger.debug('Extracting steps from text parsing', {
    //             hasContent: !!llmValidated.content,
    //         });

    //         const validated = validatePlanningResponse(response);
    //         extractedSteps = validated.steps || [];
    //         extractedReasoning = validated.reasoning || '';
    //         extractedSignals = validated.signals || {};
    //         extractedAudit = validated.audit || [];
    //     }

    //     return {
    //         strategy: technique,
    //         goal,
    //         steps: extractedSteps,
    //         reasoning: extractedReasoning,
    //         signals: extractedSignals,
    //         audit: extractedAudit,
    //     };
    // }

    supportsStreaming(): boolean {
        return typeof this.llm.stream === 'function';
    }

    getName(): string {
        return this.llm.name || 'unknown-llm';
    }

    getProvider?(): { name: string } {
        return { name: this.llm.name || 'unknown' };
    }

    private normalizeProviderName(name: string): string {
        const n = (name || 'unknown').toLowerCase();
        if (n.includes('openai') || n === 'gpt' || n.startsWith('gpt-'))
            return GEN_AI_SYSTEM.OPENAI;
        if (n.includes('anthropic') || n.includes('claude'))
            return GEN_AI_SYSTEM.ANTHROPIC;
        if (n.includes('google') || n.includes('gemini'))
            return GEN_AI_SYSTEM.GOOGLE;
        if (n.includes('groq')) return GEN_AI_SYSTEM.GROQ;
        if (n.includes('together')) return GEN_AI_SYSTEM.TOGETHER;
        if (n.includes('replicate')) return GEN_AI_SYSTEM.REPLICATE;
        if (n.includes('hugging')) return GEN_AI_SYSTEM.HUGGINGFACE;
        return n;
    }

    // ✅ COMPATIBILITY: LLMAdapter interface compliance
    async call(request: LLMRequest): Promise<LLMResponse> {
        const messages: LangChainMessage[] = request.messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
        }));

        const options: LangChainOptions = {
            ...DEFAULT_LLM_SETTINGS,
            model: request.model,
            temperature:
                request.temperature ?? DEFAULT_LLM_SETTINGS.temperature,
            maxTokens: request.maxTokens ?? DEFAULT_LLM_SETTINGS.maxTokens,
            maxReasoningTokens: request.maxReasoningTokens,
            stop: request.stop ?? DEFAULT_LLM_SETTINGS.stop,
            signal: request.signal,
        };

        try {
            const obs = getObservability();
            // Prefer explicit model from request for observability naming
            const resolvedModelName =
                request.model || this.llm.name || 'unknown';
            const providerName = this.normalizeProviderName(resolvedModelName);
            const spanOptions = createLLMCallSpan(
                providerName,
                resolvedModelName,
                {
                    operation: 'chat',
                    temperature: options.temperature,
                    maxTokens: options.maxTokens,
                },
            );
            spanOptions.attributes = {
                ...spanOptions.attributes,
                correlationId: obs.getContext()?.correlationId || '',
            };
            const span = obs.startSpan(SPAN_NAMES.LLM_CHAT, spanOptions);
            const response = await getObservability().withSpan(
                span,
                async () => {
                    const res = await this.llm.call(messages, options);

                    // Normalize usage (supports LangSmith usage_metadata string)
                    if (typeof res !== 'string') {
                        const usageRaw: any =
                            (res as any).usage ||
                            (res as any).usage_metadata ||
                            (res as any).additionalKwargs?.usage ||
                            (res as any).additionalKwargs?.usage_metadata;

                        let usageObj: any | null = null;
                        if (usageRaw) {
                            if (typeof usageRaw === 'string') {
                                try {
                                    usageObj = JSON.parse(usageRaw);
                                } catch {
                                    usageObj = null;
                                }
                            } else if (typeof usageRaw === 'object') {
                                usageObj = usageRaw;
                            }
                        }

                        if (usageObj) {
                            const promptTokens =
                                usageObj.promptTokens ??
                                usageObj.input_tokens ??
                                usageObj.inputTokens ??
                                usageObj.input_token_details?.text;
                            const completionTokens =
                                usageObj.completionTokens ??
                                usageObj.output_tokens ??
                                usageObj.outputTokens ??
                                usageObj.output_token_details?.text;
                            const reasoningTokens =
                                usageObj.reasoningTokens ??
                                usageObj.output_token_details?.reasoning;
                            const totalTokens =
                                usageObj.totalTokens ??
                                usageObj.total_tokens ??
                                (typeof promptTokens === 'number' &&
                                typeof completionTokens === 'number'
                                    ? promptTokens + completionTokens
                                    : undefined);

                            if (totalTokens !== undefined)
                                span.setAttribute(
                                    'gen_ai.usage.total_tokens',
                                    totalTokens,
                                );
                            if (promptTokens !== undefined)
                                span.setAttribute(
                                    'gen_ai.usage.input_tokens',
                                    promptTokens,
                                );
                            if (completionTokens !== undefined)
                                span.setAttribute(
                                    'gen_ai.usage.output_tokens',
                                    completionTokens,
                                );
                            if (reasoningTokens !== undefined)
                                span.setAttribute(
                                    'gen_ai.usage.reasoning_tokens',
                                    reasoningTokens,
                                );

                            (res as any).__normalized_usage = {
                                promptTokens: promptTokens ?? 0,
                                completionTokens: completionTokens ?? 0,
                                totalTokens: totalTokens ?? 0,
                                reasoningTokens: reasoningTokens ?? undefined,
                            };
                        }
                    }
                    return res;
                },
            );
            const content = normalizeLLMContent(response as unknown);

            let usage: LLMResponse['usage'] | undefined = undefined;
            if (typeof response !== 'string') {
                const norm = (response as any).__normalized_usage;
                if (norm) {
                    usage = norm;
                } else if ((response as any).usage) {
                    const u = (response as any).usage;
                    usage = {
                        promptTokens: u.promptTokens ?? 0,
                        completionTokens: u.completionTokens ?? 0,
                        totalTokens: u.totalTokens ?? 0,
                        reasoningTokens: (u as any).reasoningTokens,
                    };
                }
            }

            return { content, usage } as LLMResponse;
        } catch (error) {
            this.logger.error('Direct call failed', error as Error);
            throw error;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 🏭 FACTORY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

export function createDirectLLMAdapter(
    langchainLLM: LangChainLLM,
): DirectLLMAdapter {
    return new DirectLLMAdapter(langchainLLM);
}

/**
 * Helper para migração de código existente
 */
export function createLLMAdapter(langchainLLM: LangChainLLM): DirectLLMAdapter {
    return createDirectLLMAdapter(langchainLLM);
}
