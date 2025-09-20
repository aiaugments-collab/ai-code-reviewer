import { createLogger } from '../../observability/index.js';
import { CircuitBreaker } from '../../runtime/core/circuit-breaker.js';
import { EngineError } from '../../core/errors.js';
import { createAgentError } from '../../core/error-unified.js';
import { IdGenerator } from '../../utils/id-generator.js';
import { ContextService } from '../../core/contextNew/index.js';

import {
    AgentCapability,
    AgentContext,
    AgentCoreConfig,
    AgentDefinition,
    AgentExecutionOptions,
    AgentExecutionResult,
    AnyEvent,
    DelegationContext,
    LLMAdapter,
    Planner,
    PlannerExecutionContext,
    PlannerType,
    TrackedMessage,
} from '../../core/types/allTypes.js';
import { ToolEngine } from '../tools/tool-engine.js';
import { SharedStrategyMethods } from '../strategies/shared-methods.js';
import {
    UnifiedExecutionContext,
    ExecutionStrategy,
} from '../strategies/types.js';
import {
    AgentAction,
    PlanExecuteStrategy,
    ReActStrategy,
    ReWooStrategy,
    StrategyFactory,
} from '../strategies/index.js';

export abstract class AgentCore<
    TInput = unknown,
    TOutput = unknown,
    TContent = unknown,
> {
    protected logger: ReturnType<typeof createLogger>;
    protected readonly thinkingTimeout: number;
    protected config: AgentCoreConfig;
    protected eventHistory: AnyEvent[] = [];

    // Single agent mode
    protected singleAgentDefinition?: AgentDefinition<
        TInput,
        TOutput,
        TContent
    >;
    protected toolEngine?: ToolEngine;

    private _agents?: Map<string, AgentDefinition<unknown, unknown, unknown>>;
    private _agentCapabilities?: Map<string, AgentCapability>;
    private _messages?: Map<string, TrackedMessage>;
    private _agentInboxes?: Map<string, TrackedMessage[]>;
    private _activeDelegations?: Map<string, DelegationContext>;
    private _messageHistory?: TrackedMessage[];
    private _deliveryQueue?: TrackedMessage[];
    protected deliveryIntervalId?: NodeJS.Timeout;
    protected isProcessingQueue = false;

    // Removido - dependências de kernel simplificadas

    protected toolCircuitBreaker?: CircuitBreaker;

    private initializeCircuitBreaker(): void {
        const observabilitySystem = {
            logger: this.logger,
            monitoring: {
                recordMetric: () => {},
                recordHistogram: () => {},
                incrementCounter: () => {},
            },
            telemetry: {
                startSpan: () => ({
                    end: () => {},
                    setAttribute: () => ({ end: () => {} }),
                    setAttributes: () => ({ end: () => {} }),
                    setStatus: () => ({ end: () => {} }),
                    recordException: () => ({ end: () => {} }),
                    addEvent: () => ({ end: () => {} }),
                    updateName: () => ({ end: () => {} }),
                }),
                recordException: () => {},
            },
            config: {},
            monitor: {},
            debug: {},
            createContext: () => ({}),
        } as any;

        this.toolCircuitBreaker = new CircuitBreaker(observabilitySystem, {
            name: `tool-execution-${this.config.agentName || 'default'}`,
            failureThreshold: 3, // Open after 3 failures
            recoveryTimeout: 150000, // ✅ Try to recover after 2.5 minutes
            successThreshold: 2, // Close after 2 successes
            operationTimeout: this.config.toolTimeout || 60000, // ✅ 60s timeout
            onStateChange: (newState, prevState) => {
                this.logger.info('Tool circuit breaker state changed', {
                    agentName: this.config.agentName,
                    from: prevState,
                    to: newState,
                });
            },
            onFailure: (error, context) => {
                this.logger.warn('Tool circuit breaker recorded failure', {
                    agentName: this.config.agentName,
                    error: error.message,
                    context,
                });
            },
        });
    }

    // === LAZY INITIALIZATION GETTERS ===
    protected get agents() {
        if (!this._agents) {
            this._agents = new Map<
                string,
                AgentDefinition<unknown, unknown, unknown>
            >();
        }
        return this._agents;
    }

    protected get agentCapabilities() {
        if (!this._agentCapabilities) {
            this._agentCapabilities = new Map<string, AgentCapability>();
        }
        return this._agentCapabilities;
    }

    protected get messages() {
        if (!this._messages) {
            this._messages = new Map<string, TrackedMessage>();
        }
        return this._messages;
    }

    protected get agentInboxes() {
        if (!this._agentInboxes) {
            this._agentInboxes = new Map<string, TrackedMessage[]>();
        }
        return this._agentInboxes;
    }

    protected get activeDelegations() {
        if (!this._activeDelegations) {
            this._activeDelegations = new Map<string, DelegationContext>();
        }
        return this._activeDelegations;
    }

    protected get messageHistory() {
        if (!this._messageHistory) {
            this._messageHistory = [];
        }
        return this._messageHistory;
    }

    protected get deliveryQueue() {
        if (!this._deliveryQueue) {
            this._deliveryQueue = [];
        }
        return this._deliveryQueue;
    }

    protected planner?: Planner;
    protected llmAdapter?: LLMAdapter;
    protected strategy?: ReActStrategy | ReWooStrategy | PlanExecuteStrategy;

    protected executionContext?: PlannerExecutionContext;

    constructor(
        definitionOrConfig:
            | AgentDefinition<TInput, TOutput, TContent>
            | AgentCoreConfig,
        toolEngineOrConfig?: ToolEngine | AgentCoreConfig,
        config?: AgentCoreConfig,
    ) {
        this.logger = createLogger('agent-core');
        this.thinkingTimeout = 1600000; // ✅ 1600s thinking timeout

        if (this.isAgentDefinition(definitionOrConfig)) {
            this.singleAgentDefinition = definitionOrConfig;
            this.toolEngine = toolEngineOrConfig as ToolEngine;
            this.config = config || {
                tenantId: 'default',
                plannerOptions: {
                    type: PlannerType.REWOO,
                },
            };
            this.config.agentName = definitionOrConfig.name;

            // 🔥 Configure SharedStrategyMethods with ToolEngine
            if (this.toolEngine) {
                this.setToolEngine(this.toolEngine);
            }
        } else {
            // Multi-agent mode
            this.config = definitionOrConfig as AgentCoreConfig;
            if (!this.config.tenantId) {
                throw new EngineError(
                    'AGENT_ERROR',
                    'tenantId é obrigatório para modo multi-agent',
                );
            }
        }

        this.config = {
            maxThinkingIterations: 15,
            thinkingTimeout: 1600000, // ✅ 1600s thinking timeout
            timeout: 1600000,
            enableFallback: true,
            maxConcurrentAgents: 10,
            enableMultiAgent: true,
            enableTools: true,
            maxChainDepth: 5,
            enableDelegation: true,
            toolTimeout: 1600000, // ✅ 1600s tool timeout
            maxToolRetries: 2,
            // Advanced multi-agent defaults
            enableAdvancedCoordination: true,
            enableMessaging: true,
            enableMetrics: true,
            maxHistorySize: 10000,
            deliveryRetryInterval: 1000,
            defaultMaxAttempts: 2,
            ...this.config,
        };

        // Setup logger first
        const agentName = this.config.agentName || 'multi-agent';
        this.logger = createLogger(`agent-core:${agentName}`);
        this.initializeCircuitBreaker();

        // Removido - dependências de kernel simplificadas
        this.thinkingTimeout = this.config.thinkingTimeout || 1200000;

        this.initializeStrategyComponents();

        if (this.toolEngine) {
            // ToolEngine configured directly in AgentCore (ContextNew architecture)
            this.logger.info('ToolEngine configured', {
                toolCount: this.toolEngine.listTools().length,
            });

            // 🔥 ContextService availability will be checked during execution
            this.logger.info(
                '✅ ContextService will be verified during execution',
            );
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 🔧 CORE EXECUTION LOGIC (COMPARTILHADA)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Ensure session consistency between enhanced context and options
     */
    private ensureSessionConsistency(
        enhancedRuntimeContext: any,
        agentExecutionOptions: AgentExecutionOptions,
    ): { sessionId: string; threadId: string } {
        const enhancedSessionId = enhancedRuntimeContext?.sessionId;
        const enhancedThreadId = enhancedRuntimeContext?.threadId;
        const optionsSessionId = agentExecutionOptions.sessionId;
        const optionsThreadId = agentExecutionOptions.thread?.id;

        this.logger.debug('🔍 Session consistency check', {
            enhancedSessionId,
            enhancedThreadId,
            optionsSessionId,
            optionsThreadId,
        });

        if (enhancedSessionId && enhancedThreadId) {
            if (optionsThreadId && optionsThreadId !== enhancedThreadId) {
                this.logger.warn(
                    '⚠️ ThreadId mismatch - using enhanced context',
                    {
                        optionsThreadId,
                        enhancedThreadId,
                    },
                );
            }
            return {
                sessionId: enhancedSessionId,
                threadId: enhancedThreadId,
            };
        }

        if (optionsThreadId) {
            this.logger.warn('⚠️ Using fallback sessionId from options', {
                optionsSessionId,
                optionsThreadId,
                reason: 'enhanced_context_incomplete',
            });
            return {
                sessionId: optionsSessionId || optionsThreadId,
                threadId: optionsThreadId,
            };
        }

        const error = new Error(
            'Cannot determine sessionId/threadId - both enhanced context and options are invalid',
        );
        this.logger.error('❌ Session consistency failure', error, {
            enhancedRuntimeContext: !!enhancedRuntimeContext,
            agentExecutionOptions: !!agentExecutionOptions,
        });
        throw error;
    }

    /**
     * Create execution context locally and save to ContextService
     */
    private async createExecutionContext(
        agent: AgentDefinition<any, any, any>,
        input: unknown,
        agentExecutionOptions: AgentExecutionOptions,
    ): Promise<UnifiedExecutionContext> {
        const executionId = IdGenerator.executionId();
        const threadId = agentExecutionOptions.thread.id;
        const { correlationId, tenantId = 'default' } = agentExecutionOptions;

        // 1. Initialize session if needed
        await ContextService.initializeSession(threadId, tenantId);

        // 2. Add user message
        await ContextService.addMessage(threadId, {
            role: 'user' as any,
            content: typeof input === 'string' ? input : JSON.stringify(input),
            metadata: {
                agentName: agent.name,
                correlationId,
                source: 'user-input',
            },
        });

        // 3. Add placeholder assistant message
        const assistantMessageId = await ContextService.addMessage(threadId, {
            role: 'assistant' as any,
            content: '⏳ Processing your request...',
            metadata: {
                agentName: agent.name,
                correlationId,
                status: 'processing',
                source: 'agent-placeholder',
            },
        });

        // 4. Get runtime context from ContextService
        const runtimeContext = await ContextService.getContext(threadId);

        // 4.5 Ensure session consistency
        const { sessionId, threadId: consistentThreadId } =
            this.ensureSessionConsistency(
                runtimeContext,
                agentExecutionOptions,
            );

        // 5. Get tools from ToolEngine
        const availableTools = this.toolEngine?.listTools() || [];

        const agentContext: AgentContext = {
            agentName: agent.name,
            sessionId: sessionId || executionId,
            correlationId: correlationId || '',
            tenantId,
            thread: { id: consistentThreadId || threadId, metadata: {} },
            invocationId: IdGenerator.callId(),
            availableTools: availableTools as any,
            signal:
                agentExecutionOptions.signal || new AbortController().signal,
            agentExecutionOptions,
        };

        if (this.singleAgentDefinition?.identity) {
            agentContext.agentIdentity = this.singleAgentDefinition.identity;
        }

        return {
            input: typeof input === 'string' ? input : JSON.stringify(input),
            executionId,
            threadId: consistentThreadId || threadId,
            runtimeContext,
            history: [],
            agentConfig: {
                agentName: agent.name,
                tenantId,
                correlationId,
                strategy: this.config.plannerOptions.type as ExecutionStrategy,
                maxIterations: this.config.maxThinkingIterations,
            },
            metadata: {
                startTime: Date.now(),
                correlationId: correlationId || undefined,
                assistantMessageId,
            },
            agentContext,
        };
    }

    protected async executeAgent(
        agent:
            | AgentDefinition<TInput, TOutput, TContent>
            | AgentDefinition<unknown, unknown, unknown>,
        input: unknown,
        agentExecutionOptions: AgentExecutionOptions,
    ): Promise<AgentExecutionResult> {
        const startTime = Date.now();
        const { correlationId } = agentExecutionOptions;

        // Create context locally and save to ContextService
        const completeContext = await this.createExecutionContext(
            agent,
            input,
            agentExecutionOptions,
        );

        this.logger.info(
            '🚀 Progressive Persistence: Placeholder message created',
            {
                threadId: completeContext.threadId,
                assistantMessageId: completeContext.metadata.assistantMessageId,
                agentName: agent.name,
                executionId: completeContext.executionId,
            },
        );

        try {
            const result = await this.processAgentThinking(
                agent,
                completeContext,
            );
            const duration = Date.now() - startTime;

            this.logger.info(
                '🔄 Progressive Persistence: Updating with final response',
                {
                    threadId: completeContext.threadId,
                    assistantMessageId:
                        completeContext.metadata.assistantMessageId,
                    hasOutput: !!result.output,
                    outputType: typeof result.output,
                },
            );

            // 🔧 FIX: Ensure full content is transmitted without truncation
            const finalContent =
                typeof result.output === 'string'
                    ? result.output
                    : result.output
                      ? JSON.stringify(result.output, null, 2)
                      : 'Processing completed';

            await ContextService.updateMessage(
                completeContext.threadId,
                completeContext.metadata.assistantMessageId!,
                {
                    content: finalContent,
                    metadata: {
                        agentName: agent.name,
                        correlationId,
                        status: 'completed',
                        success: true,
                        source: 'agent-output',
                    },
                },
            );

            return this.buildExecutionResult(
                result,
                correlationId,
                completeContext.agentContext.sessionId,
                completeContext.executionId,
                duration,
                agent.name,
            );
        } catch (error) {
            this.logger.error(
                '🚨 Progressive Persistence: Updating with error',
                error instanceof Error ? error : undefined,
                {
                    threadId: completeContext.threadId,
                    assistantMessageId:
                        completeContext.metadata.assistantMessageId,
                    errorMessage:
                        error instanceof Error ? error.message : String(error),
                },
            );

            // 🔧 FIX: Ensure full error content is transmitted
            const errorContent = `❌ Error processing your request: ${error instanceof Error ? error.message : String(error)}`;

            await ContextService.updateMessage(
                completeContext.threadId,
                completeContext.metadata.assistantMessageId!,
                {
                    content: errorContent,
                    metadata: {
                        agentName: agent.name,
                        correlationId,
                        status: 'error',
                        success: false,
                        source: 'agent-error',
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                },
            );

            throw error;
        }
    }

    private buildExecutionResult(
        result: {
            output: unknown;
            reasoning: string;
            iterations: number;
            toolsUsed: number;
            events: AnyEvent[];
        },
        correlationId?: string,
        sessionId?: string,
        executionId?: string,
        duration?: number,
        agentName?: string,
    ): AgentExecutionResult & { timeline?: unknown } {
        return {
            success: true,
            data: result.output,
            reasoning: result.reasoning,
            correlationId,
            sessionId,
            status: 'COMPLETED',
            executionId,
            duration: duration || 0,
            metadata: {
                agentName: agentName || 'unknown',
                iterations: result.iterations,
                toolsUsed: result.toolsUsed,
                thinkingTime: duration || 0,
                timeline: null, // Timeline removida
            },
        };
    }

    protected async processAgentThinking(
        agent:
            | AgentDefinition<TInput, TOutput, TContent>
            | AgentDefinition<unknown, unknown, unknown>,
        completeContext: any,
    ): Promise<{
        output: unknown;
        reasoning: string;
        iterations: number;
        toolsUsed: number;
        events: AnyEvent[];
    }> {
        if (!this.strategy || !this.llmAdapter) {
            throw createAgentError(
                `Agent '${agent.name}' requires both planner and LLM adapter`,
                {
                    severity: 'high',
                    domain: 'infrastructure',
                    userImpact: 'broken',
                    retryable: false,
                    recoverable: true,
                    context: {
                        agentName: agent.name,
                        hasStrategy: !!this.strategy,
                        hasLLMAdapter: !!this.llmAdapter,
                    },
                    userMessage:
                        'This agent requires both a planner and AI language model to function.',
                    recoveryHints: [
                        'Provide an LLMAdapter when creating the agent',
                        'Ensure planner is properly initialized',
                        'Check that your LLM provider is properly configured',
                    ],
                },
            );
        }

        const result = await this.executeThinkActObserve(completeContext);

        return {
            output: result,
            //TODO: Revisar
            reasoning: 'Think→Act→Observe completed',
            iterations: 1,
            toolsUsed: 0,
            events: [],
        };
    }

    protected isAgentDefinition(
        obj: unknown,
    ): obj is AgentDefinition<TInput, TOutput, TContent> {
        return (
            typeof obj === 'object' &&
            obj !== null &&
            'name' in obj &&
            'think' in obj
        );
    }

    protected registerAgent(
        agent: AgentDefinition<unknown, unknown, unknown>,
        capabilities?: AgentCapability,
    ): void {
        this.agents.set(agent.name, agent);

        if (capabilities && this.config.enableAdvancedCoordination) {
            this.agentCapabilities.set(agent.name, capabilities);
        }

        if (this.config.enableMessaging && !this.agentInboxes.has(agent.name)) {
            this.agentInboxes.set(agent.name, []);
        }

        this.logger.info('Agent registered', {
            agentName: agent.name,
            totalAgents: this.agents.size,
            hasCapabilities: !!capabilities,
            hasInbox: this.config.enableMessaging,
        });
    }

    protected getActionType(action: AgentAction): string {
        if ('type' in action) {
            return action.type as string;
        }

        // Legacy action type detection
        if ('toolName' in action) {
            return 'tool_call';
        }
        if ('question' in action) {
            return 'need_more_info';
        }
        if ('agentName' in action) {
            return 'delegate_to_agent';
        }
        return 'final_answer';
    }

    /**
     * 🎯 Centralized session message addition (MINIMAL - no toolCalls dump)
     */
    protected async addSessionMessage(
        threadId: string,
        message: {
            role: 'user' | 'assistant' | 'system' | 'tool';
            content: string;
            // 🔥 REMOVED: toolCalls dump - goes to Observability instead
            toolCallId?: string; // Only for tool response messages
            name?: string; // Only for tool response messages
            // 🔥 REMOVED: metadata dump - goes to Observability instead
        },
    ): Promise<void> {
        try {
            // 🎯 CLEAN API: Only essential message data to session
            const sessionMessage = {
                role: message.role,
                content: message.content,
                timestamp: Date.now(),
                ...(message.toolCallId && { toolCallId: message.toolCallId }),
                ...(message.name && { name: message.name }),
            };

            await ContextService.addMessage(threadId, sessionMessage);

            this.logger.debug('✅ Session message added (minimal)', {
                threadId,
                role: message.role,
                contentLength: message.content.length,
                isToolResponse: !!message.toolCallId,
            });
        } catch (error) {
            this.logger.error(
                '❌ Failed to add session message',
                error instanceof Error ? error : undefined,
                {
                    threadId,
                    messageRole: message.role,
                },
            );
            // Don't throw - session updates shouldn't break execution flow
        }
    }

    /**
     * 🎯 NEW: Update context state (phase, intent, iterations)
     */
    protected async updateContextState(
        threadId: string,
        stateUpdate: {
            phase?: 'planning' | 'execution' | 'completed' | 'error';
            lastUserIntent?: string;
            pendingActions?: string[];
            currentStep?: string;
            currentIteration?: number;
            totalIterations?: number;
        },
    ): Promise<void> {
        try {
            await ContextService.updateState(threadId, stateUpdate);

            this.logger.debug('✅ Context state updated', {
                threadId,
                phase: stateUpdate.phase,
                currentIteration: stateUpdate.currentIteration,
                pendingActionsCount: stateUpdate.pendingActions?.length,
            });
        } catch (error) {
            this.logger.error(
                '❌ Failed to update context state',
                error instanceof Error ? error : undefined,
                { threadId },
            );
            // Don't throw - state updates shouldn't break execution flow
        }
    }

    /**
     * 🎯 NEW: Update session execution with MINIMAL state only
     */
    protected async updateSessionExecution(
        threadId: string,
        executionUpdate: {
            status?: 'in_progress' | 'success' | 'error' | 'partial';
            completedSteps?: string[]; // Only step names/IDs
            failedSteps?: string[]; // Only step names/IDs
            currentTool?: string; // Current tool name only
            currentStep?: {
                // Current step state only
                id: string;
                status:
                    | 'pending'
                    | 'executing'
                    | 'completed'
                    | 'failed'
                    | 'skipped';
            };
            toolCallCount?: number; // Simple counter
            iterationCount?: number; // Simple counter
            replanCount?: number; // Simple counter
        },
    ): Promise<void> {
        try {
            await ContextService.updateExecution(threadId, executionUpdate);

            this.logger.debug('✅ Session execution updated (minimal)', {
                threadId,
                status: executionUpdate.status,
                completedSteps: executionUpdate.completedSteps?.length || 0,
                toolCallCount: executionUpdate.toolCallCount,
                iterationCount: executionUpdate.iterationCount,
            });
        } catch (error) {
            this.logger.error(
                '❌ Failed to update session execution',
                error instanceof Error ? error : undefined,
                { threadId },
            );
            // Don't throw - session updates shouldn't break execution flow
        }
    }

    /**
     * 🎯 Centralized session entities addition (eliminates duplications)
     */
    protected async addSessionEntities(
        threadId: string,
        entities: Record<string, any>,
    ): Promise<void> {
        try {
            // 🎯 CLEAN API: Direct method call via ContextService
            await ContextService.addEntities(threadId, entities);

            this.logger.debug('✅ Session entities added', {
                threadId,
                entityTypes: Object.keys(entities),
                totalEntities: Object.values(entities).reduce(
                    (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 1),
                    0,
                ),
            });
        } catch (error) {
            this.logger.error(
                '❌ Failed to add session entities',
                error instanceof Error ? error : undefined,
                {
                    threadId,
                    entityTypes: Object.keys(entities),
                },
            );
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 📊 PUBLIC INTERFACE (COMPARTILHADA)
    // ──────────────────────────────────────────────────────────────────────────

    getDefinition(): AgentDefinition<TInput, TOutput, TContent> | undefined {
        return this.singleAgentDefinition;
    }

    setToolEngine(toolEngine: ToolEngine): void {
        this.toolEngine = toolEngine;
        SharedStrategyMethods.setToolEngine(toolEngine);

        this.logger.info(
            '🔧 SharedStrategyMethods configured with ToolEngine',
            {
                toolCount: toolEngine.listTools().length,
            },
        );
    }

    getAgent(
        agentName: string,
    ): AgentDefinition<unknown, unknown, unknown> | undefined {
        return this.agents.get(agentName);
    }

    listAgents(): string[] {
        return Array.from(this.agents.keys());
    }

    removeAgent(agentName: string): boolean {
        const existed = this.agents.delete(agentName);
        if (existed) {
            this.agentCapabilities.delete(agentName);
            this.agentInboxes.delete(agentName);
            this.logger.info('Agent removed', { agentName });
        }
        return existed;
    }

    getEventHistory(): AnyEvent[] {
        return [...this.eventHistory];
    }

    async cleanup(): Promise<void> {
        this.logger.info('Cleaning up AgentCore');

        // Clear event history
        this.eventHistory = [];

        // Clear agents
        this.agents.clear();
        this.agentCapabilities.clear();

        if (this.config.enableMessaging) {
            if (this.deliveryIntervalId) {
                clearInterval(this.deliveryIntervalId);
            }
            this.messages.clear();
            this.agentInboxes.clear();
            this.activeDelegations.clear();
            this.messageHistory.length = 0;
            this.deliveryQueue.length = 0;
        }

        this.logger.info('AgentCore cleanup completed');
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // 🔍 CONTEXT CAPTURE & OBSERVABILITY HELPERS
    // ──────────────────────────────────────────────────────────────────────────────

    /**
     * Captura contexto automático para logging
     */
    protected captureLogContext(
        operation: string,
        additionalContext?: Record<string, unknown>,
    ): Record<string, unknown> {
        const baseContext = {
            operation,
            agentName: this.singleAgentDefinition?.name || 'multi-agent',
            tenantId: this.config.tenantId,
            timestamp: Date.now(),
        };

        if (this.config.enableMultiAgent) {
            Object.assign(baseContext, {
                agentCount: this.agents.size,
                activeDelegations: this.activeDelegations.size,
                pendingMessages: this.deliveryQueue.length,
            });
        }

        return { ...baseContext, ...additionalContext };
    }

    /**
     * Sanitiza input para logging seguro
     */
    protected sanitizeInputForLogging(input: unknown): unknown {
        if (!input) return input;

        try {
            // Se for string, limitar tamanho
            if (typeof input === 'string') {
                return input.length > 1000
                    ? input.substring(0, 1000) + '...'
                    : input;
            }

            // Se for objeto, remover propriedades sensíveis
            if (typeof input === 'object' && input !== null) {
                const sanitized = { ...(input as Record<string, unknown>) };
                const sensitiveKeys = [
                    'password',
                    'token',
                    'secret',
                    'key',
                    'auth',
                ];

                sensitiveKeys.forEach((key) => {
                    if (key in sanitized) {
                        sanitized[key] = '[REDACTED]';
                    }
                });

                return sanitized;
            }

            return input;
        } catch {
            return '[UNSERIALIZABLE]';
        }
    }

    /**
     * Log de erro com contexto automático
     */
    protected logError(
        message: string,
        error: Error,
        operation: string,
        additionalContext?: Record<string, unknown>,
    ): void {
        const context = this.captureLogContext(operation, {
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack,
            ...additionalContext,
        });

        this.logger.error(message, error, context);
    }

    /**
     * Log de info com contexto automático
     */
    protected logInfo(
        message: string,
        operation: string,
        additionalContext?: Record<string, unknown>,
    ): void {
        const context = this.captureLogContext(operation, additionalContext);
        this.logger.info(message, context);
    }

    /**
     * Log de debug com contexto automático
     */
    protected logDebug(
        message: string,
        operation: string,
        additionalContext?: Record<string, unknown>,
    ): void {
        if (this.config.debug) {
            const context = this.captureLogContext(
                operation,
                additionalContext,
            );
            this.logger.debug(message, context);
        }
    }

    /**
     * Wrap error com observabilidade automática
     */
    protected wrapErrorWithObservability(
        error: Error,
        errorCode: string,
        _message: string,
        context?: Record<string, unknown>,
    ): Error {
        // TODO: Implementar integração com observabilityErrorUtils
        // Por enquanto, apenas adiciona contexto ao erro
        (
            error as Error & {
                context?: Record<string, unknown>;
                errorCode?: string;
            }
        ).context = context;
        (
            error as Error & {
                context?: Record<string, unknown>;
                errorCode?: string;
            }
        ).errorCode = errorCode;
        return error;
    }

    /**
     * Aggregate tool results from parallel, sequential, or conditional executions
     */
    protected aggregateToolResults(
        results: Array<{ toolName: string; result?: unknown; error?: string }>,
        strategy: 'parallel' | 'sequential' | 'conditional' | 'adaptive',
        options?: {
            includeErrors?: boolean;
            transformResults?: boolean;
            mergeStrategy?: 'combine' | 'merge' | 'aggregate' | 'summarize';
            metadata?: Record<string, unknown>;
        },
    ): {
        aggregatedResult: unknown;
        summary: {
            totalTools: number;
            successfulTools: number;
            failedTools: number;
            executionStrategy: string;
            errorSummary?: string[];
        };
        individualResults: Array<{
            toolName: string;
            success: boolean;
            result?: unknown;
            error?: string;
            executionTime?: number;
        }>;
        metadata: Record<string, unknown>;
    } {
        const includeErrors = options?.includeErrors ?? true;
        const transformResults = options?.transformResults ?? true;
        const mergeStrategy = options?.mergeStrategy ?? 'combine';

        // Process individual results
        const individualResults = results.map((result) => ({
            toolName: result.toolName,
            success: !result.error,
            result: result.result,
            error: result.error,
            executionTime: this.estimateToolExecutionTime(result.toolName),
        }));

        // Calculate summary statistics
        const summary = {
            totalTools: results.length,
            successfulTools: results.filter((r) => !r.error).length,
            failedTools: results.filter((r) => r.error).length,
            executionStrategy: strategy,
            errorSummary: includeErrors
                ? results
                      .filter((r) => r.error)
                      .map((r) => `${r.toolName}: ${r.error}`)
                : undefined,
        };

        // Aggregate results based on strategy
        let aggregatedResult: unknown;

        switch (mergeStrategy) {
            case 'combine':
                aggregatedResult = this.combineResults(
                    results,
                    strategy,
                    transformResults,
                );
                break;
            case 'merge':
                aggregatedResult = this.mergeResults(
                    results,
                    strategy,
                    transformResults,
                );
                break;
            case 'aggregate':
                aggregatedResult = this.aggregateResultsDetailed(
                    results,
                    strategy,
                    transformResults,
                );
                break;
            case 'summarize':
                aggregatedResult = this.summarizeResults(results, strategy);
                break;
            default:
                aggregatedResult = this.combineResults(
                    results,
                    strategy,
                    transformResults,
                );
        }

        // Build metadata
        const metadata = {
            aggregationStrategy: mergeStrategy,
            executionStrategy: strategy,
            timestamp: Date.now(),
            toolCount: results.length,
            successRate: summary.successfulTools / summary.totalTools,
            ...options?.metadata,
        };

        return {
            aggregatedResult,
            summary,
            individualResults,
            metadata,
        };
    }

    /**
     * Combine results into a structured format
     */
    private combineResults(
        results: Array<{ toolName: string; result?: unknown; error?: string }>,
        strategy: string,
        transform: boolean,
    ): unknown {
        if (results.length === 0) return null;
        if (results.length === 1) return results[0]?.result;

        const combined: Record<string, unknown> = {
            strategy,
            timestamp: Date.now(),
            results: {} as Record<string, unknown>,
        };

        for (const result of results) {
            if (result.error) {
                (combined.results as Record<string, unknown>)[result.toolName] =
                    {
                        error: result.error,
                        success: false,
                    };
            } else {
                (combined.results as Record<string, unknown>)[result.toolName] =
                    transform
                        ? this.transformSingleResult(
                              result.result,
                              result.toolName,
                          )
                        : result.result;
            }
        }

        return combined;
    }

    /**
     * Merge results into a unified structure
     */
    private mergeResults(
        results: Array<{ toolName: string; result?: unknown; error?: string }>,
        strategy: string,
        transform: boolean,
    ): unknown {
        const successfulResults = results.filter((r) => !r.error);

        if (successfulResults.length === 0) {
            return {
                error: 'All tools failed',
                strategy,
                failedTools: results.map((r) => r.toolName),
            };
        }

        if (successfulResults.length === 1) {
            const firstResult = successfulResults[0];
            return transform
                ? this.transformSingleResult(
                      firstResult?.result,
                      firstResult?.toolName || 'unknown',
                  )
                : firstResult?.result;
        }

        // Try to merge results intelligently
        const merged: Record<string, unknown> = {};

        for (const result of successfulResults) {
            if (result.result && typeof result.result === 'object') {
                Object.assign(merged, result.result);
            } else {
                merged[result.toolName] = result.result;
            }
        }

        return {
            ...merged,
            metadata: {
                strategy,
                mergedFrom: successfulResults.map((r) => r.toolName),
                timestamp: Date.now(),
            },
        };
    }

    /**
     * Create detailed aggregation with metrics
     */
    private aggregateResultsDetailed(
        results: Array<{ toolName: string; result?: unknown; error?: string }>,
        strategy: string,
        transform: boolean,
    ): unknown {
        const successfulResults = results.filter((r) => !r.error);
        const failedResults = results.filter((r) => r.error);

        return {
            strategy,
            timestamp: Date.now(),
            summary: {
                total: results.length,
                successful: successfulResults.length,
                failed: failedResults.length,
                successRate: successfulResults.length / results.length,
            },
            successful: Object.fromEntries(
                successfulResults.map((r) => [
                    r.toolName,
                    transform
                        ? this.transformSingleResult(r.result, r.toolName)
                        : r.result,
                ]),
            ),
            failed: Object.fromEntries(
                failedResults.map((r) => [r.toolName, { error: r.error }]),
            ),
            metrics: {
                averageExecutionTime:
                    this.calculateAverageExecutionTime(results),
                toolDistribution: this.analyzeToolDistribution(results),
                errorPatterns: this.analyzeErrorPatterns(failedResults),
            },
        };
    }

    /**
     * Summarize results into a concise format
     */
    private summarizeResults(
        results: Array<{ toolName: string; result?: unknown; error?: string }>,
        strategy: string,
    ): unknown {
        const successfulResults = results.filter((r) => !r.error);
        const failedResults = results.filter((r) => r.error);

        if (successfulResults.length === 0) {
            return {
                success: false,
                message: `All ${results.length} tools failed`,
                strategy,
                errors: failedResults.map((r) => r.error),
            };
        }

        if (failedResults.length === 0) {
            return {
                success: true,
                message: `All ${results.length} tools executed successfully`,
                strategy,
                resultCount: successfulResults.length,
                tools: successfulResults.map((r) => r.toolName),
            };
        }

        return {
            success: true,
            message: `${successfulResults.length}/${results.length} tools executed successfully`,
            strategy,
            successful: successfulResults.map((r) => r.toolName),
            failed: failedResults.map((r) => r.toolName),
            partialSuccess: true,
        };
    }

    /**
     * Transform individual result based on tool type and content
     */
    private transformSingleResult(result: unknown, toolName: string): unknown {
        // Simple transformation based on tool name patterns
        if (toolName.includes('fetch') || toolName.includes('get')) {
            // Data retrieval tools - wrap in data envelope
            return {
                data: result,
                source: toolName,
                timestamp: Date.now(),
                type: 'retrieval',
            };
        }

        if (toolName.includes('process') || toolName.includes('transform')) {
            // Processing tools - wrap with processing metadata
            return {
                processedData: result,
                processor: toolName,
                timestamp: Date.now(),
                type: 'processing',
            };
        }

        if (toolName.includes('validate') || toolName.includes('check')) {
            // Validation tools - wrap with validation metadata
            return {
                validationResult: result,
                validator: toolName,
                timestamp: Date.now(),
                type: 'validation',
            };
        }

        // Default transformation
        return {
            result,
            tool: toolName,
            timestamp: Date.now(),
            type: 'generic',
        };
    }

    /**
     * Estimate execution time for a tool (for aggregation metrics)
     */
    private estimateToolExecutionTime(toolName: string): number {
        // Simple estimation based on tool name patterns
        if (toolName.includes('fetch') || toolName.includes('api')) return 2000;
        if (toolName.includes('process') || toolName.includes('analyze'))
            return 3000;
        if (toolName.includes('generate') || toolName.includes('create'))
            return 5000;
        if (toolName.includes('validate') || toolName.includes('check'))
            return 1000;

        return 1500; // Default estimate
    }

    /**
     * Calculate average execution time from results
     */
    private calculateAverageExecutionTime(
        results: Array<{ toolName: string; result?: unknown; error?: string }>,
    ): number {
        const totalTime = results.reduce(
            (sum, result) =>
                sum + this.estimateToolExecutionTime(result.toolName),
            0,
        );
        return results.length > 0 ? totalTime / results.length : 0;
    }

    /**
     * Analyze tool distribution in results
     */
    private analyzeToolDistribution(
        results: Array<{ toolName: string; result?: unknown; error?: string }>,
    ): Record<string, number> {
        const distribution: Record<string, number> = {};

        for (const result of results) {
            // Categorize tools by type
            let category = 'other';
            if (
                result.toolName.includes('fetch') ||
                result.toolName.includes('get')
            )
                category = 'retrieval';
            else if (
                result.toolName.includes('process') ||
                result.toolName.includes('transform')
            )
                category = 'processing';
            else if (
                result.toolName.includes('validate') ||
                result.toolName.includes('check')
            )
                category = 'validation';
            else if (
                result.toolName.includes('generate') ||
                result.toolName.includes('create')
            )
                category = 'generation';

            distribution[category] = (distribution[category] || 0) + 1;
        }

        return distribution;
    }

    /**
     * Analyze error patterns in failed results
     */
    private analyzeErrorPatterns(
        failedResults: Array<{
            toolName: string;
            result?: unknown;
            error?: string;
        }>,
    ): Record<string, number> {
        const patterns: Record<string, number> = {};

        for (const result of failedResults) {
            if (result.error) {
                // Categorize errors by common patterns
                const error = result.error.toLowerCase();
                let category = 'unknown';

                if (error.includes('timeout')) category = 'timeout';
                else if (
                    error.includes('network') ||
                    error.includes('connection')
                )
                    category = 'network';
                else if (error.includes('auth') || error.includes('permission'))
                    category = 'authorization';
                else if (
                    error.includes('validation') ||
                    error.includes('invalid')
                )
                    category = 'validation';
                else if (error.includes('not found') || error.includes('404'))
                    category = 'not_found';
                else if (error.includes('server') || error.includes('500'))
                    category = 'server_error';

                patterns[category] = (patterns[category] || 0) + 1;
            }
        }

        return patterns;
    }

    protected async executeThinkActObserve<TOutput>(
        completeContext: any, // UnifiedExecutionContext
    ): Promise<TOutput> {
        if (!this.llmAdapter || !this.strategy) {
            throw new EngineError(
                'AGENT_ERROR',
                'Think→Act→Observe requires LLM adapter and strategy. Provide llmAdapter and strategy in config.',
            );
        }

        const strategyContext: any = {
            input: completeContext.input,
            tools: completeContext.agentContext?.allTools || [],
            agentContext: completeContext.agentContext,
            config: {
                executionStrategy: completeContext.agentConfig.strategy,
                stopConditions: {
                    rewoo: {
                        maxPlanSteps:
                            completeContext.agentConfig.maxIterations || 15,
                        maxToolCalls: 30,
                    },
                },
                maxExecutionTime: 60000,
                enableReasoning: true,
                enableStreaming: false,
            },
            history: completeContext.history,
            metadata: completeContext.metadata,
        };

        const result = await this.strategy.execute(strategyContext);

        try {
            this.logger.info('🌉 Calling createFinalResponse for synthesis');

            const enhancedContext = {
                ...strategyContext,
                originalResult: result,
            };

            const finalResponse =
                await this.strategy.createFinalResponse(enhancedContext);

            this.logger.info('✅ Final response created via synthesis', {
                responseLength:
                    typeof finalResponse === 'string'
                        ? finalResponse.length
                        : 0,
                synthesisUsed: true,
            });

            this.logger.debug('🚀 Final response created', {
                finalResponse:
                    typeof finalResponse === 'string'
                        ? finalResponse.substring(0, 100)
                        : finalResponse,
            });

            return finalResponse as TOutput;
        } catch (error) {
            this.logger.error(
                '❌ createFinalResponse failed, using original result output',
                error instanceof Error ? error : undefined,
                {
                    strategyType: this.strategy.constructor.name,
                    fallbackToOriginal: true,
                },
            );

            // Return clean output from ExecutionResult, not the full result
            return (result.output || 'Processing completed') as TOutput;
        }
    }

    private initializeStrategyComponents(): void {
        if (this.config.llmAdapter) {
            this.llmAdapter = this.config.llmAdapter;

            const strategyType =
                this.config.plannerOptions.type.toLowerCase() as
                    | 'react'
                    | 'rewoo'
                    | 'plan-execute';

            try {
                this.strategy = StrategyFactory.create(
                    strategyType,
                    this.llmAdapter,
                    {
                        maxIterations: this.config.maxThinkingIterations,
                        maxToolCalls: 30,
                        maxExecutionTime: this.config.thinkingTimeout,
                        enableLogging: true,
                        enableMetrics: true,
                        llmDefaults: this.config.llmDefaults,
                    },
                );

                this.logger.info('Strategy components initialized', {
                    strategyType,
                    hasLLMAdapter: !!this.llmAdapter,
                    hasStrategy: !!this.strategy,
                    agentName: this.config.agentName,
                });
            } catch (error) {
                this.logger.error(
                    'Failed to initialize strategy',
                    error as Error,
                    {
                        strategyType,
                        errorMessage:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                );
                throw error;
            }
        } else {
            this.logger.warn(
                'No LLM adapter provided - strategy components not initialized',
                {
                    agentName: this.config.agentName,
                },
            );
        }
    }

    // ✅ NOVOS MÉTODOS PRIVADOS SIMPLES
    // private async executeSingleIteration(
    //     plannerInput: PlannerExecutionContext,
    //     iterations: number,
    //     obs: ObservabilitySystem,
    //     context: AgentContext,
    // ): Promise<{
    //     thought: AgentThought;
    //     action: AgentAction;
    //     result: ActionResult;
    //     observation: ResultAnalysis;
    // }> {
    //     const kernel = this.kernelHandler
    //         ?.getMultiKernelManager()
    //         ?.getKernelByNamespace('agent');
    //     const initialEventCount = kernel?.getState().eventCount || 0;

    //     // ✅ START NEW STEP FOR TRACKING - Use (context as any).stepExecution
    //     const stepId =
    //         (context as any).stepExecution?.startStep(iterations) ||
    //         `step-${iterations}-${Date.now()}`;

    //     // ✅ SIMPLIFICADO: Think
    //     const thought = await this.executeThinkPhase(
    //         plannerInput,
    //         iterations,
    //         obs,
    //         context,
    //         stepId, // ✅ Pass stepId
    //     );

    //     // ✅ SIMPLIFICADO: Act
    //     const result = await this.executeActPhase(
    //         thought,
    //         iterations,
    //         obs,
    //         context,
    //         plannerInput,
    //         stepId, // ✅ Pass stepId
    //     );

    //     // ✅ SIMPLIFICADO: Observe
    //     const observation = await this.executeObservePhase(
    //         result,
    //         plannerInput,
    //         iterations,
    //         obs,
    //         context,
    //         stepId, // ✅ Pass stepId
    //     );

    //     // ✅ SIMPLIFICADO: Logging
    //     this.logIterationCompletion(
    //         iterations,
    //         thought,
    //         result,
    //         observation,
    //         kernel,
    //         initialEventCount,
    //     );

    //     return { thought, action: thought.action, result, observation };
    // }

    // private async executeThinkPhase(
    //     plannerInput: PlannerExecutionContext,
    //     iterations: number,
    //     obs: ObservabilitySystem,
    //     context: AgentContext,
    //     stepId: string, // ✅ Add stepId parameter
    // ): Promise<AgentThought> {
    //     const thinkSpan = startAgentSpan(obs.telemetry, 'think', {
    //         agentName: this.config.agentName || 'unknown',
    //         correlationId: context.correlationId || 'unknown',
    //         iteration: iterations,
    //     });

    //     return obs.telemetry.withSpan(thinkSpan, async () => {
    //         try {
    //             const res = await this.think(plannerInput, stepId); // ✅ Pass stepId
    //             markSpanOk(thinkSpan);
    //             return res;
    //         } catch (err) {
    //             applyErrorToSpan(thinkSpan, err, { phase: 'think' });
    //             throw err;
    //         }
    //     });
    // }

    // private async executeActPhase(
    //     thought: AgentThought,
    //     iterations: number,
    //     obs: ObservabilitySystem,
    //     context: AgentContext,
    //     plannerInput: PlannerExecutionContext,
    //     stepId: string,
    // ): Promise<ActionResult> {
    //     if (!thought.action) {
    //         throw new Error('Thought action is undefined');
    //     }

    //     // ✅ LIFECYCLE: Transition step from 'initialized' to 'executing'
    //     if ((context as any).stepExecution) {
    //         (context as any).stepExecution.startExecuting(
    //             stepId,
    //             thought,
    //             thought.action,
    //         );
    //     }

    //     // ✅ SIMPLIFICADO: Handle execute_plan action
    //     if (isExecutePlanAction(thought.action)) {
    //         const res = await this.executePlanAction(
    //             context,
    //             plannerInput,
    //             stepId,
    //         );

    //         if (stepId && (context as any).stepExecution) {
    //             try {
    //                 (context as any).stepExecution.updateStep(stepId, {
    //                     action: thought.action,
    //                     result: res,
    //                 });
    //             } catch {}
    //         }
    //         return res;
    //     }

    //     // ✅ SIMPLIFICADO: Handle regular actions
    //     const actSpan = startAgentSpan(obs.telemetry, 'act', {
    //         agentName: this.config.agentName || 'unknown',
    //         correlationId: context.correlationId || 'unknown',
    //         iteration: iterations,
    //         attributes: { actionType: thought.action?.type || 'unknown' },
    //     });

    //     return obs.telemetry.withSpan(actSpan, async () => {
    //         try {
    //             const res = await this.act(thought.action, context, stepId); // ✅ Pass context and stepId
    //             markSpanOk(actSpan);
    //             return res;
    //         } catch (err) {
    //             applyErrorToSpan(actSpan, err, { phase: 'act' });
    //             throw err;
    //         }
    //     });
    // }

    // private async executeObservePhase(
    //     result: ActionResult,
    //     plannerInput: PlannerExecutionContext,
    //     iterations: number,
    //     obs: ObservabilitySystem,
    //     context: AgentContext,
    //     stepId: string, // ✅ Add stepId parameter
    // ): Promise<ResultAnalysis> {
    //     const observeSpan = startAgentSpan(obs.telemetry, 'observe', {
    //         agentName: this.config.agentName || 'unknown',
    //         correlationId: context.correlationId || 'unknown',
    //         iteration: iterations,
    //     });

    //     return obs.telemetry.withSpan(observeSpan, async () => {
    //         try {
    //             const res = await this.observe(result, plannerInput, stepId); // ✅ Pass stepId
    //             markSpanOk(observeSpan);
    //             return res;
    //         } catch (err) {
    //             applyErrorToSpan(observeSpan, err, { phase: 'observe' });
    //             throw err;
    //         }
    //     });
    // }

    // private isExecutionPlan(x: unknown): x is ExecutionPlan {
    //     return !!x && typeof x === 'object' && 'id' in x && 'steps' in x;
    // }

    // private async executePlanAction(
    //     context: AgentContext,
    //     plannerContext: PlannerExecutionContext,
    //     stepId?: string,
    // ): Promise<ActionResult> {
    //     const maybePlan = this.planner?.getPlanForContext?.(plannerContext);
    //     if (!this.isExecutionPlan(maybePlan)) {
    //         throw new Error('No plan available for execute_plan');
    //     }
    //     const plan: ExecutionPlan = maybePlan as ExecutionPlan;

    //     // act wrapper agora propaga stepId p/ rastreio
    //     const act = async (action: AgentAction) => {
    //         const obs = getObservability();
    //         const actSpan = startAgentSpan(obs.telemetry, 'act', {
    //             agentName: this.config.agentName || 'unknown',
    //             correlationId: context.correlationId || 'unknown',
    //             iteration: 0,
    //             attributes: {
    //                 actionType: action.type || 'unknown',
    //                 source: 'plan-executor',
    //             },
    //         });

    //         return obs.telemetry.withSpan(actSpan, async () => {
    //             try {
    //                 const res = await this.act(action, context, stepId); // <= passa stepId
    //                 markSpanOk(actSpan);
    //                 return res;
    //             } catch (err) {
    //                 applyErrorToSpan(actSpan, err, {
    //                     phase: 'act',
    //                     source: 'plan-executor',
    //                 });
    //                 throw err;
    //             }
    //         });
    //     };

    //     // tipa o stepList como PlanStep[]
    //     const resolveArgs = (
    //         rawArgs: Record<string, unknown>,
    //         stepList: PlanStep[],
    //         contextForResolution: PlannerExecutionContext,
    //     ) =>
    //         this.planner!.resolveArgs
    //             ? this.planner!.resolveArgs(
    //                   rawArgs,
    //                   stepList,
    //                   contextForResolution,
    //               )
    //             : Promise.resolve({ args: rawArgs, missing: [] });

    //     // ✅ FIXED: Use PlannerHandler's managed executor
    //     // const obsRes = this.plannerHandler
    //     //     ? await this.plannerHandler.executePlan(
    //     //           plan,
    //     //           plannerContext,
    //     //           act,
    //     //           resolveArgs,
    //     //       )
    //     //     : await new PlanExecutor(act, resolveArgs, {
    //     //           enableReWOO: true,
    //     //       }).run(plan, plannerContext);
    //     //TODO: ajustar type
    //     const obsRes = {
    //         type: 'execution_complete' as const,
    //         result: {
    //             type: 'final_answer',
    //             content: 'teste',
    //         },
    //         feedback: 'Execution completed successfully',
    //         replanContext: undefined,
    //         planId: plan.id,
    //         strategy: plan.strategy,
    //         totalSteps: plan.steps.length,
    //         executedSteps: [],
    //         successfulSteps: [],
    //         failedSteps: [],
    //         skippedSteps: [],
    //         hasSignalsProblems: false,
    //         signals: {},
    //         executionTime: 0,
    //     };
    //     if (stepId && (context as any).stepExecution) {
    //         try {
    //             (context as any).stepExecution.updateStep(stepId, {
    //                 action: {
    //                     type: 'execute_plan',
    //                     planId: plan.id,
    //                 } as AgentAction,
    //             });
    //         } catch {}
    //     }

    //     let finalResult: ActionResult;
    //     if (obsRes.type === 'execution_complete') {
    //         finalResult = {
    //             type: 'final_answer',
    //             content: obsRes.feedback,
    //             planExecutionResult: obsRes,
    //         };
    //     } else {
    //         finalResult = {
    //             type: 'error',
    //             error: obsRes.feedback || 'Unknown execution result',
    //             planExecutionResult: obsRes,
    //         };
    //     }

    //     if (stepId && (context as any).stepExecution) {
    //         try {
    //             (context as any).stepExecution.updateStep(stepId, {
    //                 result: finalResult,
    //             });
    //         } catch {}
    //     }

    //     return finalResult;
    // }

    // private shouldStopExecution(
    //     iterationResult: {
    //         thought: AgentThought;
    //         action: AgentAction;
    //         result: ActionResult;
    //         observation: ResultAnalysis;
    //     },
    //     iterations: number,
    //     plannerInput: PlannerExecutionContext,
    // ): boolean {
    //     if (iterationResult.observation.isComplete) {
    //         this.logger.info('Think→Act→Observe completed', {
    //             iterations,
    //             agentName: this.config.agentName,
    //             totalDuration:
    //                 Date.now() -
    //                 (plannerInput.plannerMetadata.startTime as number),
    //             finalAction: iterationResult.action?.type || 'unknown',
    //         });
    //         return true;
    //     }

    //     if (!iterationResult.observation.shouldContinue) {
    //         this.logger.info('Think→Act→Observe stopped by planner', {
    //             iterations,
    //             reason: iterationResult.observation.feedback,
    //             agentName: this.config.agentName,
    //             totalDuration:
    //                 Date.now() -
    //                 (plannerInput.plannerMetadata.startTime as number),
    //         });
    //         return true;
    //     }

    //     if (this.detectStagnation(plannerInput)) {
    //         this.logger.warn('Stagnation detected, breaking loop', {
    //             iterations,
    //             agentName: this.config.agentName,
    //         });
    //         return true;
    //     }

    //     return false;
    // }

    // private async extractFinalResult(
    //     finalExecutionContext: PlannerExecutionContext | undefined,
    // ): Promise<unknown> {
    //     const finalResult = finalExecutionContext?.getFinalResult();

    //     if (finalResult && finalResult.success) {
    //         const result = finalResult.result;
    //         if (
    //             result &&
    //             typeof result === 'object' &&
    //             'type' in result &&
    //             'content' in result
    //         ) {
    //             if (result.type === 'final_answer') {
    //                 return result.content;
    //             }
    //         }

    //         return finalResult.result;
    //     }

    //     return 'Sorry, I had trouble processing your request. Please try again with more details.';
    // }

    // private logIterationCompletion(
    //     iterations: number,
    //     thought: AgentThought,
    //     _result: ActionResult,
    //     observation: ResultAnalysis,
    //     kernel: unknown,
    //     initialEventCount: number,
    // ): void {
    //     const finalEventCount =
    //         (
    //             kernel as { getState?: () => { eventCount: number } }
    //         )?.getState?.()?.eventCount || 0;
    //     const eventsGenerated = finalEventCount - initialEventCount;

    //     this.logger.info('Think→Act→Observe iteration completed', {
    //         iteration: iterations,
    //         actionType: thought.action?.type || 'unknown',
    //         isComplete: observation.isComplete,
    //         shouldContinue: observation.shouldContinue,
    //         eventsGenerated,
    //         totalEvents: finalEventCount,
    //     });

    //     if (eventsGenerated > 100) {
    //         this.logger.error(
    //             'Excessive event generation detected - breaking loop',
    //             undefined,
    //             {
    //                 eventsGenerated: eventsGenerated.toString(),
    //                 iteration: iterations,
    //                 agentName: this.config.agentName,
    //                 actionType: thought.action?.type || 'unknown',
    //             },
    //         );
    //     }

    //     if (finalEventCount > 5000) {
    //         this.logger.warn(
    //             'Kernel event count approaching quota limit - breaking loop',
    //             {
    //                 finalEventCount,
    //                 iteration: iterations,
    //                 agentName: this.config.agentName,
    //             },
    //         );
    //     }
    // }

    // /**
    //  * THINK phase - Delegate to planner
    //  */
    // private async think(
    //     context: PlannerExecutionContext,
    //     stepId?: string, // ✅ Add optional stepId parameter
    // ): Promise<AgentThought> {
    //     if (!this.planner) {
    //         throw new EngineError('AGENT_ERROR', 'Planner not initialized');
    //     }

    //     const thinkStart = Date.now();

    //     try {
    //         let enhancedContext = { ...context, stepId };
    //         if (stepId && context.agentContext?.stepExecution) {
    //             const relevantContext =
    //                 await context.agentContext.stepExecution.getContextForModel(
    //                     context.agentContext,
    //                     context.input,
    //                 );

    //             enhancedContext = {
    //                 ...context,
    //                 stepId,
    //                 plannerMetadata: {
    //                     ...context.plannerMetadata,
    //                     enhancedContext: relevantContext,
    //                 },
    //             };
    //         }

    //         const thought = await this.planner.think(enhancedContext, stepId);
    //         const thinkDuration = Date.now() - thinkStart;

    //         if (stepId && context.agentContext?.stepExecution) {
    //             context.agentContext.stepExecution.updateStep(stepId, {
    //                 thought,
    //             });

    //             this.logger.debug('Think phase completed', {
    //                 stepId,
    //                 thinkDuration,
    //                 thoughtType: thought.action.type,
    //             });
    //         }

    //         return thought;
    //     } catch (error) {
    //         const thinkDuration = Date.now() - thinkStart;

    //         if (stepId && context.agentContext?.stepExecution) {
    //             this.logger.warn('Think phase failed', {
    //                 stepId,
    //                 thinkDuration,
    //                 error: String(error),
    //             });
    //         }

    //         throw error;
    //     }
    // }

    // private async act(
    //     action: AgentAction,
    //     context: AgentContext,
    //     stepId?: string,
    // ): Promise<ActionResult> {
    //     const actStart = Date.now();

    //     try {
    //         let result: ActionResult;

    //         if (isToolCallAction(action)) {
    //             //TODO: Add tool call to stepExecution
    //             //const toolStart = Date.now();
    //             result = await this.executeToolAction(action);
    //             // const toolDuration = Date.now() - toolStart;

    //             // ✅ Record tool call in step
    //             // if (stepId && (context as any).stepExecution) {
    //             //     (context as any).stepExecution?.addToolCall(
    //             //         stepId,
    //             //         action.toolName,
    //             //         action.input,
    //             //         result,
    //             //         toolDuration,
    //             //     );
    //             // }
    //         } else if (isFinalAnswerAction(action)) {
    //             result = {
    //                 type: 'final_answer',
    //                 content: String(action.content),
    //             };
    //         } else if (isNeedMoreInfoAction(action)) {
    //             result = {
    //                 type: 'final_answer',
    //                 content: action.question,
    //             };
    //         } else {
    //             throw new Error(`Unknown action type: ${action.type}`);
    //         }

    //         const actDuration = Date.now() - actStart;

    //         // ✅ Update step with action result
    //         if (stepId && (context as any).stepExecution) {
    //             (context as any).stepExecution?.updateStep(stepId, {
    //                 action,
    //                 result,
    //             });

    //             this.logger.debug('Act phase completed', {
    //                 stepId,
    //                 actDuration,
    //                 actionType: action.type,
    //                 resultType: result.type,
    //             });
    //         }

    //         return result;
    //     } catch (error) {
    //         const actDuration = Date.now() - actStart;

    //         if (stepId && (context as any).stepExecution) {
    //             (context as any).stepExecution?.updateStep(stepId, {
    //                 result: { type: 'error', error: String(error) },
    //             });

    //             this.logger.warn('Act phase failed', {
    //                 stepId,
    //                 actDuration,
    //                 actionType: action.type,
    //                 error: String(error),
    //             });
    //         }

    //         return this.handleActionError(error, action);
    //     }
    // }

    /**
     * Execute tool action with all enterprise features
     */
    // private async executeToolAction(
    //     action: AgentAction,
    // ): Promise<ActionResult> {
    //     if (!this.toolEngine) {
    //         throw new Error('Tool engine not available');
    //     }

    //     if (!isToolCallAction(action)) {
    //         throw new Error('Action is not a tool call action');
    //     }

    //     // ✅ FIX: Generate correlationId ONCE to prevent duplication
    //     const correlationId = this.generateCorrelationId();

    //     // ✅ EMIT: Action start event with delivery guarantee
    //     await this.emitActionStartEvent(action, correlationId);

    //     let toolResult: any;

    //     try {
    //         // ✅ EXECUTE: Tool with circuit breaker protection
    //         toolResult = await this.executeToolWithCircuitBreaker(
    //             action,
    //             correlationId,
    //         );

    //         // ✅ EMIT: Tool completion event
    //         await this.emitToolCompletionEvent(
    //             action,
    //             toolResult,
    //             correlationId,
    //         );

    //         // Type assertion after guard check
    //         const toolAction = action as { toolName: string; input?: unknown };

    //         return {
    //             type: 'tool_result',
    //             content: toolResult,
    //             metadata: {
    //                 toolName: toolAction.toolName,
    //                 arguments: toolAction.input,
    //                 correlationId,
    //             },
    //         };
    //     } catch (error) {
    //         // ✅ EMIT: Tool error event
    //         await this.emitToolErrorEvent(action, error, correlationId);

    //         // ✅ HANDLE: Error with fallback logic
    //         return await this.handleToolExecutionError(
    //             error,
    //             action,
    //             correlationId,
    //         );
    //     }
    // }

    // /**
    //  * Execute tool with circuit breaker protection
    //  */
    // private async executeToolWithCircuitBreaker(
    //     action: AgentAction,
    //     correlationId: string,
    // ): Promise<unknown> {
    //     if (!isToolCallAction(action)) {
    //         throw new Error('Action is not a tool call action');
    //     }

    //     if (this.kernelHandler) {
    //         return await this.executeToolViaKernel(action, correlationId);
    //     } else {
    //         return await this.executeToolDirectly(action, correlationId);
    //     }
    // }

    // /**
    //  * Execute tool via kernel with circuit breaker
    //  */
    // private async executeToolViaKernel(
    //     action: AgentAction,
    //     _correlationId: string,
    // ): Promise<unknown> {
    //     if (!isToolCallAction(action)) {
    //         throw new Error('Action is not a tool call action');
    //     }

    //     // Type assertion after guard check
    //     const toolAction = action as { toolName: string; input?: unknown };

    //     if (this.toolCircuitBreaker) {
    //         // ✅ SIMPLIFIED: Direct tool execution with circuit breaker
    //         const circuitResult = await this.toolCircuitBreaker.execute(
    //             () =>
    //                 this.toolEngine!.executeCall(
    //                     toolAction.toolName,
    //                     toolAction.input || {},
    //                 ),
    //             {
    //                 toolName: toolAction.toolName,
    //                 agentName: this.config.agentName,
    //             },
    //         );

    //         if (circuitResult.error) {
    //             throw circuitResult.error;
    //         }

    //         return circuitResult.result;
    //     } else {
    //         // ✅ SIMPLIFIED: Direct tool execution without circuit breaker
    //         return await this.toolEngine!.executeCall(
    //             toolAction.toolName,
    //             toolAction.input || {},
    //         );
    //     }
    // }

    /**
     * Execute tool directly (fallback)
     */
    // private async executeToolDirectly(
    //     action: AgentAction,
    //     correlationId: string,
    // ): Promise<unknown> {
    //     if (!isToolCallAction(action)) {
    //         throw new Error('Action is not a tool call action');
    //     }

    //     // Type assertion after guard check
    //     const toolAction = action as { toolName: string; input?: unknown };

    //     this.logger.info('🤖 [AGENT] Executing tool directly', {
    //         toolName: toolAction.toolName,
    //         agentName: this.config.agentName,
    //         correlationId,
    //     });

    //     if (!this.toolEngine) {
    //         throw new Error('Tool engine not available');
    //     }

    //     if (this.toolCircuitBreaker) {
    //         // ✅ SIMPLIFIED: No additional retries - Circuit Breaker handles retries
    //         const circuitResult = await this.toolCircuitBreaker.execute(
    //             () =>
    //                 this.toolEngine!.executeCall(
    //                     toolAction.toolName,
    //                     toolAction.input || {},
    //                 ),
    //             {
    //                 toolName: toolAction.toolName,
    //                 agentName: this.config.agentName,
    //             },
    //         );

    //         if (circuitResult.rejected || circuitResult.error) {
    //             throw circuitResult.error;
    //         }

    //         return circuitResult.result;
    //     } else {
    //         return await this.toolEngine.executeCall(
    //             toolAction.toolName,
    //             toolAction.input || {},
    //         );
    //     }
    // }

    // /**
    //  * Handle tool execution errors - let Runtime handle retry
    //  */
    // private async handleToolExecutionError(
    //     error: unknown,
    //     action: AgentAction,
    //     correlationId: string,
    // ): Promise<ActionResult> {
    //     if (!isToolCallAction(action)) {
    //         throw new Error('Action is not a tool call action');
    //     }

    //     // Type assertion after guard check
    //     const toolAction = action as { toolName: string; type: string };
    //     const errorMessage = (error as Error).message;

    //     // ✅ SIMPLE: Let Runtime handle retry, AgentCore just logs and returns error
    //     this.logger.error('🤖 [AGENT] Tool execution failed', error as Error, {
    //         toolName: toolAction.toolName,
    //         agentName: this.config.agentName,
    //         correlationId,
    //         errorMessage,
    //     });

    //     // ✅ CORRECT: Return error as context for agent to handle
    //     return {
    //         type: 'error',
    //         error: errorMessage,
    //         metadata: {
    //             actionType: toolAction.type,
    //             tool: toolAction.toolName,
    //             correlationId,
    //             // ✅ Context for agent to understand what happened
    //             errorContext: {
    //                 toolName: toolAction.toolName,
    //                 errorMessage,
    //                 timestamp: Date.now(),
    //             },
    //         },
    //     };
    // }

    // /**
    //  * Emit action start event
    //  */
    // private async emitActionStartEvent(
    //     action: AgentAction,
    //     correlationId: string,
    // ): Promise<void> {
    //     if (!this.kernelHandler?.emitAsync) {
    //         return;
    //     }

    //     const actionType = this.getActionType(action);
    //     const emitResult = await this.kernelHandler.emitAsync(
    //         'agent.action.start',
    //         {
    //             agentName: this.config.agentName,
    //             actionType,
    //             correlationId,
    //         },
    //         {
    //             deliveryGuarantee: 'at-least-once',
    //             correlationId,
    //         },
    //     );

    //     if (!emitResult.success) {
    //         this.logger.warn('Failed to emit agent.action.start', {
    //             error: emitResult.error,
    //             correlationId,
    //         });
    //     }
    // }

    // /**
    //  * Emit tool completion event
    //  */
    // private async emitToolCompletionEvent(
    //     action: AgentAction,
    //     result: unknown,
    //     correlationId: string,
    // ): Promise<void> {
    //     if (!isToolCallAction(action) || !this.kernelHandler?.emitAsync) {
    //         return;
    //     }

    //     // Type assertion after guard check
    //     const toolAction = action as { toolName: string };

    //     const emitResult = await this.kernelHandler.emitAsync(
    //         'agent.tool.completed',
    //         {
    //             agentName: this.config.agentName,
    //             toolName: toolAction.toolName,
    //             correlationId,
    //             result,
    //         },
    //         {
    //             deliveryGuarantee: 'at-least-once',
    //             correlationId,
    //         },
    //     );

    //     if (!emitResult.success) {
    //         this.logger.warn('Failed to emit agent.tool.completed', {
    //             error: emitResult.error,
    //             correlationId,
    //         });
    //     }
    // }

    // /**
    //  * Emit tool error event
    //  */
    // private async emitToolErrorEvent(
    //     action: AgentAction,
    //     error: unknown,
    //     correlationId: string,
    // ): Promise<void> {
    //     if (!isToolCallAction(action) || !this.kernelHandler?.emitAsync) return;

    //     // Type assertion after guard check
    //     const toolAction = action as { toolName: string };

    //     const emitResult = await this.kernelHandler.emitAsync(
    //         'agent.tool.error',
    //         {
    //             agentName: this.config.agentName,
    //             toolName: toolAction.toolName,
    //             correlationId,
    //             error: (error as Error).message,
    //         },
    //         {
    //             deliveryGuarantee: 'at-least-once',
    //             correlationId,
    //         },
    //     );

    //     if (!emitResult.success) {
    //         this.logger.warn('Failed to emit agent.tool.error', {
    //             error: emitResult.error,
    //             correlationId,
    //         });
    //     }
    // }

    // /**
    //  * Handle action execution errors
    //  */
    // private handleActionError(
    //     error: unknown,
    //     action: AgentAction,
    // ): ActionResult {
    //     const toolName = isToolCallAction(action)
    //         ? (action as { toolName: string }).toolName
    //         : 'unknown';

    //     this.logger.error('Action execution failed', error as Error, {
    //         actionType: action.type,
    //         tool: toolName,
    //         agentName: this.config.agentName,
    //     });

    //     return {
    //         type: 'error',
    //         error: error instanceof Error ? error.message : 'Unknown error',
    //         metadata: {
    //             actionType: action.type,
    //             tool: toolName,
    //         },
    //     };
    // }

    /**
     * OBSERVE phase - Delegate to planner for analysis and synthesize response when needed
     */
    // private async observe(
    //     result: ActionResult,
    //     context: PlannerExecutionContext,
    //     stepId?: string, // ✅ Add optional stepId parameter
    // ): Promise<ResultAnalysis> {
    //     if (!this.planner) {
    //         throw new EngineError('AGENT_ERROR', 'Planner not initialized');
    //     }

    //     // ✅ CAMADA 1: PLANNER DECIDE
    //     // Parse tool result for additional context
    //     const parsed = isToolResult(result)
    //         ? parseToolResult(result.content)
    //         : null;

    //     const observeStart = Date.now();

    //     const obs = getObservability();
    //     const analyzeSpan = startAgentSpan(obs.telemetry, 'analyze', {
    //         agentName: this.config.agentName || 'unknown',
    //         correlationId: context.plannerMetadata.correlationId || 'unknown',
    //         attributes: {
    //             resultType: result?.type || 'unknown',
    //             isToolResult: isToolResult(result),
    //             isSubstantial: parsed?.isSubstantial || false,
    //             hasError: parsed?.isError || false,
    //         },
    //     });

    //     const analysis = await obs.telemetry.withSpan(analyzeSpan, async () => {
    //         try {
    //             const analyzeResult = await this.planner!.analyzeResult(
    //                 result,
    //                 context,
    //             );
    //             markSpanOk(analyzeSpan);
    //             return analyzeResult;
    //         } catch (err) {
    //             applyErrorToSpan(analyzeSpan, err, { phase: 'analyze' });
    //             throw err;
    //         }
    //     });

    //     // ✅ CAMADA 2: SE DEVE PARAR, SINTETIZA RESPOSTA
    //     if (analysis.isComplete && analysis.isSuccessful) {
    //         const synthesizeSpan = startAgentSpan(obs.telemetry, 'synthesize', {
    //             agentName: this.config.agentName || 'unknown',
    //             correlationId:
    //                 context.plannerMetadata.correlationId || 'unknown',
    //             attributes: { analysisComplete: true },
    //         });

    //         const synthesizedResponse = await obs.telemetry.withSpan(
    //             synthesizeSpan,
    //             async () => {
    //                 try {
    //                     // Check if planner supports createFinalResponse
    //                     if (!this.planner?.createFinalResponse) {
    //                         this.logger.warn(
    //                             'Planner does not support createFinalResponse, skipping synthesis',
    //                             {
    //                                 plannerType: this.planner?.constructor.name,
    //                             },
    //                         );
    //                         markSpanOk(synthesizeSpan);
    //                         return 'Synthesis not supported by this planner';
    //                     }

    //                     const response =
    //                         await this.planner.createFinalResponse(context);
    //                     markSpanOk(synthesizeSpan);
    //                     return response;
    //                 } catch (err) {
    //                     applyErrorToSpan(synthesizeSpan, err, {
    //                         phase: 'synthesize',
    //                     });
    //                     throw err;
    //                 }
    //             },
    //         );

    //         const observeDuration = Date.now() - observeStart;

    //         if (stepId && context.agentContext?.stepExecution) {
    //             // ✅ LIFECYCLE: Mark step as completed or failed based on synthesized analysis
    //             const synthesizedAnalysis = {
    //                 ...analysis,
    //                 feedback: synthesizedResponse,
    //             };

    //             if (analysis.isComplete) {
    //                 if (analysis.isSuccessful) {
    //                     context.agentContext.stepExecution.markCompleted(
    //                         stepId,
    //                         result,
    //                         synthesizedAnalysis,
    //                     );
    //                 } else {
    //                     context.agentContext.stepExecution.markFailed(
    //                         stepId,
    //                         result,
    //                         synthesizedAnalysis,
    //                     );
    //                 }
    //             } else {
    //                 // Still executing, just update the step
    //                 context.agentContext.stepExecution.updateStep(stepId, {
    //                     observation: synthesizedAnalysis,
    //                 });
    //             }

    //             this.logger.debug('Observe phase completed (synthesis)', {
    //                 stepId,
    //                 observeDuration,
    //                 analysisComplete: analysis.isComplete,
    //                 isSuccessful: analysis.isSuccessful,
    //                 synthesized: true,
    //             });
    //         }

    //         return {
    //             ...analysis,
    //             feedback: synthesizedResponse,
    //         };
    //     }

    //     const observeDuration = Date.now() - observeStart;

    //     if (stepId && context.agentContext?.stepExecution) {
    //         // ✅ LIFECYCLE: Mark step as completed or failed based on analysis
    //         if (analysis.isComplete) {
    //             if (analysis.isSuccessful) {
    //                 context.agentContext.stepExecution.markCompleted(
    //                     stepId,
    //                     result,
    //                     analysis,
    //                 );
    //             } else {
    //                 context.agentContext.stepExecution.markFailed(
    //                     stepId,
    //                     result,
    //                     analysis,
    //                 );
    //             }
    //         } else {
    //             // Still executing, just update the step
    //             context.agentContext.stepExecution.updateStep(stepId, {
    //                 observation: analysis,
    //                 duration: observeDuration,
    //             });
    //         }

    //         this.logger.debug('Observe phase completed (continuing)', {
    //             stepId,
    //             observeDuration,
    //             shouldContinue: analysis.shouldContinue,
    //             isComplete: analysis.isComplete,
    //             isSuccessful: analysis.isSuccessful,
    //             synthesized: false,
    //         });
    //     }

    //     return analysis;
    // }

    /**
     * Detect stagnation patterns in execution context
     */
    // private detectStagnation(context: PlannerExecutionContext): boolean {
    //     if (context.history.length < 3) {
    //         return false;
    //     }

    //     const recent = context.history.slice(-3);

    //     // Check for repeated actions
    //     const actionTypes = recent.map((history) => history.action.type);
    //     const uniqueActions = new Set(actionTypes);

    //     if (uniqueActions.size === 1 && actionTypes[0] !== 'final_answer') {
    //         this.logger.warn('Repeated action pattern detected', {
    //             actionType: actionTypes[0],
    //             count: actionTypes.length,
    //         });
    //         return true;
    //     }

    //     // Check for repeated failures
    //     const failures = recent.filter((h) => isErrorResult(h.result));
    //     if (failures.length >= 2) {
    //         const errorMessages = failures
    //             .map((h) => getResultError(h.result))
    //             .join('; ');
    //         this.logger.warn('Repeated failure pattern detected', {
    //             failureCount: failures.length,
    //             errors: errorMessages,
    //         });
    //         return true;
    //     }

    //     // Removed confidence-based stagnation check

    //     return false;
    // }

    // getPlannerInfo(): {
    //     type?: PlannerType;
    //     llmProvider?: string;
    //     isInitialized: boolean;
    // } {
    //     return {
    //         type: this.config.planner,
    //         llmProvider: this.llmAdapter?.getProvider?.()?.name || 'unknown',
    //         isInitialized: !!this.planner,
    //     };
    // }

    // private createPlannerContext(
    //     input: string,
    //     history: Array<{
    //         thought: AgentThought;
    //         action: AgentAction;
    //         result: ActionResult;
    //         observation: ResultAnalysis;
    //     }>,
    //     iterations: number,
    //     maxIterations: number,
    //     agentContext: AgentContext,
    // ): PlannerExecutionContext {
    //     const stepHistory: StepResult[] = history.map((entry, index) => ({
    //         stepId: `step-${index + 1}`,
    //         iteration: index + 1,
    //         thought: entry.thought,
    //         action: entry.action,
    //         status: entry.result.type,
    //         result: entry.result,
    //         observation: entry.observation,
    //         duration: 0,
    //         startedAt: Date.now(), // Timestamp placeholder for historical steps
    //         toolCalls: [],
    //     }));

    //     return {
    //         input,
    //         history: stepHistory,
    //         iterations,
    //         maxIterations,
    //         plannerMetadata: {
    //             agentName: agentContext.agentName,
    //             correlationId: agentContext.correlationId,
    //             tenantId: agentContext.tenantId,
    //             thread: agentContext.thread,
    //             startTime: Date.now(),
    //         },
    //         agentContext,
    //         isComplete: this.isExecutionComplete(history),
    //         update: () => {}, // Interface compatibility only
    //         getCurrentSituation: () => this.getCurrentSituation(history),
    //         getFinalResult: () => this.buildFinalResult(history, iterations),
    //         getCurrentPlan: () =>
    //             this.planner?.getPlanForContext
    //                 ? this.planner.getPlanForContext({
    //                       input,
    //                       history: stepHistory,
    //                       iterations,
    //                       maxIterations,
    //                       plannerMetadata: {
    //                           agentName: agentContext.agentName,
    //                           correlationId: agentContext.correlationId,
    //                           tenantId: agentContext.tenantId,
    //                           thread: agentContext.thread,
    //                           startTime: Date.now(),
    //                       },
    //                       agentContext,
    //                       isComplete: this.isExecutionComplete(history),
    //                       update: () => {},
    //                       getCurrentSituation: () =>
    //                           this.getCurrentSituation(history),
    //                       getFinalResult: () =>
    //                           this.buildFinalResult(history, iterations),
    //                   })
    //                 : null,
    //     };
    // }

    /**
     * Check if execution is complete based on history
     */
    // private isExecutionComplete(
    //     executionHistory: Array<{
    //         thought: AgentThought;
    //         action: AgentAction;
    //         result: ActionResult;
    //         observation: ResultAnalysis;
    //     }>,
    // ): boolean {
    //     return (
    //         executionHistory.length > 0 &&
    //         executionHistory[executionHistory.length - 1]?.observation
    //             .isComplete === true
    //     );
    // }

    // /**
    //  * Get current situation summary from recent history
    //  */
    // private getCurrentSituation(
    //     executionHistory: Array<{
    //         thought: AgentThought;
    //         action: AgentAction;
    //         result: ActionResult;
    //         observation: ResultAnalysis;
    //     }>,
    // ): string {
    //     const recentHistory = executionHistory.slice(-3);
    //     return recentHistory
    //         .map(
    //             (entry) =>
    //                 `Action: ${JSON.stringify(entry.action)} -> Result: ${JSON.stringify(entry.result)}`,
    //         )
    //         .join('\n');
    // }

    // /**
    //  * Build final result from execution history
    //  */
    // private buildFinalResult(
    //     executionHistory: Array<{
    //         thought: AgentThought;
    //         action: AgentAction;
    //         result: ActionResult;
    //         observation: ResultAnalysis;
    //     }>,
    //     iterations: number,
    // ) {
    //     const lastEntry = executionHistory[executionHistory.length - 1];
    //     let finalResult = lastEntry?.result;

    //     if (
    //         lastEntry?.observation?.feedback &&
    //         lastEntry.observation.isComplete
    //     ) {
    //         finalResult = {
    //             type: 'final_answer',
    //             content: lastEntry.observation.feedback,
    //         };
    //     }

    //     return {
    //         success: lastEntry?.observation.isComplete || false,
    //         result: finalResult,
    //         iterations,
    //         duration: 0,
    //         totalTime: Date.now(),
    //         thoughts: executionHistory.map((h) => h.thought),
    //         metadata: {
    //             agentName: this.config.agentName || 'unknown',
    //             iterations,
    //             toolsUsed: executionHistory.filter(
    //                 (h) => h.action.type === 'tool_call',
    //             ).length,
    //             thinkingTime: 0,
    //             toolCallsCount: executionHistory.filter(
    //                 (h) => h.action.type === 'tool_call',
    //             ).length,
    //             errorsCount: executionHistory.filter(
    //                 (h) => h.result.type === 'error',
    //             ).length,
    //         },
    //     };
    // }

    // private async logExecutionWithCriteria(
    //     context: AgentContext,
    // ): Promise<void> {
    //     if (!(context as any).stepExecution) {
    //         this.logger.debug('No stepExecution available for logging');
    //         return;
    //     }

    //     const steps = (context as any).stepExecution.getAllSteps();
    //     if (steps.length === 0) {
    //         this.logger.debug('No steps to log');
    //         return;
    //     }

    //     const startTime =
    //         typeof steps[0]?.thought?.metadata?.startTime === 'number'
    //             ? steps[0].thought.metadata.startTime
    //             : Date.now() - 1000; // Default to 1 second ago if no start time
    //     const endTime = Date.now();

    //     // Calculate execution criteria for smart persistence
    //     const executionCriteria = {
    //         hasToolCalls: steps.some(
    //             (step) => step.toolCalls && step.toolCalls.length > 0,
    //         ),
    //         executionTimeMs: endTime - startTime,
    //         multipleSteps: steps.length > 1,
    //         hasErrors: steps.some((step) => !step.observation?.isSuccessful),
    //         isDebugMode: this.config.debug || false,
    //     };

    //     // SimpleExecutionLogger integrated into EnhancedContextBuilder
    //     const executionLogger = null; // Will be replaced with enhanced logging

    //     // Log execution with smart persistence logic
    //     if (!executionLogger) {
    //         this.logger.debug(
    //             'ExecutionLogger not available (ContextNew architecture)',
    //         );
    //         return;
    //     }

    //     const logResult = executionLogger.logExecution(
    //         context.invocationId,
    //         context.sessionId,
    //         context.agentName,
    //         startTime,
    //         endTime,
    //         steps,
    //         executionCriteria,
    //     );

    //     if (logResult.shouldPersist) {
    //         const executionSummary = (
    //             context as any
    //         ).stepExecution?.getExecutionSummary();
    //         const allSteps =
    //             (context as any).stepExecution?.getAllSteps() || [];

    //         const planData: Record<string, unknown> = {};
    //         if (this.planner && 'getCurrentPlan' in this.planner) {
    //             try {
    //                 const plannerWithGetPlan = this.planner as {
    //                     getCurrentPlan?: (context: unknown) => unknown;
    //                 };
    //                 const currentPlan = plannerWithGetPlan.getCurrentPlan?.(
    //                     this.executionContext,
    //                 ) as Record<string, unknown> | undefined;
    //                 if (
    //                     currentPlan &&
    //                     typeof currentPlan === 'object' &&
    //                     'id' in currentPlan
    //                 ) {
    //                     const planId = String(currentPlan.id);
    //                     const metadata = currentPlan.metadata as
    //                         | Record<string, unknown>
    //                         | undefined;
    //                     planData[planId] = {
    //                         goal: currentPlan.goal,
    //                         strategy: currentPlan.strategy,
    //                         steps: currentPlan.steps || [],
    //                         signals: currentPlan.signals || metadata?.signals,
    //                         reasoning: currentPlan.reasoning,
    //                         status: currentPlan.status,
    //                         executionTime:
    //                             currentPlan.updatedAt && currentPlan.createdAt
    //                                 ? Number(currentPlan.updatedAt) -
    //                                   Number(currentPlan.createdAt)
    //                                 : 0,
    //                         createdAt: currentPlan.createdAt,
    //                         updatedAt: currentPlan.updatedAt,
    //                     };
    //                 }
    //             } catch (error) {
    //                 this.logger.debug(
    //                     'Could not extract plan data for persistence',
    //                     { error },
    //                 );
    //             }
    //         }

    //         const decisions: Array<{
    //             step: string;
    //             decision: string;
    //             reasoning: string;
    //             fallback?: string;
    //             timestamp: number;
    //         }> = [];

    //         allSteps.forEach((step, index) => {
    //             if (step.thought?.reasoning && step.action) {
    //                 const decision = {
    //                     step: `step-${index}`,
    //                     decision: step.action.type,
    //                     reasoning: step.thought.reasoning,
    //                     timestamp: Date.now(),
    //                     fallback: undefined as string | undefined,
    //                 };

    //                 if (step.action.type === 'execute_plan') {
    //                     decision.decision = 'execute_plan';
    //                 }
    //                 if (
    //                     step.result?.type === 'error' &&
    //                     step.observation?.isSuccessful
    //                 ) {
    //                     decision.decision = 'final_answer'; // Recovery bem-sucedido
    //                     decision.fallback = 'continue_execution';
    //                 }

    //                 decisions.push(decision);
    //             }
    //         });

    //         // ✅ HIERARCHICAL STRUCTURE: Organizar dados hierarquicamente
    //         const enhancedExecutionData = {
    //             session: {
    //                 summary: executionSummary,
    //                 logResult: logResult.summary,
    //             },
    //             planning: {
    //                 plans: planData,
    //                 decisions: decisions,
    //             },
    //             tooling: {
    //                 availableTools:
    //                     context.availableTools?.map((t) => t.name) || [],
    //                 toolCallsAttempted: allSteps.reduce(
    //                     (acc, step) => acc + (step.toolCalls?.length || 0),
    //                     0,
    //                 ),
    //                 toolCallsSuccessful: allSteps.reduce(
    //                     (acc, step) =>
    //                         acc +
    //                         (step.toolCalls?.filter((tc) => tc.result).length ||
    //                             0),
    //                     0,
    //                 ),
    //             },
    //             synthesis: {
    //                 totalSteps: allSteps.length,
    //                 completedSteps: allSteps.filter(
    //                     (s) => s.observation?.isComplete,
    //                 ).length,
    //                 strategy: 'enhanced_context_persistence',
    //                 persistedAt: Date.now(),
    //             },
    //             steps: allSteps, // ✅ Manter steps para compatibilidade
    //         };

    //         await context.state.set(
    //             'execution',
    //             'enhanced',
    //             enhancedExecutionData,
    //         );
    //         await context.state.persist?.('execution');

    //         this.logger.info('Complex execution persisted', {
    //             executionId: context.invocationId,
    //             complexity: logResult.summary.complexityScore,
    //             duration: logResult.summary.totalDuration,
    //             toolCalls: logResult.summary.toolCallsCount,
    //             stepsCount: allSteps.length,
    //         });
    //     }
    // }
}

// ──────────────────────────────────────────────────────────────────────────────
// 🏭 FACTORY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

export function createAgentCore(
    config: AgentCoreConfig,
): AgentCore<unknown, unknown, unknown> {
    return new (class extends AgentCore {
        // Abstract class implementation
    })(config);
}
