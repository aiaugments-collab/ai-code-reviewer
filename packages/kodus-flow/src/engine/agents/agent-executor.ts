import {
    createLogger,
    startExecutionTracking,
    completeExecutionTracking,
    failExecutionTracking,
    addExecutionStep,
} from '../../observability/index.js';
import { EngineError } from '../../core/errors.js';
import { IdGenerator } from '../../utils/id-generator.js';

import { AgentCore } from './agent-core.js';

import { AgentLifecycleHandler } from './agent-lifecycle.js';
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

export class AgentExecutor<
    TInput = unknown,
    TOutput = unknown,
    TContent = unknown,
> extends AgentCore<TInput, TOutput, TContent> {
    protected readonly executorLogger = createLogger('agent-executor');
    private workflowExecutionId?: string;
    private isPaused = false;
    private pauseReason?: string;
    private snapshotId?: string;
    private executionTrackingId?: string;

    // Usar o AgentLifecycleHandler existente
    private lifecycleHandler: AgentLifecycleHandler;

    constructor(
        definition: AgentDefinition<TInput, TOutput, TContent>,
        toolEngine?: ToolEngine,
        config?: AgentCoreConfig,
    ) {
        super(definition, toolEngine, config);

        // Inicializar o lifecycle handler existente
        this.lifecycleHandler = new AgentLifecycleHandler();

        this.executorLogger.info('AgentExecutor created', {
            agentName: definition.name,
            mode: 'workflow-execution',
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 🎯 PUBLIC EXECUTION INTERFACE
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Executar agente via workflow (com lifecycle)
     */
    async executeViaWorkflow(
        input: TInput,
        options: AgentExecutionOptions,
    ): Promise<AgentExecutionResult> {
        const correlationId =
            options?.correlationId || IdGenerator.correlationId();
        const sessionId = options?.sessionId;
        this.workflowExecutionId = IdGenerator.executionId();

        if (!this.executionTrackingId) {
            const agentName = this.getDefinition()?.name || 'unknown-agent';
            this.executionTrackingId = startExecutionTracking(
                agentName,
                correlationId,
                {
                    sessionId,
                    tenantId: options?.tenantId,
                    threadId: options?.thread?.id,
                },
                input,
            );

            addExecutionStep(
                this.executionTrackingId,
                'start',
                'agent-executor',
                {
                    workflowExecutionId: this.workflowExecutionId,
                    inputType: typeof input,
                    hasOptions: !!options,
                },
            );
        }

        const agentName = this.getDefinition()?.name || 'unknown-agent';
        this.executorLogger.info('Agent workflow execution started', {
            agentName,
            correlationId,
            sessionId,
            workflowExecutionId: this.workflowExecutionId,
            executionTrackingId: this.executionTrackingId,
            inputType: typeof input,
        });

        try {
            const definition = this.getDefinition();
            if (!definition) {
                throw new EngineError(
                    'AGENT_ERROR',
                    'Agent definition not found',
                );
            }

            // Check if execution is paused
            if (this.isPaused) {
                throw new EngineError(
                    'AGENT_ERROR',
                    `Agent execution is paused: ${this.pauseReason}`,
                );
            }

            // Execute using shared core logic
            const result = await this.executeAgent(definition, input, options);

            // Format response if available
            if (definition.formatResponse) {
                const formattedOutput = definition.formatResponse({
                    reasoning: result.reasoning || '',
                    action: {
                        type: 'final_answer',
                        content: result.output,
                    },
                } as AgentThought<TContent>);

                return {
                    ...result,
                    output: formattedOutput,
                    data: formattedOutput,
                };
            }

            // Complete execution tracking on success
            if (this.executionTrackingId) {
                addExecutionStep(
                    this.executionTrackingId,
                    'finish',
                    'agent-executor',
                    {
                        workflowExecutionId: this.workflowExecutionId,
                        hasOutput: !!result.output,
                        outputType: typeof result.output,
                    },
                );
                completeExecutionTracking(
                    this.executionTrackingId,
                    result.output,
                );
            }

            // ✅ Atualizar sessão para coerência de fase no modo workflow
            try {
                const threadId = options.thread?.id;
                if (threadId) {
                    await ContextService.updateExecution(threadId, {
                        status: 'success',
                        phase: 'completed',
                        currentTool: undefined,
                        correlationId: options.correlationId,
                    } as any);
                }
            } catch {}

            return result as AgentExecutionResult;
        } catch (error) {
            // Fail execution tracking on error
            if (this.executionTrackingId) {
                addExecutionStep(
                    this.executionTrackingId,
                    'error',
                    'agent-executor',
                    {
                        workflowExecutionId: this.workflowExecutionId,
                        errorName: (error as Error).name,
                        errorMessage: (error as Error).message,
                    },
                );
                failExecutionTracking(this.executionTrackingId, error as Error);
            }

            // ✅ Atualizar sessão em caso de erro
            try {
                const threadId = options.thread?.id;
                if (threadId) {
                    await ContextService.updateExecution(threadId, {
                        status: 'error',
                        phase: 'error',
                        currentTool: undefined,
                        correlationId: options.correlationId,
                    } as any);
                }
            } catch {}

            this.logError(
                'Agent workflow execution failed',
                error as Error,
                'workflow-execution',
                {
                    workflowExecutionId: this.workflowExecutionId,
                    executionTrackingId: this.executionTrackingId,
                },
            );

            throw error;
        }
    }

    /**
     * Executar agente com input validado
     */
    async executeWithValidation(
        input: unknown,
        options: AgentExecutionOptions,
    ): Promise<AgentExecutionResult> {
        const definition = this.getDefinition();
        if (!definition) {
            throw new EngineError('AGENT_ERROR', 'Agent definition not found');
        }

        // Validate input if validation function exists
        if (definition.validateInput) {
            if (!definition.validateInput(input)) {
                throw new EngineError('AGENT_ERROR', 'Invalid input for agent');
            }
        }

        return this.executeViaWorkflow(input as TInput, options);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 🔄 WORKFLOW LIFECYCLE INTERFACE (USA AGENTLIFECYCLEHANDLER EXISTENTE)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Start agent lifecycle (usa AgentLifecycleHandler)
     */
    async start(payload: AgentStartPayload): Promise<AgentLifecycleResult> {
        this.executorLogger.info('Starting agent executor lifecycle', {
            payload,
        });

        // Usar o AgentLifecycleHandler existente
        const event = {
            id: `start-${Date.now()}`,
            type: 'agent.lifecycle.start',
            threadId: `lifecycle-${Date.now()}`,
            data: payload,
            ts: Date.now(),
        };

        await this.lifecycleHandler.handleLifecycleEvent(event);

        // Reset workflow state
        this.isPaused = false;
        this.pauseReason = undefined;
        this.snapshotId = undefined;

        return {
            success: true,
            agentName: payload.agentName,
            operation: 'start',
            previousStatus: 'stopped',
            currentStatus: 'running',
            duration: 0,
            metadata: {
                executionTime: 0,
                transitionValid: true,
            },
        };
    }

    /**
     * Stop agent lifecycle (usa AgentLifecycleHandler)
     */
    async stop(payload: AgentStopPayload): Promise<AgentLifecycleResult> {
        this.executorLogger.info('Stopping agent executor lifecycle', {
            payload,
        });

        // Usar o AgentLifecycleHandler existente
        const event = {
            id: `stop-${Date.now()}`,
            type: 'agent.lifecycle.stop',
            threadId: `lifecycle-${Date.now()}`,
            data: payload,
            ts: Date.now(),
        };

        await this.lifecycleHandler.handleLifecycleEvent(event);

        // Clear workflow state
        this.isPaused = false;
        this.pauseReason = undefined;
        this.snapshotId = undefined;
        this.workflowExecutionId = undefined;

        return {
            success: true,
            agentName: payload.agentName,
            operation: 'stop',
            previousStatus: 'running',
            currentStatus: 'stopped',
            duration: 0,
            metadata: {
                executionTime: 0,
                transitionValid: true,
                forceUsed: payload.force,
            },
        };
    }

    /**
     * Pause agent lifecycle (usa AgentLifecycleHandler)
     */
    async pause(payload: AgentPausePayload): Promise<AgentLifecycleResult> {
        this.executorLogger.info('Pausing agent executor lifecycle', {
            payload,
        });

        // Usar o AgentLifecycleHandler existente
        const event = {
            id: `pause-${Date.now()}`,
            type: 'agent.lifecycle.pause',
            threadId: `lifecycle-${Date.now()}`,
            data: payload,
            ts: Date.now(),
        };

        const result = await this.lifecycleHandler.handleLifecycleEvent(event);

        // Update workflow state
        this.isPaused = true;
        this.pauseReason = payload.reason;
        this.snapshotId = (result.data as { snapshotId?: string })?.snapshotId;

        return {
            success: true,
            agentName: payload.agentName,
            operation: 'pause',
            previousStatus: 'running',
            currentStatus: 'paused',
            duration: 0,
            metadata: {
                executionTime: 0,
                transitionValid: true,
                snapshotId: this.snapshotId,
            },
        };
    }

    /**
     * Resume agent lifecycle (usa AgentLifecycleHandler)
     */
    async resume(payload: AgentResumePayload): Promise<AgentLifecycleResult> {
        this.executorLogger.info('Resuming agent executor lifecycle', {
            payload,
        });

        // Usar o AgentLifecycleHandler existente
        const event = {
            id: `resume-${Date.now()}`,
            type: 'agent.lifecycle.resume',
            threadId: `lifecycle-${Date.now()}`,
            data: payload,
            ts: Date.now(),
        };

        await this.lifecycleHandler.handleLifecycleEvent(event);

        // Update workflow state
        this.isPaused = false;
        this.pauseReason = undefined;
        this.snapshotId = payload.snapshotId;

        return {
            success: true,
            agentName: payload.agentName,
            operation: 'resume',
            previousStatus: 'paused',
            currentStatus: 'running',
            duration: 0,
            metadata: {
                executionTime: 0,
                transitionValid: true,
            },
        };
    }

    /**
     * Schedule agent lifecycle (usa AgentLifecycleHandler)
     */
    async schedule(
        payload: AgentSchedulePayload,
    ): Promise<AgentLifecycleResult> {
        this.executorLogger.info('Scheduling agent executor lifecycle', {
            payload,
        });

        // Usar o AgentLifecycleHandler existente
        const event = {
            id: `schedule-${Date.now()}`,
            type: 'agent.lifecycle.schedule',
            threadId: `lifecycle-${Date.now()}`,
            data: payload,
            ts: Date.now(),
        };

        await this.lifecycleHandler.handleLifecycleEvent(event);

        return {
            success: true,
            agentName: payload.agentName,
            operation: 'schedule',
            previousStatus: 'stopped',
            currentStatus: 'scheduled',
            duration: 0,
            metadata: {
                executionTime: 0,
                transitionValid: true,
            },
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 🔄 WORKFLOW-SPECIFIC METHODS
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Pause current execution
     */
    async pauseExecution(reason?: string): Promise<string> {
        if (!this.workflowExecutionId) {
            throw new EngineError(
                'AGENT_ERROR',
                'No active workflow execution to pause',
            );
        }

        this.isPaused = true;
        this.pauseReason = reason;

        // Create snapshot
        this.snapshotId = `snapshot-${Date.now()}`;

        this.executorLogger.info('Workflow execution paused', {
            workflowExecutionId: this.workflowExecutionId,
            reason,
            snapshotId: this.snapshotId,
        });

        return this.snapshotId;
    }

    /**
     * Resume execution from snapshot
     */
    async resumeExecution(snapshotId?: string): Promise<void> {
        if (!this.workflowExecutionId) {
            throw new EngineError(
                'AGENT_ERROR',
                'No active workflow execution to resume',
            );
        }

        if (!this.isPaused) {
            throw new EngineError(
                'AGENT_ERROR',
                'Workflow execution is not paused',
            );
        }

        // Restore snapshot
        const targetSnapshotId = snapshotId || this.snapshotId;
        if (targetSnapshotId) {
            // TODO: Implement actual snapshot restoration
            this.executorLogger.debug('Snapshot restored', {
                snapshotId: targetSnapshotId,
            });
        }

        this.isPaused = false;
        this.pauseReason = undefined;

        this.executorLogger.info('Workflow execution resumed', {
            workflowExecutionId: this.workflowExecutionId,
            snapshotId: targetSnapshotId,
        });
    }

    /**
     * Get workflow execution status
     */
    getWorkflowStatus(): {
        workflowExecutionId?: string;
        isPaused: boolean;
        pauseReason?: string;
        snapshotId?: string;
        lifecycleStatus: string;
    } {
        return {
            workflowExecutionId: this.workflowExecutionId,
            isPaused: this.isPaused,
            pauseReason: this.pauseReason,
            snapshotId: this.snapshotId,
            lifecycleStatus: 'running', // TODO: Get from lifecycle handler
        };
    }

    /**
     * Get execution statistics
     */
    getExecutionStats(): {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        pausedExecutions: number;
        averageExecutionTime: number;
        lastExecutionTime?: number;
        totalPauseTime: number;
    } {
        // TODO: Implement actual statistics tracking
        return {
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            pausedExecutions: 0,
            averageExecutionTime: 0,
            totalPauseTime: 0,
        };
    }

    /**
     * Get lifecycle handler stats
     */
    getLifecycleStats() {
        return this.lifecycleHandler.getStats();
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 🏭 FACTORY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Create workflow agent with pause/resume support
 */
export function createWorkflowAgent<
    TInput = unknown,
    TOutput = unknown,
    TContent = unknown,
>(
    definition: AgentDefinition<TInput, TOutput, TContent>,
    config?: AgentCoreConfig,
): AgentExecutor<TInput, TOutput, TContent> {
    return new AgentExecutor(definition, undefined, config);
}
