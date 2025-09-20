import {
    createLogger,
    getObservability,
    startExecutionTracking,
    completeExecutionTracking,
    failExecutionTracking,
    addExecutionStep,
} from '../../observability/index.js';
import { EngineError } from '../../core/errors.js';
import { AgentCore } from './agent-core.js';
import { MemoryManager } from '../../core/memory/index.js';
import {
    AgentCoreConfig,
    AgentDefinition,
    AgentExecutionOptions,
    AgentExecutionResult,
    AgentLifecycleResult,
    AgentPausePayload,
    AgentResumePayload,
    AgentSchedulePayload,
    AgentStartPayload,
    AgentStopPayload,
    AgentThought,
} from '../../core/types/allTypes.js';
import { ToolEngine } from '../tools/tool-engine.js';
import { ContextService } from '../../core/contextNew/context-service.js';

/**
 * Engine para execução direta de agentes
 * Execução simples, rápida, sem workflow overhead
 */
export class AgentEngine<
    TInput = unknown,
    TOutput = unknown,
    TContent = unknown,
> extends AgentCore<TInput, TOutput, TContent> {
    protected readonly engineLogger = createLogger('agent-engine');

    // ✅ ADICIONAR: MemoryManager para Engine Layer
    private memoryManager?: MemoryManager;
    private executionTrackingId?: string;

    constructor(
        definition: AgentDefinition<TInput, TOutput, TContent>,
        toolEngine?: ToolEngine,
        config?: AgentCoreConfig & {
            memoryManager?: MemoryManager; // ✅ ADICIONAR: MemoryManager opcional
        },
    ) {
        super(definition, toolEngine, config);

        // ✅ ADICIONAR: Inicializar MemoryManager se fornecido
        this.memoryManager = config?.memoryManager;

        this.engineLogger.info('AgentEngine created', {
            agentName: definition.name,
            mode: 'direct-execution',
            hasMemoryManager: !!this.memoryManager,
        });
    }

    async execute(
        input: TInput,
        agentExecutionOptions: AgentExecutionOptions,
    ): Promise<AgentExecutionResult> {
        const { correlationId, sessionId } = agentExecutionOptions;
        const obs = getObservability();

        // Start execution tracking
        const agentName = this.getDefinition()?.name || 'unknown-agent';
        this.executionTrackingId = startExecutionTracking(
            agentName,
            correlationId || 'unknown',
            {
                sessionId,
                tenantId: agentExecutionOptions?.tenantId,
                threadId: agentExecutionOptions?.thread?.id,
            },
            input,
        );

        addExecutionStep(this.executionTrackingId, 'start', 'agent-engine', {
            inputType: typeof input,
            hasOptions: !!agentExecutionOptions,
        });

        try {
            const definition = this.getDefinition();

            if (!definition) {
                this.engineLogger.error(
                    '❌ AGENT ENGINE - Agent definition not found',
                    new Error('Agent definition not found'),
                    {
                        correlationId,
                        trace: {
                            source: 'agent-engine',
                            step: 'definition-not-found',
                            timestamp: Date.now(),
                        },
                    },
                );
                throw new EngineError(
                    'AGENT_ERROR',
                    'Agent definition not found',
                );
            }

            const result = await obs.traceAgent(
                definition.name,
                async () =>
                    this.executeAgent(definition, input, agentExecutionOptions),
                {
                    correlationId,
                    tenantId: agentExecutionOptions.tenantId,
                    sessionId: agentExecutionOptions.sessionId,
                    userId: agentExecutionOptions.userContext?.userId,
                    input: input,
                },
            );

            this.engineLogger.debug(
                '📊 AGENT ENGINE - Core execution completed',
                {
                    agentName: definition.name,
                    correlationId,
                    success: result.success,
                    hasOutput: !!result.output,
                    hasReasoning: !!result.reasoning,
                    trace: {
                        source: 'agent-engine',
                        step: 'core-execution-done',
                        timestamp: Date.now(),
                    },
                },
            );

            // Format response if available
            if (definition.formatResponse) {
                const formattedOutput = definition.formatResponse({
                    reasoning: result.reasoning || '',
                    action: {
                        type: 'final_answer',
                        content: result.output,
                    },
                } as AgentThought<TContent>);

                // Complete execution tracking on success
                if (this.executionTrackingId) {
                    addExecutionStep(
                        this.executionTrackingId,
                        'finish',
                        'agent-engine',
                        {
                            hasOutput: !!result.output,
                            outputType: typeof result.output,
                            formattedResponse: true,
                        },
                    );
                    completeExecutionTracking(
                        this.executionTrackingId,
                        formattedOutput,
                    );
                }

                return {
                    ...result,
                    output: formattedOutput,
                    data: formattedOutput,
                };
            }

            // Complete execution tracking on success (no formatting)
            if (this.executionTrackingId) {
                addExecutionStep(
                    this.executionTrackingId,
                    'finish',
                    'agent-engine',
                    {
                        hasOutput: !!result.output,
                        outputType: typeof result.output,
                        formattedResponse: false,
                    },
                );
                completeExecutionTracking(
                    this.executionTrackingId,
                    result.output,
                );
            }

            // 🆕 Coerência de fase na sessão: marcar como 'completed'
            try {
                const threadId = agentExecutionOptions.thread?.id;
                if (threadId) {
                    await ContextService.updateExecution(threadId, {
                        status: 'success',
                        phase: 'completed',
                        // limpar indicador de tool em execução, se houver
                        currentTool: undefined,
                        correlationId,
                    } as any);
                }
            } catch {}

            return result as AgentExecutionResult;
        } catch (error) {
            // 🆕 Atualizar sessão em caso de erro: phase='error' e limpar currentTool
            try {
                const threadId = agentExecutionOptions.thread?.id;
                if (threadId) {
                    await ContextService.updateExecution(threadId, {
                        status: 'error',
                        phase: 'error',
                        currentTool: undefined,
                        correlationId,
                    } as any);
                }
            } catch {}
            // Fail execution tracking on error
            if (this.executionTrackingId) {
                addExecutionStep(
                    this.executionTrackingId,
                    'error',
                    'agent-engine',
                    {
                        errorName: (error as Error).name,
                        errorMessage: (error as Error).message,
                    },
                );
                failExecutionTracking(this.executionTrackingId, error as Error);
            }

            this.engineLogger.error('Agent execution failed', error as Error, {
                agentName: this.getDefinition()?.name,
                correlationId,
                sessionId,
                executionTrackingId: this.executionTrackingId,
            });

            throw error;
        }
    }

    async executeWithValidation(
        input: unknown,
        options: AgentExecutionOptions,
    ): Promise<AgentExecutionResult> {
        const definition = this.getDefinition();
        if (!definition) {
            throw new EngineError('AGENT_ERROR', 'Agent definition not found');
        }

        if (definition.validateInput) {
            if (!definition.validateInput(input)) {
                throw new EngineError('AGENT_ERROR', 'Invalid input for agent');
            }
        }

        return this.execute(input as TInput, options);
    }

    async start(payload: AgentStartPayload): Promise<AgentLifecycleResult> {
        this.engineLogger.info('Agent engine lifecycle started', { payload });
        return {
            success: true,
            agentName: payload.agentName,
            operation: 'start',
            previousStatus: 'stopped',
            currentStatus: 'running',
            duration: 0,
            metadata: { executionTime: 0, transitionValid: true },
        };
    }

    /**
     * Stop agent lifecycle (direct execution - no workflow)
     */
    async stop(payload: AgentStopPayload): Promise<AgentLifecycleResult> {
        this.engineLogger.info('Agent engine lifecycle stopped', { payload });
        return {
            success: true,
            agentName: payload.agentName,
            operation: 'stop',
            previousStatus: 'running',
            currentStatus: 'stopped',
            duration: 0,
            metadata: { executionTime: 0, transitionValid: true },
        };
    }

    /**
     * Pause agent lifecycle (direct execution - no workflow)
     */
    async pause(payload: AgentPausePayload): Promise<AgentLifecycleResult> {
        this.engineLogger.info('Agent engine lifecycle paused', { payload });
        return {
            success: true,
            agentName: payload.agentName,
            operation: 'pause',
            previousStatus: 'running',
            currentStatus: 'paused',
            duration: 0,
            metadata: { executionTime: 0, transitionValid: true },
        };
    }

    /**
     * Resume agent lifecycle (direct execution - no workflow)
     */
    async resume(payload: AgentResumePayload): Promise<AgentLifecycleResult> {
        this.engineLogger.info('Agent engine lifecycle resumed', { payload });
        return {
            success: true,
            agentName: payload.agentName,
            operation: 'resume',
            previousStatus: 'paused',
            currentStatus: 'running',
            duration: 0,
            metadata: { executionTime: 0, transitionValid: true },
        };
    }

    /**
     * Schedule agent lifecycle (direct execution - no workflow)
     */
    async schedule(
        payload: AgentSchedulePayload,
    ): Promise<AgentLifecycleResult> {
        this.engineLogger.info('Agent engine lifecycle scheduled', { payload });
        return {
            success: true,
            agentName: payload.agentName,
            operation: 'schedule',
            previousStatus: 'stopped',
            currentStatus: 'scheduled',
            duration: 0,
            metadata: { executionTime: 0, transitionValid: true },
        };
    }
}

export function createAgent<
    TInput = unknown,
    TOutput = unknown,
    TContent = unknown,
>(
    definition: AgentDefinition<TInput, TOutput, TContent>,
    config?: AgentCoreConfig,
): AgentEngine<TInput, TOutput, TContent> {
    return new AgentEngine(definition, undefined, config);
}
