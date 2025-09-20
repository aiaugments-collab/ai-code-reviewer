import { LLMAdapter } from '../../core/types/allTypes.js';
import { RewooEvidenceItem } from './prompts/index.js';
import { createLogger, getObservability } from '../../observability/index.js';
import { BaseExecutionStrategy } from './strategy-interface.js';
import { SharedStrategyMethods } from './shared-methods.js';
import type {
    StrategyExecutionContext,
    ExecutionResult,
    ExecutionStep,
} from './types.js';
import { StrategyPromptFactory } from './prompts/index.js';
import { SPAN_NAMES } from '../../observability/semantic-conventions.js';
import { ContextService } from '../../core/contextNew/index.js';
import { EnhancedJSONParser } from '../../utils/json-parser.js';
import { isEnhancedError } from '../../core/error-unified.js';

function safeJsonParse<T = any>(text: string): T | null {
    try {
        const result = EnhancedJSONParser.parse(text);
        return result as T;
    } catch {
        return null;
    }
}

export class ReWooStrategy extends BaseExecutionStrategy {
    private readonly logger = createLogger('rewoo-strategy');
    private readonly promptFactory: StrategyPromptFactory;

    private readonly config = {
        maxPlanningSteps: 10,
        maxExecutionSteps: 15,
        maxToolCalls: 25,
        maxExecutionTime: 300000, // 5 minutos
        enablePlanValidation: true,
    };
    private readonly llmDefaults?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        maxReasoningTokens?: number;
        stop?: string[];
    };

    constructor(
        private llmAdapter: LLMAdapter,
        options: {
            maxPlanningSteps?: number;
            maxExecutionSteps?: number;
            maxToolCalls?: number;
            maxExecutionTime?: number;
            enablePlanValidation?: boolean;
            llmAdapter?: LLMAdapter;
        } = {},
    ) {
        super();

        // Inicializar prompt factory
        this.promptFactory = new StrategyPromptFactory();

        const defaultConfig = {
            maxPlanningSteps: 10,
            maxExecutionSteps: 15,
            maxToolCalls: 25,
            maxExecutionTime: 300000,
            enablePlanValidation: true,
        };

        this.config = { ...defaultConfig, ...options } as any;
        this.llmDefaults = (options as any)?.llmDefaults;

        this.logger.info('🏗️ ReWoo Strategy initialized', {
            config: this.config,
        });
    }

    defaultRewooConfig: Required<any> = {
        topKSketches: 4,
        maxParallelWork: 4,
        overallTimeoutMs: 120_000,
        perWorkTimeoutMs: 25_000,
        perLLMTimeoutMs: 20_000,
        maxVerifyPasses: 1,
        requireEvidenceAnchors: true,
        temperatureSketch: 0.4,
        temperatureOrganize: 0.3,
        temperatureVerify: 0.2,
    };
    async execute(context: StrategyExecutionContext): Promise<ExecutionResult> {
        const start = Date.now();
        const steps: ExecutionStep[] = [];
        const config = { ...this.defaultRewooConfig };

        // ✅ CORREÇÃO: Usar traceAgent para toda execução da estratégia
        return await getObservability().traceAgent(
            'rewoo-strategy',
            async () => {
                try {
                    // 1) SKETCH --------------------------------------------------
                    const sketchStepStart = Date.now();
                    const sketches = await this.sketch(context, config).catch(
                        (e) => {
                            throw new Error(
                                `Sketch failed: ${e instanceof Error ? e.message : String(e)}`,
                            );
                        },
                    );
                    steps.push({
                        id: `sketch-${sketchStepStart}`,
                        type: 'sketch' as any,
                        type2: 'sketch',
                        timestamp: sketchStepStart,
                        duration: Date.now() - sketchStepStart,
                        status: 'completed',
                        thought2: `Generated ${sketches.length} sub-questions`,
                        result2: sketches,
                    });

                    // 2) WORK (parallel tools) -----------------------------------
                    const workStart = Date.now();
                    const evidences = await this.work(
                        sketches,
                        context,
                        config,
                    );
                    steps.push({
                        id: `work-${workStart}`,
                        type: 'work' as any,
                        type2: 'work',
                        timestamp: workStart,
                        duration: Date.now() - workStart,
                        status: 'completed',
                        result2: evidences,
                    });

                    // 3) ORGANIZE -------------------------------------------------
                    const organizeStart = Date.now();
                    const organized = await this.organize(
                        context,
                        evidences,
                        config,
                    ).catch((e) => {
                        throw new Error(
                            `Organize failed: ${e instanceof Error ? e.message : String(e)}`,
                        );
                    });
                    steps.push({
                        id: `organize-${organizeStart}`,
                        type: 'organize' as any,
                        type2: 'organize',
                        timestamp: organizeStart,
                        duration: Date.now() - organizeStart,
                        status: 'completed',
                        result2: organized,
                    });

                    // 4) VERIFY (optional loop) ----------------------------------
                    const finalAnswer = organized.answer;
                    // let verification: RewooVerificationReport | null = null;

                    // for (let pass = 0; pass < config.maxVerifyPasses; pass++) {
                    //     const verifyStart = Date.now();
                    //     verification = await this.verify(
                    //         ctx.input,
                    //         organized,
                    //         evidences,
                    //         config,
                    //     ).catch(() => null);
                    //     steps.push({
                    //         id: `verify-${verifyStart}`,
                    //         type: 'verify',
                    //         timestamp: verifyStart,
                    //         duration: Date.now() - verifyStart,
                    //         status: verification ? 'completed' : 'failed',
                    //         result: verification ?? {
                    //             verified: false,
                    //             score: 0,
                    //             issues: ['verification failed'],
                    //         },
                    //     });

                    //     if (!verification) break;
                    //     if (verification.verified && verification.score >= 0.75) {
                    //         finalAnswer = verification.normalizedAnswer || organized.answer;
                    //         break;
                    //     }

                    //     // If not verified, attempt a single corrective organize using issues
                    //     if (verification.issues && verification.issues.length) {
                    //         const corrective = await this.organize(
                    //             ctx.input +
                    //                 '\nConstraints:' +
                    //                 verification.issues.join('; '),
                    //             evidences,
                    //             config,
                    //         ).catch(() => organized);
                    //         organized.answer = corrective.answer;
                    //         organized.citations = corrective.citations;
                    //         organized.confidence = Math.max(
                    //             organized.confidence,
                    //             corrective.confidence,
                    //         );
                    //         finalAnswer = organized.answer;
                    //     }
                    // }

                    const execTime = Date.now() - start;
                    return {
                        output: finalAnswer,
                        success: true,
                        strategy: 'rewoo',
                        steps,
                        executionTime: execTime,
                        complexity: steps.length,
                        metadata: {
                            citations: organized.citations,
                            // TODO: Revisar confidence.
                            // confidence: (verification?.score ?? organized.confidence) || 0,
                            evidenceCount: evidences.length,
                        },
                    };
                } catch (error) {
                    this.logger.error(
                        '❌ ReWoo strategy execution failed',
                        error instanceof Error ? error : undefined,
                    );
                    return {
                        output: null,
                        success: false,
                        strategy: 'rewoo',
                        steps,
                        executionTime: Date.now() - start,
                        complexity: steps.length,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    };
                }
            },
            {
                correlationId: context.agentContext.correlationId,
                tenantId: context.agentContext.tenantId,
                sessionId: context.agentContext.sessionId,
                input: context.input,
            },
        );
    }

    private async sketch(
        context: StrategyExecutionContext,
        cfg: any,
    ): Promise<any[]> {
        if (!this.llmAdapter.createPlan) {
            throw new Error('LLM adapter must support createPlan method');
        }

        context.mode = 'planner';
        const prompts = this.promptFactory.createReWooPrompt(context);

        const res = await getObservability().trace(
            SPAN_NAMES.AGENT_PLAN,
            async () =>
                this.llmAdapter.createPlan!(context.input, 'plan-execute', {
                    systemPrompt: prompts.systemPrompt,
                    userPrompt: prompts.userPrompt,
                    tools: this.getAvailableToolsFormatted(context),
                    model: this.llmDefaults?.model,
                    temperature: this.llmDefaults?.temperature,
                    maxTokens: this.llmDefaults?.maxTokens,
                    maxReasoningTokens: this.llmDefaults?.maxReasoningTokens,
                    stop: this.llmDefaults?.stop,
                    signal: context.agentContext?.signal,
                }),
            { attributes: { phase: 'sketch' } },
        );
        const parsed = safeJsonParse<{ sketches: Array<any> }>(
            (res as any)?.content,
        ) || {
            sketches: [],
        };
        // console.log('parsed', parsed); // Commented out for production
        // sanitize & cap
        const unique: any[] = [];
        const seen = new Set<string>();
        for (const s of parsed.sketches.slice(0, cfg.topKSketches)) {
            const id = s.id?.trim() || `S${unique.length + 1}`;
            if (seen.has(id)) continue;
            seen.add(id);
            unique.push({
                id,
                query: s.query?.trim() || '',
                tool: s.tool || undefined,
                arguments: s.arguments || undefined,
            });
        }
        // Empty sketches array is valid for simple requests (greetings, etc.)
        // Only log when we get empty sketches to understand the model's decision
        if (!unique.length) {
            this.logger?.debug(
                "Model returned no sketches - likely simple request that doesn't need tools",
            );
            return []; // Return empty array instead of throwing error
        }
        return unique;
    }

    private async work(
        sketches: any[],
        ctx: StrategyExecutionContext,
        cfg: any,
    ): Promise<RewooEvidenceItem[]> {
        // If no sketches, return empty array (no work to do)
        if (!sketches || sketches.length === 0) {
            this.logger?.debug(
                'No sketches to execute - returning empty evidence array',
            );
            return [];
        }

        const evidences: RewooEvidenceItem[] = [];
        const toolMap = new Map(
            ctx.agentContext?.availableTools.map((t) => [t.name, t] as const),
        );

        // Simple concurrency gate
        const queue = [...sketches];
        const workers: Promise<void>[] = [];

        const runOne = async (sk: any, index: number) => {
            const tool =
                (sk.tool && toolMap.get(sk.tool)) ||
                ctx.agentContext?.availableTools[0]; // fallback to first tool if not provided
            const evId = `E${index + 1}`;
            const began = Date.now();
            const input = (sk.arguments ?? { query: sk.query }) as Record<
                string,
                unknown
            >;
            let output: unknown;
            let error: string | undefined;
            try {
                // 🔥 USAR SHARED METHODS PARA EXECUÇÃO DE TOOLS
                const action = {
                    type: 'tool_call' as const,
                    toolName: tool.name,
                    input: input,
                };

                output = await SharedStrategyMethods.executeTool(action, ctx);
                // Track tool usage in session
                try {
                    const threadId = ctx.agentContext.thread?.id;
                    if (threadId) {
                        await ContextService.updateExecution(threadId, {
                            currentTool: tool.name,
                            status: 'in_progress',
                            stepsJournalAppend: {
                                stepId: `rewoo-work-${evId}`,
                                type: 'tool_call',
                                toolName: tool.name,
                                status: 'completed',
                                endedAt: Date.now(),
                                startedAt: began,
                                durationMs: Date.now() - began,
                            },
                            correlationId:
                                getObservability().getContext()?.correlationId,
                        });
                    }
                } catch {}
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
                // Track failure in session journal
                try {
                    const threadId = ctx.agentContext.thread?.id;
                    if (threadId) {
                        const subcode = isEnhancedError(e as any)
                            ? (e as any).context?.subcode
                            : undefined;
                        await ContextService.updateExecution(threadId, {
                            status: 'error',
                            stepsJournalAppend: {
                                stepId: `rewoo-work-${evId}`,
                                type: 'tool_call',
                                toolName: tool.name,
                                status: 'failed',
                                endedAt: Date.now(),
                                startedAt: began,
                                durationMs: Date.now() - began,
                                errorSubcode:
                                    subcode ||
                                    (e instanceof Error ? e.name : 'Error'),
                            },
                            correlationId:
                                getObservability().getContext()?.correlationId,
                        });
                    }
                } catch {}
            }
            evidences.push({
                id: evId,
                sketchId: sk.id,
                toolName: tool.name,
                input,
                output,
                error,
                latencyMs: Date.now() - began,
            });
        };

        while (queue.length || workers.length) {
            while (queue.length && workers.length < cfg.maxParallelWork) {
                const sk = queue.shift()!;
                const p = runOne(sk, evidences.length).finally(() => {
                    const i = workers.indexOf(p);
                    if (i >= 0) {
                        void workers.splice(i, 1);
                    }
                });

                // Intentional: managing concurrent promises

                workers.push(p);
            }
            if (workers.length) {
                await Promise.race(workers).catch(() => {});
            }
        }

        return evidences;
    }

    private async organize(
        context: StrategyExecutionContext,
        evidences: RewooEvidenceItem[],
        cfg: any,
    ): Promise<{ answer: string; citations: string[]; confidence: number }> {
        if (!this.llmAdapter.createPlan) {
            throw new Error('LLM adapter must support createPlan method');
        }
        // TODO: Revisar isso
        // runtimeContext: ((context.agentContext as any)?.enhancedRuntimeContext,
        // (context.mode = 'organizer'));
        context.mode = 'organizer';

        const prompts = this.promptFactory.createReWooPrompt(context);

        const res = await getObservability().trace(
            SPAN_NAMES.AGENT_OBSERVE,
            async () =>
                this.llmAdapter.createPlan!(context.input, 'plan-execute', {
                    systemPrompt: prompts.systemPrompt,
                    userPrompt: prompts.userPrompt,
                    tools: [], // Organizer não usa tools
                    model: this.llmDefaults?.model,
                    temperature: this.llmDefaults?.temperature,
                    maxTokens: this.llmDefaults?.maxTokens,
                    maxReasoningTokens: this.llmDefaults?.maxReasoningTokens,
                    stop: this.llmDefaults?.stop,
                    signal: context.agentContext?.signal,
                }),
            { attributes: { phase: 'organize' } },
        );
        const parsed =
            safeJsonParse<{
                answer: string;
                citations?: string[];
                confidence?: number;
            }>((res as any)?.content) || ({ answer: '' } as any);

        // enforce evidence anchors if configured
        const citations = parsed.citations ?? [];
        if (cfg.requireEvidenceAnchors && citations.length === 0) {
            // minimal auto-cite: include all evidence ids seen
            parsed.citations = evidences.map((e) => e.id).slice(0, 6);
        }

        return {
            answer: parsed.answer ?? '',
            citations: parsed.citations ?? [],
            confidence: parsed.confidence ?? 0.5,
        };
    }

    /**
     * 🔥 STANDARDIZED: Use StrategyFormatters like ReAct
     * Ensures consistency in tool formatting between strategies
     */
    private getAvailableToolsFormatted(
        context: StrategyExecutionContext,
    ): Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
    }> {
        if (!context.agentContext?.availableTools) {
            return [];
        }

        // 🔥 PADRONIZADO: Usar mesma lógica de formatação do ReAct
        return context.agentContext.availableTools.map((tool) => ({
            name: tool.name,
            description: tool.description || `Tool: ${tool.name}`,
            parameters: tool.inputSchema || {
                type: 'object',
                properties: {},
                required: [],
            },
            outputSchema: tool.outputSchema || {
                type: 'object',
                properties: {},
                required: [],
            },
        }));
    }

    async createFinalResponse(
        context: StrategyExecutionContext,
    ): Promise<string> {
        this.logger.info(
            '🌉 ReWoo: Creating final response with ContextBridge',
        );

        try {
            // Build PlannerExecutionContext for ContextBridge compatibility
            const plannerContext = {
                input: context.input,
                history: context.history.map((step, index) => ({
                    ...step,
                    stepId: step.id,
                    executionId: `exec-${Date.now()}-${index}`,
                })) as any[],
                iterations: 1,
                maxIterations: this.config.maxExecutionSteps,
                plannerMetadata: {
                    agentName: context.agentContext.agentName,
                    correlationId:
                        context.agentContext.correlationId ||
                        'rewoo-final-response',
                    tenantId: context.agentContext.tenantId || 'default',
                    thread: context.agentContext.thread || {
                        id: context.agentContext.sessionId || 'unknown',
                    },
                    startTime: context.metadata?.startTime || Date.now(),
                    enhancedContext: (context.agentContext as any)
                        .enhancedRuntimeContext,
                },
                agentContext: context.agentContext,
                isComplete: true,
                update: () => {},
                getCurrentSituation: () =>
                    `ReWoo strategy completed for: ${context.input}`,
                getFinalResult: () => ({
                    success: true,
                    result: { content: 'ReWoo execution completed' },
                    iterations: 1,
                    totalTime:
                        Date.now() -
                        (context.metadata?.startTime || Date.now()),
                    thoughts: [],
                    metadata: {
                        ...context.metadata,
                        agentName: context.agentContext.agentName,
                        iterations: 1,
                        toolsUsed: context.metadata?.complexity || 0,
                        thinkingTime:
                            Date.now() -
                            (context.metadata?.startTime || Date.now()),
                    } as any,
                }),
                getCurrentPlan: () => null,
            };

            // 🔥 THE CORE: Use ContextBridge to build complete context
            const finalContext =
                await ContextService.buildFinalResponseContext(plannerContext);

            this.logger.info(
                '✅ ContextBridge: Complete context retrieved for ReWoo',
                {
                    sessionId: finalContext.runtime.sessionId,
                    messagesCount: finalContext.runtime.messages.length,
                    entitiesCount: Object.keys(finalContext.runtime.entities)
                        .length,
                    executionSummary: {
                        totalExecutions:
                            finalContext.executionSummary.totalExecutions,
                        successRate: finalContext.executionSummary.successRate,
                        replanCount: finalContext.executionSummary.replanCount,
                    },
                    wasRecovered: finalContext.recovery?.wasRecovered,
                    inferencesCount: Object.keys(finalContext.inferences || {})
                        .length,
                },
            );

            // Build context-aware response using complete context
            const response = this.buildContextualResponse(
                finalContext,
                context.input,
            );

            this.logger.info(
                '🎯 ReWoo: Final response created with full context',
                {
                    responseLength: response.length,
                    contextSource: 'ContextBridge',
                },
            );

            return response;
        } catch (error) {
            this.logger.error(
                '❌ ReWoo: ContextBridge failed, using fallback response',
                error instanceof Error ? error : undefined,
                {
                    input: context.input,
                    agentName: context.agentContext.agentName,
                },
            );

            // Fallback: Simple response without ContextBridge
            return this.buildFallbackResponse(context);
        }
    }

    /**
     * Build contextual response using complete FinalResponseContext from ContextBridge
     */
    private buildContextualResponse(
        finalContext: any,
        originalInput: string,
    ): string {
        const { runtime, executionSummary, recovery } = finalContext;

        let response = `Based on our conversation`;

        // Add context about what was accomplished
        if (executionSummary.totalExecutions > 0) {
            response += ` and ${executionSummary.totalExecutions} executions`;

            if (executionSummary.successRate < 100) {
                response += ` (${executionSummary.successRate}% success rate)`;
            }
        }

        // Reference entities if available
        const entityTypes = Object.keys(runtime.entities).filter((key) => {
            const entities = runtime.entities[key];
            return Array.isArray(entities) && entities.length > 0;
        });

        if (entityTypes.length > 0) {
            response += `, including work with ${entityTypes.join(', ')}`;
        }

        // Mention recovery if it happened
        if (recovery?.wasRecovered) {
            const gapMinutes = Math.round(recovery.gapDuration / 60000);
            response += ` (session recovered after ${gapMinutes}min gap)`;
        }

        // Add specific response to the original input
        response += `, I've processed your request: "${originalInput}"`;

        // Add completion message
        response += `. The ReWoo strategy has completed successfully, analyzing the task, executing the necessary steps, and synthesizing the results.`;

        return response;
    }

    /**
     * Fallback response when ContextBridge is not available
     */
    private buildFallbackResponse(context: StrategyExecutionContext): string {
        return (
            `I've processed your request: "${context.input}" using the ReWoo strategy. ` +
            `The task has been completed through strategic planning, execution, and synthesis phases.`
        );
    }
}
