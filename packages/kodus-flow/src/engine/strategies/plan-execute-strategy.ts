import { LLMAdapter } from '../../core/types/allTypes.js';
import { createLogger, getObservability } from '../../observability/index.js';
import { SPAN_NAMES } from '../../observability/semantic-conventions.js';
import { BaseExecutionStrategy } from './strategy-interface.js';
import { SharedStrategyMethods } from './shared-methods.js';
import type {
    StrategyExecutionContext,
    ExecutionResult,
    ExecutionStep,
} from './types.js';
import { StrategyPromptFactory } from './prompts/index.js';
import { ContextService } from '../../core/contextNew/index.js';
import { EnhancedJSONParser } from '../../utils/json-parser.js';
import { isEnhancedError } from '../../core/error-unified.js';

/**
 * Plan-Execute Strategy - Planejamento + Execução Sequencial
 *
 * ✅ ESTRATÉGIA MAIS SIMPLES E DIRETA
 *
 * Implementação focada em:
 * - ✅ Planejamento inteligente de tarefas
 * - ✅ Execução sequencial e confiável
 * - ✅ Menos chamadas LLM (performance)
 * - ✅ Arquitetura mais simples de manter
 */
export class PlanExecuteStrategy extends BaseExecutionStrategy {
    private readonly logger = createLogger('plan-execute-strategy');
    private readonly promptFactory: StrategyPromptFactory;

    private readonly config: {
        maxPlanningSteps: number;
        maxExecutionSteps: number;
        maxToolCalls: number;
        maxExecutionTime: number;
        enablePlanningValidation: boolean;
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
        options: Partial<{
            llmAdapter: LLMAdapter;
            maxPlanningSteps: number;
            maxExecutionSteps: number;
            maxToolCalls: number;
            maxExecutionTime: number;
            enablePlanningValidation: boolean;
        }> = {},
    ) {
        super();

        // Inicializar prompt factory
        this.promptFactory = new StrategyPromptFactory();

        // Configurações padrão
        const defaultConfig = {
            maxPlanningSteps: 10,
            maxExecutionSteps: 15,
            maxToolCalls: 25,
            maxExecutionTime: 300000, // 5 minutos
            enablePlanningValidation: true,
        };

        this.config = { ...defaultConfig, ...options } as any;
        this.llmDefaults = (options as any)?.llmDefaults;

        this.logger.info('🗓️ Plan-Execute Strategy initialized', {
            config: this.config,
        });
    }

    /**
     * Método principal - executa o padrão Plan-Execute completo
     */
    async execute(context: StrategyExecutionContext): Promise<ExecutionResult> {
        const startTime = Date.now();
        const steps: ExecutionStep[] = [];
        let toolCallsCount = 0;

        // ✅ CORREÇÃO: Usar traceAgent para toda execução da estratégia
        return await getObservability().traceAgent(
            'plan-execute-strategy',
            async () => {
                try {
                    this.validateContext(context);

                    // Fase 1: PLAN - Criar plano de execução
                    const planStepStart = Date.now();
                    const plan = await this.createPlan(context);
                    steps.push({
                        id: `plan-${planStepStart}`,
                        type: 'plan' as any,
                        type2: 'plan',
                        timestamp: planStepStart,
                        duration: Date.now() - planStepStart,
                        status: 'completed',
                        thought2: `Created plan with ${plan.steps?.length || 0} steps`,
                        result2: plan,
                    });

                    // Fase 2: EXECUTE - Executar plano step by step
                    const executionResults = await this.executePlan(
                        plan,
                        context,
                        startTime,
                    );
                    steps.push(...executionResults.steps);
                    toolCallsCount = executionResults.toolCallsCount;

                    // Fase 3: FINALIZE - Criar resultado final
                    const finalResult = this.buildFinalResult(
                        plan,
                        executionResults.steps,
                        startTime,
                        toolCallsCount,
                    );

                    const execTime = Date.now() - startTime;
                    return {
                        ...finalResult,
                        executionTime: execTime,
                        steps,
                    };
                } catch (error) {
                    return this.buildErrorResult(
                        error,
                        steps,
                        startTime,
                        toolCallsCount,
                    );
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

    /**
     * Validação do contexto de entrada
     */
    private validateContext(context: StrategyExecutionContext): void {
        if (!context.input?.trim()) {
            throw new Error('Input cannot be empty');
        }

        if (!Array.isArray(context.agentContext?.availableTools)) {
            throw new Error('Tools must be an array');
        }

        if (!context.agentContext) {
            throw new Error('Agent context is required');
        }

        this.logger.debug('Context validation passed', {
            inputLength: context.input.length,
            toolsCount: context.agentContext?.availableTools?.length || 0,
            hasAgentContext: !!context.agentContext,
        });
    }

    /**
     * Cria plano de execução baseado no input e ferramentas disponíveis
     */
    private async createPlan(context: StrategyExecutionContext): Promise<any> {
        if (!this.llmAdapter.createPlan) {
            throw new Error('LLM adapter must support createPlan method');
        }

        // // 🔥 PADRONIZADO: Usar método consistente para additionalContext
        // const additionalContext = this.buildStandardAdditionalContext(context);

        // // Usar nova arquitetura de prompts
        const prompts = this.promptFactory.createPlanExecutePrompt(context);

        const response = await getObservability().trace(
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
            {
                attributes: {
                    planner: 'plan-execute',
                    agent: context.agentContext.agentName,
                },
            },
        );

        const parsed = this.parsePlanResponse((response as any)?.content);
        return parsed;
    }

    /**
     * Executa plano step by step
     */
    private async executePlan(
        plan: any,
        context: StrategyExecutionContext,
        startTime: number,
    ): Promise<{ steps: ExecutionStep[]; toolCallsCount: number }> {
        const executedSteps: ExecutionStep[] = [];
        let toolCallsCount = 0;

        if (!plan.steps || plan.steps.length === 0) {
            this.logger.warn('Plan has no steps to execute');
            return { steps: executedSteps, toolCallsCount };
        }

        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i];

            // Verificar timeout
            if (Date.now() - startTime > this.config.maxExecutionTime) {
                this.logger.warn('Plan execution timeout reached');
                break;
            }

            // Verificar limite de tool calls
            if (toolCallsCount >= this.config.maxToolCalls) {
                this.logger.warn('Max tool calls reached');
                break;
            }

            const stepResult = await getObservability().trace(
                SPAN_NAMES.AGENT_ACT,
                async () => this.executePlanStep(step, context, i),
                {
                    attributes: {
                        stepIndex: i,
                        stepType: String(step.type || 'unknown'),
                        agent: context.agentContext.agentName,
                    } as any,
                },
            );
            // Update session execution (completed step)
            try {
                const threadId = context.agentContext.thread?.id;
                if (threadId && stepResult?.id) {
                    await ContextService.updateExecution(threadId, {
                        completedSteps: [stepResult.id as string],
                        status: 'in_progress',
                        currentStep: {
                            id: stepResult.id as string,
                            status: 'completed',
                        },
                        stepsJournalAppend: {
                            stepId: stepResult.id as string,
                            type: String(step.type || 'execute'),
                            status: 'completed',
                            endedAt: Date.now(),
                            startedAt: (stepResult as any).timestamp,
                            durationMs: (stepResult as any).duration,
                        },
                        correlationId:
                            getObservability().getContext()?.correlationId,
                    });
                }
            } catch {}
            executedSteps.push(stepResult);

            if (
                stepResult.metadata?.toolCalls &&
                Array.isArray(stepResult.metadata.toolCalls)
            ) {
                toolCallsCount += stepResult.metadata.toolCalls.length;
            }
        }

        return { steps: executedSteps, toolCallsCount };
    }

    /**
     * Executa um step individual do plano
     */
    private async executePlanStep(
        planStep: any,
        context: StrategyExecutionContext,
        stepIndex: number,
    ): Promise<ExecutionStep> {
        const stepStartTime = Date.now();

        const step: ExecutionStep = {
            id: `plan-execute-step-${stepIndex}-${Date.now()}`,
            type: 'execute',
            type2: 'execute',
            timestamp: stepStartTime,
            duration: 0,
            metadata: {
                planStep,
                stepIndex,
                strategy: 'plan-execute',
            },
        };

        try {
            const result = await this.executeStepAction(planStep, context);
            step.result = result;
            step.status = 'completed';

            if (step.metadata) {
                step.metadata.success = true;
            }
        } catch (error) {
            step.status = 'failed';
            step.error = error instanceof Error ? error.message : String(error);

            // Register failure in steps journal
            try {
                const threadId = context.agentContext.thread?.id;
                if (threadId) {
                    const subcode = isEnhancedError(error as any)
                        ? (error as any).context?.subcode
                        : undefined;
                    await ContextService.updateExecution(threadId, {
                        status: 'error',
                        stepsJournalAppend: {
                            stepId: step.id,
                            type: String(planStep.type || 'execute'),
                            status: 'failed',
                            endedAt: Date.now(),
                            errorSubcode:
                                subcode ||
                                (error instanceof Error ? error.name : 'Error'),
                        },
                        correlationId:
                            getObservability().getContext()?.correlationId,
                    });
                }
            } catch {}

            if (step.metadata) {
                step.metadata.success = false;
                step.metadata.error = step.error;
            }
        }

        step.duration = Date.now() - stepStartTime;
        return step;
    }

    /**
     * Executa ação baseada no tipo do step
     */
    private async executeStepAction(
        planStep: any,
        context: StrategyExecutionContext,
    ): Promise<any> {
        if (planStep.type === 'tool_call') {
            return await this.executeToolStep(planStep, context);
        } else if (planStep.type === 'final_answer') {
            return {
                type: 'final_answer',
                content: planStep.content || 'Task completed',
                metadata: {
                    timestamp: Date.now(),
                    source: 'plan-execute-strategy',
                },
            };
        } else {
            throw new Error(`Unknown step type: ${planStep.type}`);
        }
    }

    /**
     * Executa step de tool call
     */
    private async executeToolStep(
        planStep: any,
        context: StrategyExecutionContext,
    ): Promise<any> {
        if (!planStep.toolName) {
            throw new Error('Tool step missing toolName');
        }

        const tool = context.agentContext?.availableTools.find(
            (t) => t.name === planStep.toolName,
        );
        if (!tool) {
            throw new Error(`Tool not found: ${planStep.toolName}`);
        }

        const action = {
            type: 'tool_call' as const,
            toolName: planStep.toolName,
            input: planStep.input || {},
        };

        // Usar SharedStrategyMethods para execução consistente
        const startedAt = Date.now();
        const result = await SharedStrategyMethods.executeTool(action, context);

        // Track tool usage in session
        try {
            const threadId = context.agentContext.thread?.id;
            if (threadId) {
                await ContextService.updateExecution(threadId, {
                    currentTool: planStep.toolName,
                    status: 'in_progress',
                    stepsJournalAppend: {
                        stepId: `plan-exec-tool-${Date.now()}`,
                        type: 'tool_call',
                        toolName: planStep.toolName,
                        status: 'completed',
                        endedAt: Date.now(),
                        startedAt,
                        durationMs: Date.now() - startedAt,
                    },
                    correlationId:
                        getObservability().getContext()?.correlationId,
                });
            }
        } catch {}

        return {
            type: 'tool_result',
            content: result,
            metadata: {
                toolName: planStep.toolName,
                arguments: action.input,
                executionTime: Date.now(),
            },
        };
    }

    /**
     * Faz parse da resposta do LLM para extrair o plano
     */
    private parsePlanResponse(content: string): any {
        if (!content) {
            throw new Error('Empty plan response from LLM');
        }

        // Try parsing with enhanced parser
        const parseResult = EnhancedJSONParser.parseWithValidation(
            content,
            (
                data: unknown,
            ): data is {
                goal: string;
                reasoning: string;
                steps: unknown[];
            } => {
                return (
                    typeof data === 'object' &&
                    data !== null &&
                    'goal' in data &&
                    'reasoning' in data &&
                    'steps' in data &&
                    typeof (data as any).goal === 'string' &&
                    typeof (data as any).reasoning === 'string' &&
                    Array.isArray((data as any).steps)
                );
            },
        );

        if (parseResult.success) {
            const parsed = parseResult.data;

            return {
                goal: parsed.goal,
                steps: parsed.steps,
                reasoning: parsed.reasoning,
            };
        } else {
            this.logger.error(
                `Enhanced JSON parse failed - invalid plan format: ${parseResult.error}`,
            );

            throw new Error(
                `Invalid JSON response from LLM: ${parseResult.error}. Expected format: {"goal": "...", "reasoning": "...", "steps": [...]} `,
            );
        }
    }

    /**
     * Formata ferramentas disponíveis para o LLM
     */
    private getAvailableToolsFormatted(
        context: StrategyExecutionContext,
    ): any[] {
        if (!context.agentContext?.availableTools) {
            return [];
        }

        return context.agentContext.availableTools.map((tool) => ({
            name: tool.name,
            description: tool.description || `Tool: ${tool.name}`,
            parameters: tool.inputSchema || {
                type: 'object',
                properties: {},
                required: [],
            },
        }));
    }

    /**
     * Constrói resultado de sucesso
     */
    private buildFinalResult(
        plan: any,
        steps: ExecutionStep[],
        startTime: number,
        toolCallsCount: number,
    ): ExecutionResult {
        const executionTime = Date.now() - startTime;

        // Extrair resultado final
        const finalResult = this.extractFinalResult(steps);

        this.logger.info('🎯 Plan-Execute execution completed successfully', {
            planSteps: plan.steps?.length || 0,
            executedSteps: steps.length,
            executionTime,
            toolCalls: toolCallsCount,
        });

        return {
            output: finalResult,
            strategy: 'plan-execute',
            complexity: steps.length,
            executionTime,
            steps,
            success: true,
            metadata: {
                planSteps: plan.steps?.length || 0,
                executedSteps: steps.length,
                toolCallsCount,
                planReasoning: plan.reasoning,
            },
        };
    }

    /**
     * Constrói resultado de erro
     */
    private buildErrorResult(
        error: unknown,
        steps: ExecutionStep[],
        startTime: number,
        toolCallsCount: number,
    ): ExecutionResult {
        const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
        const executionTime = Date.now() - startTime;

        this.logger.error(
            '❌ Plan-Execute execution failed',
            error instanceof Error ? error : undefined,
            {
                stepsCompleted: steps.length,
                toolCalls: toolCallsCount,
                executionTime,
            },
        );

        return {
            output: null,
            strategy: 'plan-execute',
            complexity: steps.length,
            executionTime,
            steps,
            success: false,
            error: errorMessage,
            metadata: {
                toolCallsCount,
                failureReason: errorMessage,
            },
        };
    }

    /**
     * Extrai resultado final da execução
     */
    private extractFinalResult(steps: ExecutionStep[]): unknown {
        // Procurar pela última resposta final
        for (let i = steps.length - 1; i >= 0; i--) {
            const step = steps[i];
            if (step?.result?.type === 'final_answer' && step.result.content) {
                return step.result.content;
            }
            if (step?.result?.type === 'tool_result' && step.result.content) {
                return step.result.content;
            }
        }

        return 'Plan execution completed without explicit final result';
    }

    /**
     * 🔥 CREATE FINAL RESPONSE - Uses ContextBridge for complete context
     */
    async createFinalResponse(
        context: StrategyExecutionContext,
    ): Promise<string> {
        this.logger.info(
            '🗓️ Plan-Execute: Creating final response with ContextBridge',
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
                        'plan-execute-final-response',
                    tenantId: context.agentContext.tenantId || 'default',
                    thread: context.agentContext.thread || {
                        id: context.agentContext.sessionId || 'unknown',
                    },
                    startTime: context.metadata?.startTime || Date.now(),
                    enhancedContext: (context.agentContext as any)
                        ?.enhancedRuntimeContext,
                },
                agentContext: context.agentContext,
                isComplete: true,
                update: () => {},
                getCurrentSituation: () =>
                    `Plan-Execute strategy completed for: ${context.input}`,
                getFinalResult: () => ({
                    success: true,
                    result: { content: 'Plan-Execute execution completed' },
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
                '✅ ContextBridge: Complete context retrieved for Plan-Execute',
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
                '🎯 Plan-Execute: Final response created with full context',
                {
                    responseLength: response.length,
                    contextSource: 'ContextBridge',
                },
            );

            return response;
        } catch (error) {
            this.logger.error(
                '❌ Plan-Execute: ContextBridge failed, using fallback response',
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

    // /**
    //  * 🔥 PADRONIZADO: Método consistente para formatar additionalContext
    //  * Ensures all prompts use consistent context data
    //  */
    // private buildStandardAdditionalContext(
    //     context: StrategyExecutionContext,
    // ): Record<string, unknown> {
    //     // Try to parse userContext as JSON if it's a string
    //     let userContext =
    //         context.agentContext?.agentExecutionOptions?.userContext;

    //     if (typeof userContext === 'string') {
    //         try {
    //             userContext = JSON.parse(userContext);
    //         } catch (error) {
    //             this.logger.warn('Failed to parse userContext as JSON', {
    //                 error,
    //             });
    //         }
    //     }

    //     return {
    //         // Framework agnóstico - tudo do usuário fica dentro de userContext
    //         userContext,
    //         agentIdentity: context.agentContext?.agentIdentity,
    //         agentExecutionOptions: context.agentContext?.agentExecutionOptions,
    //         // Runtime context para compatibilidade futura
    //         runtimeContext: (context.agentContext as any)
    //             ?.enhancedRuntimeContext,
    //     };
    // }

    /**
     * Build contextual response using complete FinalResponseContext from ContextBridge
     */
    private buildContextualResponse(
        finalContext: any,
        originalInput: string,
    ): string {
        const { runtime, executionSummary, recovery } = finalContext;

        let response = `Through systematic planning and execution`;

        // Add context about what was accomplished
        if (executionSummary.totalExecutions > 0) {
            response += `, I've completed ${executionSummary.totalExecutions} planned executions`;

            if (executionSummary.successRate < 100) {
                response += ` with ${executionSummary.successRate}% success rate`;
            }
        }

        // Reference entities if available
        const entityTypes = Object.keys(runtime.entities).filter(
            (key: string) => {
                const entities = runtime.entities[key];
                return Array.isArray(entities) && entities.length > 0;
            },
        );

        if (entityTypes.length > 0) {
            response += `, working with ${entityTypes.join(', ')}`;
        }

        // Mention recovery if it happened
        if (recovery?.wasRecovered) {
            const gapMinutes = Math.round(recovery.gapDuration / 60000);
            response += ` (session recovered after ${gapMinutes}min gap)`;
        }

        // Add conversation context
        if (runtime.messages.length > 2) {
            response += ` based on our ${runtime.messages.length} message conversation`;
        }

        // Add specific response to the original input
        response += `. For your request: "${originalInput}"`;

        // Add completion message
        response += ` - I've applied the Plan-Execute approach of systematic planning followed by reliable step-by-step execution to provide you with a comprehensive response.`;

        return response;
    }

    /**
     * Fallback response when ContextBridge is not available
     */
    private buildFallbackResponse(context: StrategyExecutionContext): string {
        return (
            `I've processed your request: "${context.input}" using the Plan-Execute strategy. ` +
            `Through systematic planning and step-by-step execution, I've completed the task.`
        );
    }
}
