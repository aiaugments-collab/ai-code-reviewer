import { z } from 'zod';

import {
    CancelledNotification,
    InitializeResult,
    ProgressNotification,
} from '@modelcontextprotocol/sdk/types.js';
import { IdGenerator } from '../../utils/index.js';
import { createLogger, TelemetrySystem } from '../../observability/index.js';
import type { ObservabilitySystem } from '../../observability/index.js';
import { zodToJSONSchema } from '../utils/zod-to-json-schema.js';
// ContextStateService removed - using contextNew architecture
import { EventStore } from '../../runtime/index.js';
import { EventChainTracker } from '../../runtime/core/event-processor-optimized.js';
import { EventQueue } from '../../runtime/core/index.js';
import { ExecutionKernel } from '../../kernel/kernel.js';
import { AgentEngine, AgentExecutor } from '../../engine/index.js';
import { BaseSDKError } from '../errors.js';

export enum AgentInputEnum {
    USER = 'user',
    ASSISTANT = 'assistant',
    TOOL = 'tool',
    SYSTEM = 'system',
}

export type AgentIdentity = {
    role?: AgentInputEnum;

    goal?: string;

    description?: string;

    expertise?: string[];

    personality?: string;

    style?: string;

    systemPrompt?: string;

    language?: string;
    languageInstructions?: string;
};

export const agentIdentitySchema = z.object({
    role: z.enum(AgentInputEnum).optional(),
    goal: z.string().optional(),
    description: z.string().optional(),
    expertise: z.array(z.string()).optional(),
    personality: z.string().optional(),
    style: z.string().optional(),
    systemPrompt: z.string().optional(),
    language: z.string().optional(),
    languageInstructions: z.string().optional(),
});

export interface AgentAction<TContent = unknown> {
    type: string;
    content?: TContent;
    reasoning?: string;
    toolName?: string;
    input?: any;
}

export interface AgentThought<TContent = unknown> {
    reasoning: string;
    action: AgentAction<TContent>;
    confidence?: number;
    metadata?: Record<string, unknown>;
}

export type ThinkFunction<TInput = unknown, TContent = unknown> = (
    input: TInput,
    context: AgentContext,
) => Promise<AgentThought<TContent>>;

export type AgentConfig = {
    name: string;
    identity: AgentIdentity;
    maxIterations?: number;
    executionMode?: 'simple' | 'workflow';
    enableSession?: boolean;
    enableState?: boolean;
    enableMemory?: boolean;
    timeout?: number;
    llmDefaults?: LLMDefaults;
    plannerOptions?: {
        type: PlannerType;
        replanPolicy?: Partial<ReplanPolicyConfig>;
    };
};

export interface SimpleExecutionRuntime {
    startExecution(agentName: string): Promise<void>;
    endExecution(result: {
        success: boolean;
        error?: Error;
        outputSummary?: string;
    }): Promise<void>;
    updateExecution(updates: {
        iteration?: number;
        toolsUsed?: string[];
        currentThought?: string;
    }): void;
    getExecutionInfo(): {
        executionId: string;
        isRunning: boolean;
        duration: number;
        agentName?: string;
        identifiers: {
            sessionId: string;
            tenantId: string;
            threadId: string;
        };
    };
    health(): Promise<{ status: 'healthy' | 'unhealthy'; details: unknown }>;
    cleanup(): Promise<void>;
    getSummary(): {
        executionId: string;
        agentName?: string;
        status: 'running' | 'completed' | 'idle';
        duration: number;
    };
}

// export const agentActionTypeSchema = z.enum([
//     'initialized',
//     'final_answer',
//     'need_more_info',
//     'tool_call',
//     'execute_plan',
//     'delegate_to_agent',
//     'request_human_input',
//     'wait_for_condition',
//     'parallel_execution',
//     'conditional_branch',

//     'parallel_tools',
//     'sequential_tools',
//     'conditional_tools',
//     'mixed_tools',
//     'dependency_tools',
// ]);
// export type AgentActionType = z.infer<typeof agentActionTypeSchema>;

export interface ParallelToolsAction extends AgentAction {
    type: 'parallel_tools';
    tools: ToolCall[];
    concurrency?: number;
    timeout?: number;
    failFast?: boolean;
    aggregateResults?: boolean;
    reasoning?: string;
}

export interface NeedMoreInfoAction extends AgentAction {
    type: 'need_more_info';
    question: string;
    context?: string;
    metadata?: Record<string, unknown>;
    reasoning?: string;
}

export interface SequentialToolsAction extends AgentAction {
    type: 'sequential_tools';
    tools: ToolCall[];
    stopOnError?: boolean;
    passResults?: boolean;
    timeout?: number;
    reasoning?: string;
}

export interface ConditionalToolsAction extends AgentAction {
    type: 'conditional_tools';
    tools: ToolCall[];
    conditions?: Record<string, unknown>;
    defaultTool?: string;
    evaluateAll?: boolean;
}

export interface MixedToolsAction extends AgentAction {
    type: 'mixed_tools';
    strategy: 'parallel' | 'sequential' | 'conditional' | 'adaptive';
    tools: ToolCall[];
    config?: {
        concurrency?: number;
        timeout?: number;
        failFast?: boolean;
        conditions?: Record<string, unknown>;
    };
}

export interface DependencyToolsAction extends AgentAction {
    type: 'dependency_tools';
    tools: ToolCall[];
    dependencies: Array<{
        toolName: string;
        dependencies: string[];
        type: 'required' | 'optional' | 'conditional';
        condition?: string;
        failureAction?: 'stop' | 'continue' | 'retry' | 'fallback';
        fallbackTool?: string;
    }>;
    config?: {
        maxConcurrency?: number;
        timeout?: number;
        failFast?: boolean;
    };
    reasoning?: string;
}

export interface AgentThought<TContent = unknown> {
    reasoning: string;
    action: AgentAction<TContent>;
    metadata?: Metadata;
}

export interface AgentDefinition<
    TInput = unknown,
    TOutput = unknown,
    TContent = unknown,
> extends BaseDefinition {
    identity: AgentIdentity;

    think: ThinkFunction<TInput, TContent>;

    onStart?: (
        input: TInput,
        context: AgentContext,
    ) => Promise<AgentThought<TContent>>;
    onFinish?: (output: TOutput) => Promise<AgentThought<TContent>>;
    onError?: (error: Error) => Promise<AgentThought<TContent>>;

    formatResponse?: (thought: AgentThought<TContent>) => TOutput;

    validateInput?: (input: unknown) => input is TInput;

    config?: AgentConfig;

    requiredTools?: string[];

    optionalTools?: string[];
}

export interface AgentContext {
    sessionId: string;
    tenantId: string;
    correlationId: string;
    thread: Thread;
    agentName: string;
    invocationId: string;
    agentExecutionOptions: AgentExecutionOptions;
    availableTools: ToolMetadataForPlanner[];
    signal: AbortSignal;
    executionId?: string;
    agentIdentity?: AgentIdentity;
}

export type AgentExecutionOptions = {
    agentName: string;
    thread: Thread;

    sessionId?: SessionId;

    tenantId?: string;
    correlationId?: string;

    timeout?: number;
    maxIterations?: number;

    userContext?: Record<string, any>;
    // Optional cancellation signal propagated across agent → LLM → tools
    signal?: AbortSignal;
};

export interface AgentExecutionResult extends BaseExecutionResult {
    output?: any;
    reasoning?: string;
    correlationId?: string;
    sessionId?: string;
    status?: string;
    executionId?: string;

    metadata: Metadata & {
        agentName: string;
        iterations: number;
        toolsUsed: number;
        thinkingTime: number;
    };
}

export function isNeedMoreInfoAction(
    action: AgentAction,
): action is NeedMoreInfoAction {
    return action.type === 'need_more_info';
}

export interface AgentStartPayload {
    agentName: string;
    tenantId: string;
    config?: Record<string, unknown>;
    context?: Record<string, unknown>;
}

export interface AgentStopPayload {
    agentName: string;
    tenantId: string;
    reason?: string;
    force?: boolean;
}

export interface AgentPausePayload {
    agentName: string;
    tenantId: string;
    reason?: string;
    saveSnapshot?: boolean;
}

export interface AgentResumePayload {
    agentName: string;
    tenantId: string;
    snapshotId?: string;
    context?: Record<string, unknown>;
}

export interface AgentSchedulePayload {
    agentName: string;
    tenantId: string;
    schedule: AgentScheduleConfig;
    config?: Record<string, unknown>;
}

export interface AgentScheduleConfig {
    schedule: string | number;
    timezone?: string;
    enabled?: boolean;
    maxExecutions?: number;
    retryOnFailure?: boolean;
    retryAttempts?: number;
    retryDelay?: number;
    repeat?: boolean;
}

export interface AgentLifecycleResult extends BaseExecutionResult<unknown> {
    agentName: string;
    operation: string;
    previousStatus: string;
    currentStatus: string;

    metadata: Metadata & {
        snapshotId?: string;
        executionTime: number;
        transitionValid: boolean;
        forceUsed?: boolean;
    };
}

export type EntityId = string;
export type TenantId = string;
export type SessionId = string;
export type ThreadId = string;
export type CorrelationId = string;
export type UserId = string;
export type InvocationId = string;
export type CallId = string;

export type ExecutionId = string;
export type WorkflowId = string;
export type StepId = string;

export type AgentId = string;
export type ToolId = string;

export type EventId = string;
export type OperationId = string;
export type ParentId = string;
export type SnapshotId = string;

export type ContextId = string;
export type MemoryId = string;
export type StateId = string;
export type WorkflowExecutionId = string;
export type ToolCallId = string;

export const identifierSchemas = {
    entityId: z.string().min(1),
    tenantId: z.string().min(1).max(100),
    sessionId: z.string().min(1),
    threadId: z.string().min(1),
    correlationId: z.string().min(1).max(100),
    userId: z.string().min(1),
    invocationId: z.string().min(1),
    executionId: z.string().min(1),
    workflowId: z.string().min(1),
    stepId: z.string().min(1),
    agentId: z.string().min(1),
    toolId: z.string().min(1),
    eventId: z.string().min(1),
    operationId: z.string().min(1),
    parentId: z.string().min(1),
    snapshotId: z.string().min(1),
} as const;

export type BaseContext = {
    tenantId: TenantId;
    correlationId: CorrelationId;
    startTime: number;
};

export type OperationContext = BaseContext & {
    operationId: OperationId;
    executionId: ExecutionId;
};

export type UserContext = Record<string, unknown>;

export interface ObservabilityContext extends BaseContext, OtelContext {
    sessionId?: SessionId;
    threadId?: ThreadId;
    executionId?: ExecutionId;
    metadata?: Record<string, unknown>;
}

export interface Metadata {
    [key: string]: unknown;
}

export interface BaseDefinition {
    name: string;
    description?: string;
    version?: string;
    metadata?: Metadata;
}

export interface BaseExecutionResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: Error;
    duration?: number;
    metadata?: Metadata;
}

export interface BaseEngineConfig {
    debug?: boolean;
    monitor?: boolean;
    timeout?: number;
    retries?: number;
    metadata?: Metadata;
}

export const baseStorageItemSchema = z.object({
    id: z.string().min(1),
    timestamp: z.number(),
    metadata: z.record(z.string(), z.unknown()).optional(),

    tenantId: z.string().optional(),
    correlationId: z.string().optional(),
    entityId: z.string().optional(),
});
export type BaseStorageItem = z.infer<typeof baseStorageItemSchema> &
    Partial<BaseContext>;

export const baseQueryFiltersSchema = z.object({
    fromTimestamp: z.number().optional(),
    toTimestamp: z.number().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    sortBy: z.string().optional(),
    sortDirection: z.enum(['asc', 'desc']).optional(),

    tenantId: z.string().optional(),
    entityId: z.string().optional(),
    correlationId: z.string().optional(),
});
export type BaseQueryFilters = z.infer<typeof baseQueryFiltersSchema>;

export const baseStorageStatsSchema = z.object({
    itemCount: z.number(),
    totalSize: z.number(),
    averageItemSize: z.number(),
    adapterType: z.string(),

    tenantId: z.string().optional(),
    healthStatus: z.enum(['healthy', 'degraded', 'unhealthy']).optional(),
});
export type BaseStorageStats = z.infer<typeof baseStorageStatsSchema>;

export const baseStorageConfigSchema = z.object({
    maxItems: z.number().int().positive().default(1000),
    enableCompression: z.boolean().default(true),
    cleanupInterval: z.number().int().positive().default(300000),
    timeout: z.number().int().positive().default(5000),
    retries: z.number().int().nonnegative().default(3),

    enableObservability: z.boolean().default(true),
    enableHealthChecks: z.boolean().default(true),
    enableMetrics: z.boolean().default(true),
});
export type BaseStorageConfig = z.infer<typeof baseStorageConfigSchema>;

export interface BaseStorage<T extends BaseStorageItem> {
    store(item: T): Promise<void>;

    retrieve(id: string): Promise<T | null>;

    delete(id: string): Promise<boolean>;

    clear(): Promise<void>;

    getStats(): Promise<BaseStorageStats>;

    isHealthy(): Promise<boolean>;

    initialize(): Promise<void>;

    cleanup(): Promise<void>;
}

export const sessionIdSchema = z.string().min(1);
export const entityIdSchema = z.string().min(1);
export interface Persistor {
    append(snap: Snapshot, options?: SnapshotOptions): Promise<void>;

    load(xcId: string): AsyncIterable<Snapshot>;

    has(hash: string): Promise<boolean>;

    getByHash?(hash: string): Promise<Snapshot | null>;

    listHashes?(xcId: string): Promise<string[]>;

    getStats?(): Promise<PersistorStats>;
}

export interface PersistorStats {
    snapshotCount: number;

    totalSizeBytes: number;

    avgSnapshotSizeBytes: number;

    deltaCompressionRatio?: number;
}

export interface Snapshot {
    xcId: string;

    ts: number;

    events: AnyEvent[];

    state: unknown;

    hash: string;
}

export interface DeltaSnapshot extends Snapshot {
    isDelta: true;

    baseHash: string;

    eventsDelta?: unknown;

    stateDelta?: unknown;
}

export interface SnapshotOptions {
    includeMetadata?: boolean;
    compression?: boolean;
    maxSize?: number;
    maxSnapshots?: number;
    useDelta?: boolean;
}

export type EventHandler<E extends AnyEvent = AnyEvent, R = AnyEvent | void> = (
    event: E,
) => Promise<R> | R;

export type HandlerReturn = AnyEvent | void | Promise<AnyEvent | void>;

export interface EventStream<T extends AnyEvent = AnyEvent>
    extends AsyncIterable<T> {
    filter(predicate: (event: T) => boolean): EventStream<T>;
    map<U extends AnyEvent>(mapper: (event: T) => U): EventStream<U>;
    until(predicate: (event: T) => boolean): EventStream<T>;
    takeUntil(predicate: (event: T) => boolean): EventStream<T>;
    toArray(): Promise<T[]>;
    withMiddleware(middleware: unknown): EventStream<T>;
    debounce(delayMs: number): EventStream<T>;
    throttle(intervalMs: number): EventStream<T>;
    batch(size: number, timeoutMs?: number): EventStream<AnyEvent>;
    merge(...streams: EventStream<T>[]): EventStream<T>;
    combineLatest(...streams: EventStream<T>[]): EventStream<AnyEvent>;
}

export function isBaseContext(obj: unknown): obj is BaseContext {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'executionId' in obj &&
        'tenantId' in obj &&
        'startTime' in obj &&
        'status' in obj
    );
}

export interface TimeoutConfig {
    defaultTimeoutMs: number;
    maxTimeoutMs?: number;
}

export interface Thread {
    id: ThreadId;

    metadata: {
        description?: string;

        [key: string]: string | number | undefined;
    };
}

export const threadMetadataSchema = z
    .object({
        description: z.string().optional(),
        type: z
            .enum(['user', 'organization', 'system', 'bot', 'custom'])
            .optional(),
    })
    .and(z.record(z.string(), z.union([z.string(), z.number()])));

export const threadSchema = z.object({
    id: z.string().min(1),
    metadata: threadMetadataSchema,
});

export const contextIdSchema = z.string().min(1);

export function isToolCallAction(
    action: AgentAction,
): action is Extract<AgentAction, { type: 'tool_call' }> {
    return action.type === 'tool_call';
}

export function isFinalAnswerAction(
    action: AgentAction,
): action is Extract<AgentAction, { type: 'final_answer' }> {
    return action.type === 'final_answer';
}

export const EVENT_TYPES = {
    AGENT_STARTED: 'agent.started',
    AGENT_INPUT: 'agent.input',
    AGENT_THINKING: 'agent.thinking',
    AGENT_THOUGHT: 'agent.thought',
    AGENT_COMPLETED: 'agent.completed',
    AGENT_FAILED: 'agent.failed',
    AGENT_QUESTION: 'agent.question',
    AGENT_ERROR: 'agent.error',
    AGENT_LIFECYCLE_STARTED: 'agent.lifecycle.started',
    AGENT_LIFECYCLE_STOPPED: 'agent.lifecycle.stopped',
    AGENT_LIFECYCLE_PAUSED: 'agent.lifecycle.paused',
    AGENT_LIFECYCLE_RESUMED: 'agent.lifecycle.resumed',
    AGENT_LIFECYCLE_SCHEDULED: 'agent.lifecycle.scheduled',
    AGENT_LIFECYCLE_ERROR: 'agent.lifecycle.error',
    AGENT_LIFECYCLE_STATUS_CHANGED: 'agent.lifecycle.status_changed',

    TOOL_CALLED: 'tool.called',
    TOOL_CALL: 'tool.call',
    TOOL_RESULT: 'tool.result',
    TOOL_ERROR: 'tool.error',
    TOOL_COMPLETED: 'tool.completed',

    WORKFLOW_STARTED: 'workflow.started',
    WORKFLOW_START: 'workflow.start',
    WORKFLOW_COMPLETED: 'workflow.completed',
    WORKFLOW_COMPLETE: 'workflow.complete',
    WORKFLOW_FAILED: 'workflow.failed',
    WORKFLOW_ERROR: 'workflow.error',
    WORKFLOW_PAUSED: 'workflow.paused',
    WORKFLOW_RESUMED: 'workflow.resumed',
    WORKFLOW_CANCELED: 'workflow.canceled',
    WORKFLOW_RUN: 'workflow.run',

    CONTEXT_CREATED: 'context.created',
    CONTEXT_UPDATED: 'context.updated',
    CONTEXT_DESTROYED: 'context.destroyed',
    CONTEXT_TIMEOUT: 'context.timeout',

    STATE_UPDATED: 'state.updated',
    STATE_DELETED: 'state.deleted',

    STEP_STARTED: 'step.started',
    STEP_COMPLETED: 'step.completed',
    STEP_FAILED: 'step.failed',
    STEP_SKIPPED: 'step.skipped',

    KERNEL_STARTED: 'kernel.started',
    KERNEL_PAUSED: 'kernel.paused',
    KERNEL_RESUMED: 'kernel.resumed',
    KERNEL_COMPLETED: 'kernel.completed',
    EXECUTION_COMPLETED: 'execution.completed',
    EXECUTION_RUN: 'execution.run',
    KERNEL_QUOTA_EXCEEDED: 'kernel.quota.exceeded',

    ROUTER_ROUTE: 'router.route',

    MCP_CONNECTED: 'mcp.connected',
    MCP_DISCONNECTED: 'mcp.disconnected',
    MCP_TOOL_CALLED: 'mcp.tool.called',
    MCP_TOOL_RESULT: 'mcp.tool.result',
    MCP_ERROR: 'mcp.error',

    PLANNER_STARTED: 'planner.started',
    PLANNER_COMPLETED: 'planner.completed',
    PLANNER_FAILED: 'planner.failed',
    PLANNER_STEP_COMPLETED: 'planner.step.completed',

    ECOSYSTEM_DISCOVER: 'ecosystem.discover',
    ECOSYSTEM_BROADCAST: 'ecosystem.broadcast',
    AGENT_DELEGATE: 'agent.delegate',

    SYSTEM_ERROR: 'system.error',
    SYSTEM_WARNING: 'system.warning',
    SYSTEM_INFO: 'system.info',

    STREAM_ERROR: 'stream.error',
    STREAM_BATCH: 'stream.batch',

    ERROR: 'error',

    HUMAN_INTERVENTION_REQUESTED: 'human.intervention.requested',
    HUMAN_INTERVENTION_COMPLETED: 'human.intervention.completed',

    MEMORY_HEAP: 'memory.heap',
    MEMORY_UTILIZATION: 'memory.utilization',
    RESOURCES_CONTEXTS: 'resources.contexts',
    RESOURCES_GENERATORS: 'resources.generators',
    PERFORMANCE_EVENT_RATE: 'performance.eventRate',
    PERFORMANCE_AVG_PROCESSING_TIME: 'performance.avgProcessingTime',
    PERFORMANCE_ERROR_RATE: 'performance.errorRate',

    AGENT_CALL: 'agent.call',

    START: 'start',
    BENCHMARK: 'benchmark',
    DONE: 'done',
    HIGH_VOLUME: 'high-volume',
    START_LIFECYCLE: 'START_LIFECYCLE',
    PROCESS_LIFECYCLE: 'PROCESS_LIFECYCLE',
    STOP_LIFECYCLE: 'STOP_LIFECYCLE',
    AFTER_STOP_LIFECYCLE: 'AFTER_STOP_LIFECYCLE',

    STEP_PREFIX: 'step.',

    CONCURRENT: 'concurrent',
    METRIC: 'metric',
    STEP_EVENT: 'step.event',
    WORKFLOW_STEP: 'workflow.step',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES] | string;

export interface EventPayloads {
    [EVENT_TYPES.AGENT_STARTED]: {
        agentName: string;
        input: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.AGENT_INPUT]: {
        input: unknown;
        agent: string;
        correlationId?: string;
    };

    [EVENT_TYPES.AGENT_THINKING]: {
        agentName: string;
        input: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.AGENT_THOUGHT]: {
        agentName: string;
        thought: AgentThought;
        correlationId?: string;
    };

    [EVENT_TYPES.AGENT_COMPLETED]: {
        result: unknown;
        agent: string;
        reasoning: string;
    };

    [EVENT_TYPES.AGENT_FAILED]: {
        error: string;
        agent: string;
        reasoning?: string;
    };

    [EVENT_TYPES.AGENT_QUESTION]: {
        question: string;
        agent: string;
        correlationId?: string;
    };

    [EVENT_TYPES.AGENT_ERROR]: {
        error: string;
        agent: string;
        correlationId?: string;
    };

    [EVENT_TYPES.AGENT_LIFECYCLE_STARTED]: {
        agentName: string;
        tenantId: string;
        executionId: string;
        status: string;
        startedAt: number;
    };

    [EVENT_TYPES.AGENT_LIFECYCLE_STOPPED]: {
        agentName: string;
        tenantId: string;
        status: string;
        stoppedAt: number;
        reason?: string;
    };

    [EVENT_TYPES.AGENT_LIFECYCLE_PAUSED]: {
        agentName: string;
        tenantId: string;
        status: string;
        pausedAt: number;
        snapshotId?: string;
        reason?: string;
    };

    [EVENT_TYPES.AGENT_LIFECYCLE_RESUMED]: {
        agentName: string;
        tenantId: string;
        status: string;
        resumedAt: number;
        snapshotId?: string;
    };

    [EVENT_TYPES.AGENT_LIFECYCLE_SCHEDULED]: {
        agentName: string;
        tenantId: string;
        status: string;
        scheduleTime: number;
        scheduleConfig: unknown;
    };

    [EVENT_TYPES.AGENT_LIFECYCLE_ERROR]: {
        agentName: string;
        tenantId: string;
        operation: string;
        error: string;
        details?: unknown;
        timestamp: number;
    };

    [EVENT_TYPES.AGENT_LIFECYCLE_STATUS_CHANGED]: {
        agentName: string;
        tenantId: string;
        fromStatus: string;
        toStatus: string;
        reason?: string;
        timestamp: number;
    };

    [EVENT_TYPES.TOOL_CALLED]: {
        toolName: string;
        input: unknown;
        agent: string;
        correlationId?: string;
    };

    [EVENT_TYPES.TOOL_CALL]: {
        toolName: string;
        input: unknown;
        agent: string;
        correlationId?: string;
    };

    [EVENT_TYPES.TOOL_RESULT]: {
        result: unknown;
        agent: string;
        reasoning: string;
        toolName: string;
    };

    [EVENT_TYPES.TOOL_ERROR]: {
        error: string;
        toolName: string;
        agent: string;
        reasoning?: string;
    };

    [EVENT_TYPES.TOOL_COMPLETED]: {
        toolName: string;
        result: unknown;
        agent: string;
    };

    [EVENT_TYPES.WORKFLOW_STARTED]: {
        workflowName: string;
        input: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.WORKFLOW_START]: {
        input: unknown;
    };

    [EVENT_TYPES.WORKFLOW_COMPLETED]: {
        workflowName: string;
        result: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.WORKFLOW_COMPLETE]: {
        result: unknown;
    };

    [EVENT_TYPES.WORKFLOW_FAILED]: {
        workflowName: string;
        error: string;
        correlationId?: string;
    };

    [EVENT_TYPES.WORKFLOW_ERROR]: {
        error: Error;
        step: string;
    };

    [EVENT_TYPES.WORKFLOW_PAUSED]: {
        workflowName: string;
        reason: string;
        snapshotId: string;
    };

    [EVENT_TYPES.WORKFLOW_RESUMED]: {
        workflowName: string;
        snapshotId: string;
    };

    [EVENT_TYPES.WORKFLOW_CANCELED]: {
        workflowName: string;
        reason: string;
        correlationId?: string;
    };

    [EVENT_TYPES.WORKFLOW_RUN]: {
        input: unknown;
    };

    [EVENT_TYPES.CONTEXT_CREATED]: {
        executionId: string;
        tenantId: string;
    };

    [EVENT_TYPES.CONTEXT_UPDATED]: {
        executionId: string;
        updates: Record<string, unknown>;
    };

    [EVENT_TYPES.CONTEXT_DESTROYED]: {
        executionId: string;
        reason?: string;
    };

    [EVENT_TYPES.CONTEXT_TIMEOUT]: {
        executionId: string;
        timeoutMs: number;
    };

    [EVENT_TYPES.STATE_UPDATED]: {
        namespace: string;
        key: string;
        value: unknown;
    };

    [EVENT_TYPES.STATE_DELETED]: {
        namespace: string;
        key: string;
    };

    [EVENT_TYPES.STEP_STARTED]: {
        stepName: string;
        input: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.STEP_COMPLETED]: {
        stepName: string;
        result: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.STEP_FAILED]: {
        stepName: string;
        error: string;
        correlationId?: string;
    };

    [EVENT_TYPES.STEP_SKIPPED]: {
        stepName: string;
        reason: string;
        correlationId?: string;
    };

    [EVENT_TYPES.KERNEL_STARTED]: {
        kernelId: string;
        tenantId: string;
    };

    [EVENT_TYPES.KERNEL_PAUSED]: {
        kernelId: string;
        reason: string;
        snapshotId: string;
    };

    [EVENT_TYPES.KERNEL_RESUMED]: {
        kernelId: string;
        snapshotId: string;
    };

    [EVENT_TYPES.KERNEL_COMPLETED]: {
        kernelId: string;
        result: unknown;
    };

    [EVENT_TYPES.EXECUTION_COMPLETED]: {
        executionId: string;
        result: unknown;
    };

    [EVENT_TYPES.EXECUTION_RUN]: {
        input: unknown;
    };

    [EVENT_TYPES.KERNEL_QUOTA_EXCEEDED]: {
        kernelId: string;
        type: string;
    };

    [EVENT_TYPES.ROUTER_ROUTE]: {
        routerName: string;
        input: unknown;
        route: string;
        correlationId?: string;
    };

    [EVENT_TYPES.MCP_CONNECTED]: {
        threadId: string;
    };

    [EVENT_TYPES.MCP_DISCONNECTED]: {
        threadId: string;
    };

    [EVENT_TYPES.MCP_TOOL_CALLED]: {
        toolName: string;
        input: unknown;
        threadId: string;
        correlationId?: string;
    };

    [EVENT_TYPES.MCP_TOOL_RESULT]: {
        result: unknown;
        toolName: string;
        threadId: string;
        correlationId?: string;
    };

    [EVENT_TYPES.MCP_ERROR]: {
        error: string;
        threadId: string;
        correlationId?: string;
    };

    [EVENT_TYPES.PLANNER_STARTED]: {
        plannerName: string;
        input: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.PLANNER_COMPLETED]: {
        plannerName: string;
        result: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.PLANNER_FAILED]: {
        plannerName: string;
        error: string;
        correlationId?: string;
    };

    [EVENT_TYPES.PLANNER_STEP_COMPLETED]: {
        plannerName: string;
        stepName: string;
        result: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.ECOSYSTEM_DISCOVER]: {
        criteria: {
            capability?: string;
            specialization?: string;
            availability?: boolean;
        };
        results: string[];
        correlationId?: string;
    };

    [EVENT_TYPES.ECOSYSTEM_BROADCAST]: {
        event: string;
        data: unknown;
        recipients?: string[];
        correlationId?: string;
    };

    [EVENT_TYPES.AGENT_DELEGATE]: {
        targetAgent: string;
        input: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.SYSTEM_ERROR]: {
        error: string;
        context?: Record<string, unknown>;
    };

    [EVENT_TYPES.SYSTEM_WARNING]: {
        warning: string;
        context?: Record<string, unknown>;
    };

    [EVENT_TYPES.SYSTEM_INFO]: {
        message: string;
        context?: Record<string, unknown>;
    };

    [EVENT_TYPES.STREAM_ERROR]: {
        originalEvent: TEvent<EventType>;
        handler: string;
        error: unknown;
        timestamp: number;
        attempt: number;
        recoverable: boolean;
    };

    [EVENT_TYPES.STREAM_BATCH]: {
        events: TEvent<EventType>[];
        size: number;
    };

    [EVENT_TYPES.ERROR]: {
        originalEvent: TEvent<EventType>;
        handler: string;
        error: unknown;
        timestamp: number;
        attempt: number;
        recoverable: boolean;
    };

    [EVENT_TYPES.HUMAN_INTERVENTION_REQUESTED]: {
        reason: string;
        context: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.HUMAN_INTERVENTION_COMPLETED]: {
        result: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.MEMORY_HEAP]: {
        used: number;
        total: number;
        percentage: number;
    };

    [EVENT_TYPES.MEMORY_UTILIZATION]: {
        percentage: number;
        details: Record<string, number>;
    };

    [EVENT_TYPES.RESOURCES_CONTEXTS]: {
        active: number;
        total: number;
        details: Record<string, number>;
    };

    [EVENT_TYPES.RESOURCES_GENERATORS]: {
        active: number;
        total: number;
        details: Record<string, number>;
    };

    [EVENT_TYPES.PERFORMANCE_EVENT_RATE]: {
        eventsPerSecond: number;
        window: number;
    };

    [EVENT_TYPES.PERFORMANCE_AVG_PROCESSING_TIME]: {
        avgTimeMs: number;
        samples: number;
    };

    [EVENT_TYPES.PERFORMANCE_ERROR_RATE]: {
        errorRate: number;
        totalEvents: number;
        errorEvents: number;
    };

    [EVENT_TYPES.AGENT_CALL]: {
        agentName: string;
        input: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.START]: void;

    [EVENT_TYPES.BENCHMARK]: {
        id: number;
    };

    [EVENT_TYPES.DONE]: void;

    [EVENT_TYPES.HIGH_VOLUME]: {
        id: number;
    };

    [EVENT_TYPES.START_LIFECYCLE]: void;

    [EVENT_TYPES.PROCESS_LIFECYCLE]: {
        id: number;
    };

    [EVENT_TYPES.STOP_LIFECYCLE]: void;

    [EVENT_TYPES.AFTER_STOP_LIFECYCLE]: void;

    [EVENT_TYPES.STEP_PREFIX]: {
        stepName: string;
        input: unknown;
        correlationId?: string;
    };

    [EVENT_TYPES.CONCURRENT]: {
        id: string;
        key: string;
    };

    [EVENT_TYPES.METRIC]: {
        id: string;
        key: string;
    };

    [EVENT_TYPES.STEP_EVENT]: {
        stepName: string;
        input: unknown;
    };

    [EVENT_TYPES.WORKFLOW_STEP]: {
        stepName: string;
        input: unknown;
    };

    [key: string]: unknown;
}

export interface TEvent<K extends EventType = EventType> {
    readonly id: string;
    readonly type: K;
    readonly data: EventPayloads[K];
    readonly ts: number;
    readonly threadId: string;
    metadata?: {
        correlationId?: string;
        deliveryGuarantee?: 'at-most-once' | 'at-least-once' | 'exactly-once';
        tenantId?: string;
        executionId?: string;
        timestamp?: number;
        [key: string]: unknown;
    };
}

export type AnyEvent = TEvent<EventType>;

export type EventDef<P, K extends EventType> = {
    type: K;
    with(data: P): TEvent<K>;
    include(event: AnyEvent): event is TEvent<K>;
};

export function isEventType<K extends EventType>(
    event: AnyEvent,
    eventType: K,
): event is TEvent<K> {
    return event.type === eventType;
}

export function createEvent<K extends EventType>(
    type: K,
    data?: EventPayloads[K],
    options?: {
        id?: string;
        timestamp?: number;
        threadId?: string;
    },
): TEvent<K> {
    const eventId = options?.id || IdGenerator.callId();

    return {
        id: eventId,
        type,
        data: data as EventPayloads[K],
        ts: options?.timestamp || Date.now(),
        threadId: options?.threadId || IdGenerator.callId(),
    };
}

export const agentLifecycleEvents = {
    started: (
        data: EventPayloads[typeof EVENT_TYPES.AGENT_LIFECYCLE_STARTED],
    ) => createEvent(EVENT_TYPES.AGENT_LIFECYCLE_STARTED, data),

    stopped: (
        data: EventPayloads[typeof EVENT_TYPES.AGENT_LIFECYCLE_STOPPED],
    ) => createEvent(EVENT_TYPES.AGENT_LIFECYCLE_STOPPED, data),

    paused: (data: EventPayloads[typeof EVENT_TYPES.AGENT_LIFECYCLE_PAUSED]) =>
        createEvent(EVENT_TYPES.AGENT_LIFECYCLE_PAUSED, data),

    resumed: (
        data: EventPayloads[typeof EVENT_TYPES.AGENT_LIFECYCLE_RESUMED],
    ) => createEvent(EVENT_TYPES.AGENT_LIFECYCLE_RESUMED, data),

    scheduled: (
        data: EventPayloads[typeof EVENT_TYPES.AGENT_LIFECYCLE_SCHEDULED],
    ) => createEvent(EVENT_TYPES.AGENT_LIFECYCLE_SCHEDULED, data),

    error: (data: EventPayloads[typeof EVENT_TYPES.AGENT_LIFECYCLE_ERROR]) =>
        createEvent(EVENT_TYPES.AGENT_LIFECYCLE_ERROR, data),

    statusChanged: (
        data: EventPayloads[typeof EVENT_TYPES.AGENT_LIFECYCLE_STATUS_CHANGED],
    ) => createEvent(EVENT_TYPES.AGENT_LIFECYCLE_STATUS_CHANGED, data),
};

export const memoryIdSchema = z.string().min(1);

export const memoryItemSchema = z.object({
    id: memoryIdSchema,
    key: z.string(),
    value: z.unknown(),
    type: z.string().optional(),
    timestamp: z.number(),
    expireAt: z.number().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    entityId: entityIdSchema.optional(),
    sessionId: sessionIdSchema.optional(),
    tenantId: z.string().optional(),
    contextId: contextIdSchema.optional(),
});
export type MemoryItem = z.infer<typeof memoryItemSchema>;

export const memoryScopeSchema = z.enum([
    'global',
    'tenant',
    'entity',
    'session',
    'context',
]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryQuerySchema = z.object({
    key: z.string().optional(),
    keyPattern: z.string().optional(),
    type: z.string().optional(),
    scope: memoryScopeSchema.optional(),
    entityId: entityIdSchema.optional(),
    sessionId: sessionIdSchema.optional(),
    tenantId: z.string().optional(),
    contextId: contextIdSchema.optional(),
    fromTimestamp: z.number().optional(),
    toTimestamp: z.number().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    sortBy: z.string().optional(),
    sortDirection: z.enum(['asc', 'desc']).optional(),
});
export type MemoryQuery = z.infer<typeof memoryQuerySchema>;

export const memoryStoreOptionsSchema = z.object({
    defaultTtlMs: z.number().int().positive().optional(),

    storage: z
        .object({
            type: z.enum(['memory', 'custom']),
            config: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
});
export type MemoryStoreOptions = z.infer<typeof memoryStoreOptionsSchema>;

export const memoryVectorSchema = z.object({
    id: memoryIdSchema,
    vector: z.array(z.number()),
    text: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    timestamp: z.number(),
    entityId: entityIdSchema.optional(),
    sessionId: sessionIdSchema.optional(),
    tenantId: z.string().optional(),
    contextId: contextIdSchema.optional(),
});
export type MemoryVector = z.infer<typeof memoryVectorSchema>;

export const memoryVectorQuerySchema = z.object({
    vector: z.array(z.number()),
    text: z.string().optional(),
    topK: z.number().int().positive(),
    minScore: z.number().optional(),
    filter: z
        .object({
            entityId: entityIdSchema.optional(),
            sessionId: sessionIdSchema.optional(),
            tenantId: z.string().optional(),
            contextId: contextIdSchema.optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
});
export type MemoryVectorQuery = z.infer<typeof memoryVectorQuerySchema>;

export const memoryVectorStoreOptionsSchema = z.object({
    dimensions: z.number().int().positive(),

    distanceMetric: z.enum(['cosine', 'euclidean', 'dot']).optional(),

    storage: z
        .object({
            type: z.enum(['memory', 'pinecone', 'qdrant', 'custom']),
            config: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
});
export type MemoryVectorStoreOptions = z.infer<
    typeof memoryVectorStoreOptionsSchema
>;

export const memoryVectorSearchResultSchema = z.object({
    id: memoryIdSchema,
    score: z.number(),
    vector: z.array(z.number()).optional(),
    text: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    timestamp: z.number(),
    entityId: entityIdSchema.optional(),
    sessionId: sessionIdSchema.optional(),
    tenantId: z.string().optional(),
    contextId: contextIdSchema.optional(),
});
export type MemoryVectorSearchResult = z.infer<
    typeof memoryVectorSearchResultSchema
>;

export const memoryManagerOptionsSchema = z.object({
    storeOptions: memoryStoreOptionsSchema.optional(),

    vectorStoreOptions: memoryVectorStoreOptionsSchema.optional(),

    autoVectorizeText: z.boolean().optional(),

    defaultScope: memoryScopeSchema.optional(),
});
export type MemoryManagerOptions = z.infer<typeof memoryManagerOptionsSchema>;

export const UNIFIED_STATUS = {
    PENDING: 'pending',
    EXECUTING: 'executing',
    COMPLETED: 'completed',
    FAILED: 'failed',

    REPLANNING: 'replanning',
    WAITING_INPUT: 'waiting_input',
    PAUSED: 'paused',
    CANCELLED: 'cancelled',
    SKIPPED: 'skipped',

    REWRITING: 'rewriting',
    OBSERVING: 'observing',
    PARALLEL: 'parallel',

    STAGNATED: 'stagnated',
    TIMEOUT: 'timeout',
    DEADLOCK: 'deadlock',

    FINAL_ANSWER_RESULT: 'final_answer_result',
} as const;

export type UnifiedStatus =
    (typeof UNIFIED_STATUS)[keyof typeof UNIFIED_STATUS];

export const VALID_STATUS_TRANSITIONS: Record<UnifiedStatus, UnifiedStatus[]> =
    {
        [UNIFIED_STATUS.PENDING]: [
            UNIFIED_STATUS.EXECUTING,
            UNIFIED_STATUS.CANCELLED,
            UNIFIED_STATUS.SKIPPED,
        ],
        [UNIFIED_STATUS.EXECUTING]: [
            UNIFIED_STATUS.COMPLETED,
            UNIFIED_STATUS.FAILED,
            UNIFIED_STATUS.REPLANNING,
            UNIFIED_STATUS.WAITING_INPUT,
            UNIFIED_STATUS.PAUSED,
            UNIFIED_STATUS.CANCELLED,
            UNIFIED_STATUS.REWRITING,
            UNIFIED_STATUS.OBSERVING,
            UNIFIED_STATUS.PARALLEL,
            UNIFIED_STATUS.STAGNATED,
            UNIFIED_STATUS.TIMEOUT,
            UNIFIED_STATUS.DEADLOCK,
        ],
        [UNIFIED_STATUS.COMPLETED]: [],
        [UNIFIED_STATUS.FAILED]: [
            UNIFIED_STATUS.REPLANNING,
            UNIFIED_STATUS.CANCELLED,
        ],
        [UNIFIED_STATUS.REPLANNING]: [
            UNIFIED_STATUS.EXECUTING,
            UNIFIED_STATUS.FAILED,
            UNIFIED_STATUS.CANCELLED,
        ],
        [UNIFIED_STATUS.WAITING_INPUT]: [
            UNIFIED_STATUS.EXECUTING,
            UNIFIED_STATUS.CANCELLED,
        ],
        [UNIFIED_STATUS.PAUSED]: [
            UNIFIED_STATUS.EXECUTING,
            UNIFIED_STATUS.CANCELLED,
        ],
        [UNIFIED_STATUS.CANCELLED]: [],
        [UNIFIED_STATUS.SKIPPED]: [],
        [UNIFIED_STATUS.REWRITING]: [
            UNIFIED_STATUS.EXECUTING,
            UNIFIED_STATUS.FAILED,
            UNIFIED_STATUS.CANCELLED,
        ],
        [UNIFIED_STATUS.OBSERVING]: [
            UNIFIED_STATUS.EXECUTING,
            UNIFIED_STATUS.FAILED,
            UNIFIED_STATUS.CANCELLED,
        ],
        [UNIFIED_STATUS.PARALLEL]: [
            UNIFIED_STATUS.EXECUTING,
            UNIFIED_STATUS.FAILED,
            UNIFIED_STATUS.CANCELLED,
        ],
        [UNIFIED_STATUS.STAGNATED]: [
            UNIFIED_STATUS.EXECUTING,
            UNIFIED_STATUS.FAILED,
            UNIFIED_STATUS.CANCELLED,
        ],
        [UNIFIED_STATUS.TIMEOUT]: [
            UNIFIED_STATUS.REPLANNING,
            UNIFIED_STATUS.CANCELLED,
        ],
        [UNIFIED_STATUS.DEADLOCK]: [
            UNIFIED_STATUS.REPLANNING,
            UNIFIED_STATUS.CANCELLED,
        ],
        [UNIFIED_STATUS.FINAL_ANSWER_RESULT]: [],
    };

export function isValidStatusTransition(
    from: UnifiedStatus,
    to: UnifiedStatus,
): boolean {
    return VALID_STATUS_TRANSITIONS[from].includes(to);
}
export interface PlanStep {
    id: string;
    description: string;
    type?:
        | 'action'
        | 'decision'
        | 'verification'
        | 'delegation'
        | 'aggregation'
        | 'checkpoint';

    tool?: string;
    agent?: string;
    arguments?: Record<string, unknown>;

    dependencies?: string[];
    dependents?: string[];

    status: string;
    parallel?: boolean;
    optional?: boolean;
    retry?: number;
    retryCount?: number;
    maxRetries?: number;

    result?: unknown;
    error?: string;
    startTime?: number;
    endTime?: number;
    duration?: number;

    reasoning?: string;
    confidence?: number;
    metadata?: Record<string, unknown>;
}

export interface ExecutionPlan {
    id: string;
    strategy: string;
    version?: string;
    goal: string;
    reasoning: string;
    steps: PlanStep[];
    status: string;
    currentStepIndex: number;
    signals?: PlanSignals;
    createdAt: number;
    updatedAt: number;
    executionStartTime?: number;
    executionEndTime?: number;
    metadata?: Record<string, unknown>;
}

export interface StepExecutionResult {
    stepId: string;
    step: PlanStep;
    success: boolean;
    result?: unknown;
    error?: string;
    executedAt: number;
    duration: number;
    retryCount?: number;
}

export type PlanExecutionResultType =
    | 'execution_complete'
    | 'needs_replan'
    | 'deadlock'
    | 'cancelled'
    | 'timeout'
    | 'budget_exceeded';

export interface PlanExecutionResult {
    type: PlanExecutionResultType;
    planId: string;
    strategy: string;
    totalSteps: number;
    executedSteps: StepExecutionResult[];
    successfulSteps: string[];
    failedSteps: string[];
    skippedSteps: string[];
    hasSignalsProblems: boolean;
    signals?: PlanSignals;
    executionTime: number;
    feedback: string;
    confidence?: number;
    replanContext?: ReplanContext;
}

export interface ReplanPolicyConfig {
    maxReplans?: number;
    toolUnavailable?: 'replan' | 'ask_user' | 'fail';
}

export function getReadySteps(plan: ExecutionPlan): PlanStep[] {
    return plan.steps.filter((step) => {
        if (step.status !== 'step_pending') return false;
        if (!step.dependencies || step.dependencies.length === 0) return true;

        return step.dependencies.every((depId) => {
            const depStep = plan.steps.find((s) => s.id === depId);

            if (depStep?.status === 'step_failed') {
                return false;
            }
            return depStep?.status === 'step_completed';
        });
    });
}

export interface PlanExecutionData {
    plan: {
        id: string;
        goal: string;
        strategy?: string;
        totalSteps?: number;
        steps?: unknown[];
    };
    executionData: {
        toolsThatWorked?: unknown[];
        toolsThatFailed?: unknown[];
        toolsNotExecuted?: unknown[];
    };
    signals?: PlanSignals;
}

export interface ReplanContext {
    isReplan: boolean;
    executedPlan: PlanExecutionData;
    planHistory?: PlanExecutionData[];
}

export function isExecutePlanAction(action: AgentAction | unknown): boolean {
    return (
        typeof action === 'object' &&
        action !== null &&
        'type' in action &&
        action.type === 'execute_plan'
    );
}

export const retryOptionsSchema = z.object({
    maxRetries: z.number().int().nonnegative().default(2),
    initialDelayMs: z.number().int().positive().default(100),
    maxDelayMs: z.number().int().positive().default(2000),
    maxTotalMs: z.number().int().positive().default(60_000),
    backoffFactor: z.number().positive().default(2),
    jitter: z.boolean().default(true),
    retryableErrorCodes: z
        .array(
            z.enum([
                'NETWORK_ERROR',
                'TIMEOUT_ERROR',
                'TIMEOUT_EXCEEDED',
                'DEPENDENCY_ERROR',
            ] as const),
        )
        .default(['NETWORK_ERROR', 'TIMEOUT_ERROR', 'TIMEOUT_EXCEEDED']),
    retryableStatusCodes: z
        .array(z.number().int())
        .default([408, 429, 500, 502, 503, 504]),
    retryPredicate: z.instanceof(Function).optional(),
});
export type RetryOptions = z.infer<typeof retryOptionsSchema>;

export const toolIdSchema = z.string().min(1);
export type ToolIdSchema = z.infer<typeof toolIdSchema>;
export const toolCallIdSchema = z.string().min(1);

export interface ToolJSONSchema {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
    };
}

export type ToolHandler<TInput = unknown, TOutput = unknown> = (
    input: TInput,
    context: ToolContext,
) => Promise<TOutput> | TOutput;

export interface ToolDefinition<TInput = unknown, TOutput = unknown>
    extends BaseDefinition {
    execute: ToolHandler<TInput, TOutput>;

    inputSchema: z.ZodSchema<TInput>;

    inputJsonSchema?: ToolJSONSchema;

    outputSchema?: z.ZodSchema<TOutput>;
    outputJsonSchema?: ToolJSONSchema;

    config?: {
        timeout?: number;
        requiresAuth?: boolean;
        allowParallel?: boolean;
        maxConcurrentCalls?: number;

        serverName?: string;
        mcpTool?: boolean;

        source?: 'mcp' | 'user' | 'system';
    };

    categories?: string[];

    errorHandling?: {
        retryStrategy?: 'exponential' | 'linear' | 'none';
        maxRetries?: number;
        fallbackAction?: string;
        errorMessages?: Record<string, string>;
    };

    dependencies?: string[];
    tags?: string[];
}

export type ToolMetadataForLLM = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
};

export interface ToolMetadataForPlanner {
    name: string;
    description: string;

    inputSchema: {
        type: 'object';
        properties: Record<
            string,
            {
                type: string;
                description?: string;
                required: boolean;
                enum?: string[];
                default?: unknown;
                format?: string;
            }
        >;
        required: string[];
    };

    outputSchema?: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };

    config: {
        timeout: number;
        requiresAuth: boolean;
        allowParallel: boolean;
        maxConcurrentCalls: number;
        source: 'mcp' | 'user' | 'system';
    };

    categories: string[];
    dependencies: string[];
    tags: string[];

    plannerHints?: {
        useWhen?: string[];
        avoidWhen?: string[];
        combinesWith?: string[];
        conflictsWith?: string[];
    };

    errorHandling?: {
        retryStrategy?: 'exponential' | 'linear' | 'none';
        maxRetries?: number;
        fallbackAction?: string;
        errorMessages?: Record<string, string>;
    };
}

export interface ToolContext extends BaseContext {
    toolName: string;
    callId: string;

    parameters: Record<string, unknown>;

    signal: AbortSignal;

    logger?: {
        debug: (message: string, meta?: Record<string, unknown>) => void;
        info: (message: string, meta?: Record<string, unknown>) => void;
        warn: (message: string, meta?: Record<string, unknown>) => void;
        error: (
            message: string,
            error?: Error,
            meta?: Record<string, unknown>,
        ) => void;
    };

    cleanup(): Promise<void>;
}

export interface ToolEngineConfig extends BaseEngineConfig {
    validateSchemas?: boolean;
    allowOverrides?: boolean;
    defaultToolTimeout?: number;
    maxConcurrentCalls?: number;

    retry?: Partial<RetryOptions>;
    retryOptions?: Partial<RetryOptions>;

    timeout?: number;

    sandboxEnabled?: boolean;
    allowedCategories?: string[];
}

export interface ToolDependency {
    toolName: string;
    dependencies?: string[];
    type: 'required' | 'optional' | 'conditional';
    condition?: string | ((context: ToolContext) => boolean);
    failureAction?: 'stop' | 'continue' | 'retry' | 'fallback';
    fallbackTool?: string;
}

export interface ToolCall {
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    timestamp: number;
    correlationId?: string;
    metadata?: Metadata;
}

export interface ToolResult<TOutput = any> {
    type: 'tool_result';
    callId: string;
    toolName: string;
    result?: TOutput;
    error?: string;
    timestamp: number;
    duration: number;
    content: string;
    metadata?: Metadata;
}

export const toolDefinitionSchema = z
    .object({
        name: z.string().min(1),
        description: z.string().optional(),
        version: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        handler: z.instanceof(Function),
        config: z
            .object({
                timeout: z.number().positive().optional(),
                requiresAuth: z.boolean().optional(),
                allowParallel: z.boolean().optional(),
                maxConcurrentCalls: z.number().positive().optional(),
            })
            .optional(),
        categories: z.array(z.string()).optional(),
        dependencies: z.array(z.string()).optional(),
    })
    .strict()
    .refine(
        (data) => {
            if (data.config?.requiresAuth) {
                return data.metadata?.auth !== undefined;
            }
            return true;
        },
        {
            message: 'Tools requiring auth must have auth metadata',
            path: ['metadata', 'auth'],
        },
    );

export const toolInputSchema = z
    .object({
        arguments: z.record(z.string(), z.unknown()),
        context: z.record(z.string(), z.unknown()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .transform((data) => {
        return {
            ...data,
            arguments: Object.fromEntries(
                Object.entries(data.arguments).map(([key, value]) => [
                    key.toLowerCase(),
                    value,
                ]),
            ),
        };
    });

export function createToolContext(
    toolName: string,
    callId: string,
    _executionId: string,
    tenantId: string,
    parameters: Record<string, unknown>,
    options: {
        correlationId?: string;
        parentId?: string;
        metadata?: Metadata;
        signal?: AbortSignal;
    } = {},
): ToolContext {
    return {
        tenantId: tenantId || 'default',
        correlationId: options.correlationId || 'default',
        startTime: Date.now(),

        toolName,
        callId,
        parameters,
        signal: options.signal || new AbortController().signal,

        cleanup: async () => {},
    };
}

export function defineTool<TInput = unknown, TOutput = unknown>(config: {
    name: string;
    description: string;
    inputSchema: z.ZodSchema<TInput>;
    execute: ToolHandler<TInput, TOutput>;
    outputSchema?: z.ZodSchema<TOutput>;
    config?: ToolDefinition<TInput, TOutput>['config'];
    categories?: string[];
    dependencies?: string[];
    tags?: string[];
}): ToolDefinition<TInput, TOutput> {
    const jsonSchema = zodToJSONSchema(
        config.inputSchema,
        config.name,
        config.description,
    );

    const outputJsonSchema = config.outputSchema
        ? zodToJSONSchema(config.outputSchema, config.name, config.description)
        : undefined;

    return {
        name: config.name,
        description: config.description,
        execute: config.execute,
        inputSchema: config.inputSchema,
        inputJsonSchema: jsonSchema,
        outputSchema: config.outputSchema,
        outputJsonSchema: outputJsonSchema,
        config: {
            timeout: 60000,
            requiresAuth: false,
            allowParallel: true,
            maxConcurrentCalls: 10,
            source: 'user',
            ...config.config,
        },
        categories: config.categories || [],
        dependencies: config.dependencies || [],
        tags: config.tags || [],
    };
}

export const stepIdSchema = z.string().min(1);

export const stepTypeSchema = z.enum([
    'task',
    'agent',
    'tool',
    'condition',
    'parallel',
    'sequence',
    'wait',
    'human',
    'workflow',
    'custom',
]);
export type StepType = z.infer<typeof stepTypeSchema>;

export interface StepDefinition {
    id?: string;
    name: string;
    description?: string;
    type: StepType;

    config?: Record<string, unknown>;

    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;

    next?: string | string[] | Record<string, string>;
    condition?: (data: Record<string, unknown>) => boolean | Promise<boolean>;

    retry?: {
        maxAttempts: number;
        delayMs: number;
        backoffMultiplier?: number;
        maxDelayMs?: number;
    };

    timeout?: number;

    metadata?: Metadata;
}

export interface WorkflowDefinition extends BaseDefinition {
    steps: Record<string, StepDefinition>;
    entryPoints: string[];

    config?: {
        timeout?: number;
        maxConcurrency?: number;
        enableStateTracking?: boolean;
        enableRetry?: boolean;
    };

    triggers?: Array<{
        type: string;
        config?: Record<string, unknown>;
    }>;

    signals?: Array<{
        name: string;
        description?: string;
        schema?: Record<string, unknown>;
    }>;

    dependencies?: string[];
}

export interface WorkflowContext extends BaseContext {
    workflowName: string;
    executionId: string;

    persistorService?: Persistor;

    stateManager: any; // Legacy ContextStateService replaced by contextNew

    data: Record<string, unknown>;

    currentSteps: string[];
    completedSteps: string[];
    failedSteps: string[];

    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;

    signal: AbortSignal;

    isPaused: boolean;

    stream?: EventStream<TEvent>;
    sendEvent?: (event: TEvent) => Promise<void>;
    emit?: (event: TEvent) => void;

    resourceManager?: {
        addTimer: (timer: NodeJS.Timeout) => void;
        addInterval: (interval: NodeJS.Timeout) => void;
        addCleanupCallback: (callback: () => void | Promise<void>) => void;
        removeTimer: (timer: NodeJS.Timeout) => boolean;
        removeInterval: (interval: NodeJS.Timeout) => boolean;
        removeCleanupCallback: (
            callback: () => void | Promise<void>,
        ) => boolean;
    };

    pause?: (reason?: string) => Promise<string>;
    resume?: (snapshotId?: string) => Promise<void>;

    logger?: {
        debug: (message: string, meta?: Record<string, unknown>) => void;
        info: (message: string, meta?: Record<string, unknown>) => void;
        warn: (message: string, meta?: Record<string, unknown>) => void;
        error: (
            message: string,
            error?: Error,
            meta?: Record<string, unknown>,
        ) => void;
    };

    cleanup(): Promise<void>;
}

export interface StepContext extends BaseContext {
    stepId: string;
    stepName: string;
    stepType: StepType;

    workflowContext: WorkflowContext;

    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;

    attempt: number;
    maxAttempts: number;

    signal: AbortSignal;

    cleanup(): Promise<void>;
}

export interface StepExecution {
    id: string;
    stepId: string;
    executionId: string;
    status: string;

    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    error?: string;

    startTime?: number;
    endTime?: number;
    duration?: number;
    attempt?: number;

    metadata?: Metadata;
}

export function createWorkflowContext(
    workflowName: string,
    executionId: string,
    tenantId: string,
    options: {
        correlationId?: string;
        parentId?: string;
        inputs?: Record<string, unknown>;

        persistorService?: Persistor;
        metadata?: Metadata;
    } = {},
): WorkflowContext {
    return {
        executionId,
        tenantId,
        correlationId: options.correlationId || 'default',
        startTime: Date.now(),

        workflowName,

        persistorService: options.persistorService,
        stateManager: {}, // Legacy ContextStateService replaced by contextNew
        data: {},
        currentSteps: [],
        completedSteps: [],
        failedSteps: [],
        inputs: options.inputs,
        signal: new AbortController().signal,
        isPaused: false,

        cleanup: async () => {},
    };
}

export function defineWorkflow(
    name: string,
    description: string,
    steps: Record<string, StepDefinition>,
    entryPoints: string[],
    options: Partial<
        Omit<
            WorkflowDefinition,
            'name' | 'description' | 'steps' | 'entryPoints'
        >
    > = {},
): WorkflowDefinition {
    return {
        name,
        description,
        steps,
        entryPoints,
        ...options,
    };
}

export function createWorkflow(
    definition: WorkflowDefinition,
    options: {
        tenantId?: string;
        persistorService?: Persistor;
    } = {},
): Workflow {
    const logger = createLogger('workflow');
    return {
        name: definition.name,
        description: definition.description,

        createContext(): WorkflowContext {
            const executionId = IdGenerator.executionId();
            const tenantId = options.tenantId || 'default';

            return createWorkflowContext(
                definition.name,
                executionId,
                tenantId,
                {
                    persistorService: options.persistorService,
                    metadata: definition.metadata,
                },
            );
        },

        on(
            eventType: string,
            _handler: (event: unknown) => void | Promise<void>,
        ): void {
            logger.info('Event handler registered', { eventType });
        },

        emit(eventType: string, data?: unknown): void {
            logger.info('Event emitted', { eventType, data });
        },

        async pause(reason?: string): Promise<string> {
            const snapshotId = `snapshot_${Date.now()}`;
            logger.warn('Workflow paused', { reason, snapshotId });
            return snapshotId;
        },

        async resume(snapshotId?: string): Promise<void> {
            logger.info('Workflow resumed', { snapshotId });
        },

        async cleanup(): Promise<void> {
            logger.info('Workflow cleanup completed');
        },
    };
}

export interface Workflow {
    createContext(): WorkflowContext;

    name?: string;

    description?: string;

    on?(
        eventType: string,
        handler: (event: unknown) => void | Promise<void>,
    ): void;

    emit?(eventType: string, data?: unknown): void;

    pause?(reason?: string): Promise<string>;

    resume?(snapshotId?: string): Promise<void>;

    cleanup?(): Promise<void>;
}

export interface CreateElicitationRequest {
    params: {
        message: string;
        requestedSchema?: unknown;
        timeout?: number;
    };
}

export type TransportType = 'http' | 'sse' | 'websocket' | 'stdio';

export interface CreateElicitationResult {
    action: 'continue' | 'retry' | 'cancel';
    data?: unknown;
    message?: string;
}

export interface CompleteClientCapabilities {
    tools?: {
        listChanged?: boolean;
    };
    resources?: {
        listChanged?: boolean;
        subscribe?: boolean;
    };
    prompts?: {
        listChanged?: boolean;
    };
    roots?: {
        listChanged?: boolean;
    };
    sampling?: Record<string, unknown>;
    elicitation?: Record<string, unknown>;
}

export interface TenantContext {
    tenantId: string;
    userId?: string;
    permissions: string[];
    allowedRoots: string[];
    quotas: {
        maxRequests: number;
        maxTokens: number;
        rateLimit: number;
    };
}

export interface SecurityPolicy {
    allowedUriPatterns: RegExp[];

    blockedUriPatterns: RegExp[];

    maxFileSize: number;

    preventPathTraversal: boolean;

    requireHumanApproval: boolean;
}

export interface MCPMetrics {
    connectionsTotal: number;
    connectionsActive: number;
    connectionErrors: number;

    requestsTotal: number;
    requestsSuccessful: number;
    requestsFailed: number;
    requestDuration: number[];

    toolCalls: number;
    resourceReads: number;
    promptGets: number;
    samplingRequests: number;
    elicitationRequests: number;

    securityViolations: number;
    unauthorizedAccess: number;
    pathTraversalAttempts: number;

    tenantMetrics: Record<
        string,
        {
            requests: number;
            tokensUsed: number;
            errors: number;
        }
    >;
}

export interface AuditEvent {
    timestamp: number;
    tenantId: string;
    userId?: string;
    event: string;
    resource?: string;
    success: boolean;
    error?: string;
    metadata?: Record<string, unknown>;
}

export interface MCPClientConfig {
    clientInfo: {
        name: string;
        version: string;
    };

    transport: {
        type: TransportType;

        command?: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;

        url?: string;
        headers?: Record<string, string>;

        timeout?: number;
        retries?: number;
        keepAlive?: boolean;
    };

    capabilities: CompleteClientCapabilities;

    security?: SecurityPolicy;

    tenant?: TenantContext;

    observability?: {
        enableMetrics: boolean;
        enableTracing: boolean;
        enableAuditLog: boolean;
        metricsInterval: number;
    };

    allowedTools?: string[];
}

export interface HumanApprovalRequest {
    type: 'sampling' | 'elicitation' | 'tool_call' | 'resource_access';
    message: string;
    context: {
        server: string;
        action: string;
        parameters?: Record<string, unknown>;
        security?: {
            riskLevel: 'low' | 'medium' | 'high';
            reason: string;
        };
    };
    timeout?: number;
}

export interface HumanApprovalResponse {
    approved: boolean;
    reason?: string;
    remember?: boolean;
    conditions?: string[];
}

export interface HumanApprovalHandler {
    requestApproval(
        request: HumanApprovalRequest,
    ): Promise<HumanApprovalResponse>;
}

export interface MCPClientEvents {
    connected: [InitializeResult];
    disconnected: [string?];
    error: [Error];

    toolsListChanged: [];
    resourcesListChanged: [];
    promptsListChanged: [];
    rootsListChanged: [];

    progress: [ProgressNotification];
    cancelled: [CancelledNotification];

    securityViolation: [AuditEvent];
    securityApprovalRequired: [HumanApprovalRequest];
    securityApprovalResponse: [HumanApprovalResponse];

    tenantQuotaExceeded: [TenantContext];
    tenantRateLimited: [TenantContext];

    metricsUpdated: [MCPMetrics];
    auditEvent: [AuditEvent];
}

export interface MCPServerConfig {
    name: string;
    type: TransportType;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    timeout?: number;
    retries?: number;
    allowedTools?: string[];
}

export interface MCPAdapterConfig {
    servers: MCPServerConfig[];
    defaultTimeout?: number;
    maxRetries?: number;
    onError?: (error: Error, serverName: string) => void;

    toolSecurity?: {
        requireApproval?: string[];

        timeouts?: Record<string, number>;

        rateLimits?: Record<string, number>;

        permissions?: Record<string, string[]>;
    };

    toolCache?: {
        enabled?: boolean;

        ttls?: Record<string, number>;

        disabled?: string[];
    };
}

export interface MCPToolRaw {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    annotations?: Record<string, unknown>;
}

export interface MCPTool extends MCPToolRaw {
    execute: (args: unknown, ctx: unknown) => Promise<unknown>;
}

export interface MCPToolRawWithServer extends MCPToolRaw {
    serverName?: string;
}

export interface MCPToolWithServer extends MCPTool {
    serverName: string;
}

export interface MCPResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

export interface MCPResourceWithServer extends MCPResource {
    serverName: string;
}

export interface MCPPrompt {
    name: string;
    description?: string;
    arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
    }>;
}

export interface MCPPromptWithServer extends MCPPrompt {
    serverName: string;
}

export interface MCPAdapter {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    ensureConnection(): Promise<void>;
    getTools(): Promise<MCPTool[]>;
    hasTool(name: string): Promise<boolean>;
    listResources(): Promise<MCPResourceWithServer[]>;
    readResource(uri: string, serverName?: string): Promise<unknown>;
    listPrompts(): Promise<MCPPromptWithServer[]>;
    getPrompt(
        name: string,
        args?: Record<string, string>,
        serverName?: string,
    ): Promise<unknown>;
    executeTool(
        name: string,
        args?: Record<string, unknown>,
        serverName?: string,
    ): Promise<unknown>;
    getMetrics(): Record<string, unknown>;
    getRegistry(): unknown;
}

export interface ConversationMessage {
    role: AgentInputEnum;
    content: string;
    timestamp: number;
    metadata?: {
        model?: string;
        agentName?: string;
        responseTimeMs?: number;
        tokensUsed?: number;
        toolsUsed?: string[];
        toolCallsCount?: number;
        source?: string;
        connectionId?: string;
        [key: string]: unknown;
    };
}

export type ConversationHistory = ConversationMessage[];

export type Session = {
    id: string;
    threadId: string;
    tenantId: string;
    createdAt: number;
    lastActivity: number;
    status: 'active' | 'paused' | 'expired' | 'closed';
    metadata: Record<string, unknown>;
    contextData: Record<string, unknown>;
    conversationHistory: ConversationHistory;
    currentExecutionId?: string;
};

export interface SessionConfig {
    maxSessions?: number;
    sessionTimeout?: number;
    maxConversationHistory?: number;
    enableAutoCleanup?: boolean;
    cleanupInterval?: number;
    persistent?: boolean;
    adapterType?: StorageEnum;
    connectionString?: string;
    adapterOptions?: Record<string, unknown>;
}

export interface SessionContext {
    id: SessionId;
    threadId: ThreadId;
    tenantId: TenantId;
    stateManager: any; // Legacy ContextStateService replaced by contextNew
    metadata: Record<string, unknown>;
    conversationHistory: ConversationHistory;
}

export enum StorageEnum {
    INMEMORY = 'memory',
    MONGODB = 'mongodb',
}

// ✅ SIMPLIFIED STORAGE CONFIG - 82% menos código!
export interface StorageConfig {
    adapterType: 'mongodb' | 'memory';
    connectionString?: string; // Só se MongoDB
    databaseName?: string; // Opcional, default: 'kodus-flow'
}

// Constantes internas (não expostas ao usuário)
export const STORAGE_CONSTANTS = {
    DEFAULT_DATABASE: 'kodus-flow',
    DEFAULT_MAX_ITEMS: 1000,
    DEFAULT_CLEANUP_INTERVAL: 300000,
    DEFAULT_TIMEOUT: 5000,
    DEFAULT_RETRIES: 3,
    COLLECTIONS: {
        DEFAULT: 'storage',
        MEMORY: 'memory-storage',
        MONGODB: 'mongodb-storage',
    },
    // Configurações específicas por tipo
    ADAPTER_DEFAULTS: {
        memory: {
            maxItems: 1000,
            enableCompression: true,
            cleanupInterval: 300000,
            timeout: 5000,
        },
        mongodb: {
            maxItems: 10000,
            enableCompression: true,
            cleanupInterval: 300000,
            timeout: 10000,
            connectionOptions: {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
                socketTimeoutMS: 45000,
            },
        },
    },
} as const;

// 🔄 COMPATIBILITY INTERFACES (DEPRECATED - use StorageConfig above)
export interface StorageAdapterConfig {
    type: StorageEnum;
    connectionString?: string;
    options?: Record<string, unknown>;
    // Legacy properties
    maxItems?: number;
    enableCompression?: boolean;
    cleanupInterval?: number;
    timeout?: number;
    retries?: number;
    enableObservability?: boolean;
    enableHealthChecks?: boolean;
    enableMetrics?: boolean;
}

export interface StorageDefaultConfig {
    maxItems: number;
    enableCompression: boolean;
    cleanupInterval: number;
    timeout: number;
    retries: number;
    enableObservability: boolean;
    enableHealthChecks: boolean;
    enableMetrics: boolean;
    options?: Record<string, unknown>;
}

export const STORAGE_DEFAULTS: Record<StorageEnum, StorageDefaultConfig> = {
    memory: {
        maxItems: 1000,
        enableCompression: true,
        cleanupInterval: 300000,
        timeout: 5000,
        retries: 3,
        enableObservability: true,
        enableHealthChecks: true,
        enableMetrics: true,
    },
    mongodb: {
        maxItems: 1000,
        enableCompression: true,
        cleanupInterval: 300000,
        timeout: 10000,
        retries: 3,
        enableObservability: true,
        enableHealthChecks: true,
        enableMetrics: true,
        options: {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            database: 'kodus',
            collection: 'storage',
        },
    },
};

export interface PerformanceInsights {
    slowOperations: Array<{ name: string; duration: number; category: string }>;
    fastOperations: Array<{ name: string; duration: number; category: string }>;
    recommendations: string[];
}

export interface PerformanceMeasurement {
    id: string;
    name: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    category: string;
    correlationId?: string;
}

export interface EventTrace {
    id: string;
    event: TEvent;
    timestamp: number;
    correlationId: string;
    processingDuration?: number;
    result?: TEvent | void;
    error?: Error;
}

export interface StateSnapshot {
    id: string;
    entityName: string;
    entityType: 'agent' | 'workflow' | 'system';
    timestamp: number;
    state: Record<string, unknown>;
    correlationId?: string;
}

export interface EngineTool {
    name: string;
    description: string;
    inputZodSchema: z.ZodSchema;
    inputSchema: unknown;
    outputSchema?: unknown;
    outputZodSchema?: z.ZodSchema;
    annotations?: Record<string, unknown>;
    title?: string;
    execute: (args: unknown, ctx: unknown) => Promise<unknown>;
}

export interface MCPRegistryOptions {
    defaultTimeout?: number;

    maxRetries?: number;
}

export interface MCPRequestMethod {
    request(
        request: { method: string; params?: Record<string, unknown> },
        options?: { signal?: AbortSignal },
    ): Promise<unknown>;
}

export interface LLMMessage {
    role: AgentInputEnum;
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

export interface LLMRequest {
    messages: LLMMessage[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxReasoningTokens?: number;
    stop?: string[];
    tools?: Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    }>;
    // Optional cancellation and timeout controls
    signal?: AbortSignal;
    timeoutMs?: number;
}

export interface LLMResponse {
    content: string;
    toolCalls?: Array<{
        name: string;
        arguments: Record<string, unknown>;
    }>;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        reasoningTokens?: number;
    };
}

export interface LLMDefaults {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxReasoningTokens?: number;
    stop?: string[];
}

export interface LLMConfig {
    provider: string;
    apiKey?: string;
    model?: string;
    baseURL?: string;
    timeout?: number;
    maxRetries?: number;
}

export interface LLMAdapter {
    call(request: LLMRequest): Promise<LLMResponse>;
    analyzeContext(
        pergunta: string,
        availableTools: Array<{ name: string; description?: string }>,
    ): Promise<{
        intent: string;
        urgency: 'low' | 'normal' | 'high';
        complexity: 'simple' | 'medium' | 'complex';
        selectedTool: string;
        confidence: number;
        reasoning: string;
    }>;
    extractParameters(
        pergunta: string,
        toolName: string,
        context: unknown,
    ): Promise<Record<string, unknown>>;
    generateResponse(
        result: unknown,
        originalQuestion: string,
    ): Promise<string>;

    supportsStructuredGeneration?(): boolean;

    createPlan?(
        goal: string,
        strategy: string,
        context: {
            systemPrompt?: string;
            userPrompt?: string;
            tools?: ToolMetadataForLLM[];
            previousPlans?: PlanningResult[];
            constraints?: string[];
            // Optional LLM overrides for planning
            model?: string;
            temperature?: number;
            maxTokens?: number;
            maxReasoningTokens?: number;
            stop?: string[];
            signal?: AbortSignal;
        },
    ): Promise<PlanningResult>;

    getProvider?(): { name: string };
    getAvailableTechniques?(): string[];
}

export interface SimpleExecutionLog {
    executionId: string;
    sessionId: string;
    agentName: string;
    startTime: number;
    endTime: number;
    totalDuration: number;
    toolCallsCount: number;
    complexityScore: number;
    finalStatus: 'success' | 'error' | 'timeout';
}

export interface ExecutionCriteria {
    hasToolCalls: boolean;
    executionTimeMs: number;
    multipleSteps: boolean;
    hasErrors: boolean;
    isDebugMode: boolean;
}

export interface StepResult {
    stepId: string;
    iteration: number;
    thought: AgentThought;
    action: AgentAction;
    status: string;
    result: ActionResult;
    observation: ResultAnalysis;
    duration: number;
    startedAt: number;
    toolCalls: Array<{
        toolName: string;
        input: unknown;
        result: unknown;
        duration: number;
    }>;
}

export const STATE_NAMESPACES = {
    EXECUTION: 'execution',
} as const;

export type StateNamespace =
    (typeof STATE_NAMESPACES)[keyof typeof STATE_NAMESPACES];

export enum PlannerType {
    REACT = 'react',
    REWOO = 'rewoo',
    PLAN_EXECUTE = 'plan-execute',
}

export interface Planner<
    TContext extends PlannerExecutionContext = PlannerExecutionContext,
> {
    think(context: TContext, stepId?: string): Promise<AgentThought>;
    analyzeResult(
        result: ActionResult,
        context: TContext,
    ): Promise<ResultAnalysis>;

    createFinalResponse?(context: TContext): Promise<string>;
    getPlanForContext?(context: TContext): unknown | null;
    resolveArgs?(
        args: Record<string, unknown>,
        steps: unknown[],
        context?: TContext,
    ): Promise<{ args: Record<string, unknown>; missing: string[] }>;
}

export interface ActionResultMetadata {
    executionTime?: number;
    toolName?: string;
    success?: boolean;
    retryCount?: number;
    errorCode?: string;
    [key: string]: unknown;
}

export type ActionResult =
    | ToolResult
    | FinalAnswerResult
    | ErrorResult
    | ToolResultsArray
    | NeedsReplanResult;

export interface ToolResultsArray {
    type: 'tool_results';
    content: Array<{
        toolName: string;
        result?: unknown;
        error?: string;
    }>;
    metadata?: ActionResultMetadata;
}

export interface FinalAnswerResult {
    type: 'final_answer';
    content: string;
    metadata?: ActionResultMetadata;
    planExecutionResult?: PlanExecutionResult;
}

export interface ErrorResult {
    type: 'error';
    error: string;
    metadata?: ActionResultMetadata;
    status?: string;
    replanContext?: PlanExecutionResult['replanContext'];
    feedback?: string;
    planExecutionResult?: PlanExecutionResult;
}

export interface NeedsReplanResult {
    type: 'needs_replan';
    replanContext?: PlanExecutionResult['replanContext'];
    feedback: string;
    metadata?: ActionResultMetadata;
}

export type ResultAnalysis = {
    isComplete: boolean;
    isSuccessful: boolean | null;
    feedback: string;
    shouldContinue: boolean;
    suggestedNextAction?: string;
};

export interface ExecutionContextMetadata {
    agentName?: string;
    correlationId?: string;
    tenantId?: string;
    thread?: Thread;
    startTime?: number;
    plannerType?: PlannerType;
    // Replan cause for observability
    replanCause?:
        | 'fail_window'
        | 'ttl'
        | 'budget'
        | 'tool_missing'
        | 'missing_inputs';
    // 🆕 NEW: Context quality metrics from auto-retrieval
    contextMetrics?: {
        memoryRelevance: number;
        sessionContinuity: number;
        executionHealth: number;
    };
    [key: string]: unknown;
}

export interface PlannerExecutionContext {
    input: string;
    history: StepExecution[];
    isComplete: boolean;

    iterations: number;
    maxIterations: number;
    plannerMetadata: ExecutionContextMetadata;

    agentContext?: AgentContext;

    replanContext?: PlanExecutionResult['replanContext'];

    update(
        thought: AgentThought,
        result: ActionResult,
        observation: ResultAnalysis,
    ): void;
    getCurrentSituation(): string;
    getFinalResult(): AgentExecutionResult;
    getCurrentPlan?(): unknown | null;
}

export function isToolResult(result: ActionResult): result is ToolResult {
    return result.type === 'tool_result';
}

export function isFinalAnswerResult(
    result: ActionResult,
): result is FinalAnswerResult {
    return result.type === 'final_answer';
}

export function isErrorResult(result: ActionResult): result is ErrorResult {
    return result.type === 'error';
}

export function isNeedsReplanResult(
    result: ActionResult,
): result is NeedsReplanResult {
    return result.type === 'needs_replan';
}

export function isToolResultsArray(
    result: ActionResult,
): result is ToolResultsArray {
    return result.type === 'tool_results';
}
export function isSuccessResult(result: ActionResult): boolean {
    return result.type !== 'error';
}

export function getResultError(result: ActionResult): string | undefined {
    if (isErrorResult(result)) {
        return result.error;
    }
    return undefined;
}

export function getResultContent(result: ActionResult): unknown {
    if (
        (isFinalAnswerResult(result) || isErrorResult(result)) &&
        result.planExecutionResult
    ) {
        const { signals, feedback, executedSteps } = result.planExecutionResult;
        return {
            planResult: result.planExecutionResult.type,
            feedback,
            signals,
            executedSteps: executedSteps.map((step) => ({
                stepId: step.stepId,
                success: step.success,
                result: step.result,
                error: step.error,
            })),
        };
    }

    if (isToolResult(result)) {
        return result.content;
    }
    if (isFinalAnswerResult(result)) {
        return result.content;
    }
    if (isToolResultsArray(result)) {
        return result.content;
    }
    return undefined;
}

export interface PlannerPromptConfig {
    additionalPatterns?: string[];
    constraints?: string[];
    features?: {
        enablePromptCaching?: boolean;
    };
    templates?: {
        system?: string;

        user?: string;

        responseFormat?: string;
    };
}

export interface PromptCompositionContext {
    goal: string;

    availableTools: Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
    }>;

    memoryContext?: string;

    planningHistory?: string;

    additionalContext?: Record<string, unknown>;

    replanContext?: ReplanContext;

    iteration?: number;

    maxIterations?: number;
}

export interface ComposedPrompt {
    systemPrompt: string;

    userPrompt: string;

    metadata: {
        estimatedTokens: number;

        includesSmartAnalysis: boolean;

        timestamp: number;

        version: string;
    };
}

export interface ResponseSynthesisContext {
    originalQuery: string;

    plannerType: string;

    executionResults: ActionResult[];

    planSteps?: Array<{
        id: string;
        description: string;
        status:
            | typeof UNIFIED_STATUS.COMPLETED
            | typeof UNIFIED_STATUS.FAILED
            | typeof UNIFIED_STATUS.SKIPPED;
        result?: unknown;
    }>;

    plannerReasoning?: string;

    metadata: {
        totalSteps: number;
        completedSteps: number;
        failedSteps: number;
        executionTime?: number;
        iterationCount?: number;
        [key: string]: unknown;
    };
    // Optional cancellation control for synthesis LLM calls
    signal?: AbortSignal;
}

export interface SynthesizedResponse {
    content: string;
    needsClarification: boolean;
    includesError: boolean;
    metadata: {
        synthesisStrategy: string;
        discoveryCount: number;
        primaryFindings: string[];
        [key: string]: unknown;
    };
}

export type SynthesisStrategy =
    | 'conversational'
    | 'summary'
    | 'problem-solution'
    | 'technical';

export interface ContentBlock {
    type: 'text' | 'image' | 'audio' | 'resource_link' | 'embedded_resource';
    [key: string]: unknown;
}

export interface TextContent extends ContentBlock {
    type: 'text';
    text: string;
}

export interface MCPToolResult {
    content: ContentBlock[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
}

export interface ParsedToolResult {
    text: string;

    data?: Record<string, unknown>;

    isSubstantial: boolean;

    isError: boolean;

    original: unknown;

    metadata: {
        source: 'mcp' | 'nested' | 'simple' | 'json-string' | 'unknown';
        contentType: 'text' | 'json' | 'mixed' | 'empty';
        textLength: number;
        hasStructuredData: boolean;
        parsingSteps: string[];
    };
}

export interface AgentCapability {
    domain: string;
    skills: string[];
    inputTypes: string[];
    outputTypes: string[];
    load: number;
    priority: number;
    availability: boolean;
    performance: {
        averageResponseTime: number;
        successRate: number;
        lastUsed: number;
    };
}

export interface AgentMessage {
    id: string;
    fromAgent: string;
    toAgent: string;
    type: 'request' | 'response' | 'notification' | 'delegation';
    content: unknown;
    timestamp: number;
    correlationId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
}

export type MessageStatus = 'pending' | 'delivered' | 'failed' | 'acknowledged';

export interface TrackedMessage extends AgentMessage {
    status: MessageStatus;
    deliveryAttempts: number;
    maxAttempts: number;
    createdAt: number;
    deliveredAt?: number;
    acknowledgedAt?: number;
    error?: string;
}

export interface DelegationContext {
    fromAgent: string;
    targetAgent: string;
    reason?: string;
    timeout?: number;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    chainLevel: number;
    originalAgent?: string;
    correlationId: string;
    executionId: string;
    startTime: number;
}

export interface MultiKernelHandlerConfig {
    tenantId: string;
    debug?: boolean;
    monitor?: boolean;

    observability?: {
        enabled?: boolean;
        workflow?: Workflow;
        performance?: {
            enableBatching?: boolean;
            enableLazyLoading?: boolean;
        };
    };

    agent?: {
        enabled?: boolean;
        workflow?: Workflow;
        quotas?: {
            maxEvents?: number;
            maxDuration?: number;
            maxMemory?: number;
        };
        runtimeConfig?: {
            queueSize?: number;
            batchSize?: number;
            middleware?: Middleware[];
        };
        performance?: {
            enableBatching?: boolean;
            enableCaching?: boolean;
            autoSnapshot?: {
                enabled?: boolean;
                intervalMs?: number;
                eventInterval?: number;
                useDelta?: boolean;
            };
        };
    };

    global?: {
        persistorType?: PersistorType;
        persistorOptions?: Record<string, unknown>;
        enableCrossKernelLogging?: boolean;
    };

    loopProtection?: {
        enabled?: boolean;
        maxEventCount?: number;
        maxEventRate?: number;
        windowSize?: number;
    };
}

export interface MultiKernelExecutionResult<T = unknown> {
    status: 'completed' | 'failed' | 'paused';
    data?: T;
    error?: {
        message: string;
        details?: unknown;
    };
    metadata: {
        executionId: ExecutionId;
        duration: number;
        kernelsUsed: string[];
        agentEventCount: number;
        observabilityEventCount: number;
        snapshotId?: string;
    };
}

export const persistorTypeSchema = z.enum(['memory', 'mongodb']);

export const basePersistorConfigSchema = z.object({
    type: persistorTypeSchema,
    maxSnapshots: z.number().min(1).max(10000).default(1000),
    enableCompression: z.boolean().default(true),
    enableDeltaCompression: z.boolean().default(true),
    cleanupInterval: z.number().min(1000).max(3600000).default(300000),
});

export const memoryPersistorConfigSchema = basePersistorConfigSchema.extend({
    type: z.literal('memory'),
    maxMemoryUsage: z
        .number()
        .min(1024 * 1024)
        .max(1024 * 1024 * 1024)
        .default(100 * 1024 * 1024),
});

export const mongodbPersistorConfigSchema = basePersistorConfigSchema.extend({
    type: z.literal('mongodb'),
    connectionString: z.string().default('mongodb://localhost:27017/default'),
    database: z.string().default('default'),
    collection: z.string().default('snapshots'),
    maxPoolSize: z.number().min(1).max(100).default(10),
    serverSelectionTimeoutMS: z.number().min(1000).max(30000).default(5000),
    connectTimeoutMS: z.number().min(1000).max(30000).default(10000),
    socketTimeoutMS: z.number().min(1000).max(30000).default(45000),
    enableCompression: z.boolean().default(true),
    ttl: z.number().min(60).max(31536000).default(86400),
});

export const persistorConfigSchema = z.discriminatedUnion('type', [
    memoryPersistorConfigSchema,
    mongodbPersistorConfigSchema,
]);

export type PersistorType = z.infer<typeof persistorTypeSchema>;
export type BasePersistorConfig = z.infer<typeof basePersistorConfigSchema>;
export type MemoryPersistorConfig = z.infer<typeof memoryPersistorConfigSchema>;
export type MongoDBPersistorConfig = z.infer<
    typeof mongodbPersistorConfigSchema
>;

export type PersistorConfig = z.infer<typeof persistorConfigSchema>;

export interface KernelSpec {
    kernelId: string;
    namespace: string;
    workflow: Workflow;
    needsPersistence: boolean;
    needsSnapshots: boolean;
    quotas?: KernelConfig['quotas'];
    performance?: KernelConfig['performance'];
    runtimeConfig?: KernelConfig['runtimeConfig'];
}

export interface CrossKernelBridge {
    fromNamespace: string;
    toNamespace: string;
    eventPattern: string;
    transform?: (event: AnyEvent) => AnyEvent;
    enableLogging?: boolean;
}

export interface MultiKernelConfig {
    tenantId: string;
    kernels: KernelSpec[];
    bridges?: CrossKernelBridge[];
    global?: {
        persistorType?: PersistorType;
        persistorOptions?: Record<string, unknown>;
        enableCrossKernelLogging?: boolean;
        maxConcurrentKernels?: number;
    };
}

export interface ManagedKernel {
    spec: KernelSpec;
    instance: ExecutionKernel | null;
    status: 'initializing' | 'running' | 'paused' | 'failed' | 'stopped';
    startTime: number;
    lastActivity: number;
    eventCount: number;
}

export interface Persistor {
    append(s: Snapshot, options?: SnapshotOptions): Promise<void>;

    load(xcId: string): AsyncIterable<Snapshot>;

    has(hash: string): Promise<boolean>;

    getByHash?(hash: string): Promise<Snapshot | null>;

    listHashes?(xcId: string): Promise<string[]>;

    getStats?(): Promise<PersistorStats>;
}

export interface KernelState {
    id: string;
    tenantId: TenantId;
    correlationId: CorrelationId;
    jobId: string;

    contextData: Record<string, unknown>;
    stateData: Record<string, unknown>;

    status: 'initialized' | 'running' | 'paused' | 'completed' | 'failed';
    startTime: number;
    eventCount: number;

    quotas: {
        maxEvents?: number;
        maxDuration?: number;
        maxMemory?: number;
    };

    operationId?: string;
    lastOperationHash?: string;
    pendingOperations: Set<string>;
}

export interface KernelConfig {
    tenantId: TenantId;
    jobId?: string;

    workflow: Workflow;

    persistor?: Persistor;

    runtimeConfig?: RuntimeConfig;

    quotas?: {
        maxEvents?: number;
        maxDuration?: number;
        maxMemory?: number;
    };

    performance?: {
        enableBatching?: boolean;
        batchSize?: number;
        batchTimeoutMs?: number;
        enableCaching?: boolean;
        cacheSize?: number;
        enableLazyLoading?: boolean;
        contextUpdateDebounceMs?: number;
        autoSnapshot?: {
            enabled?: boolean;
            intervalMs?: number;
            eventInterval?: number;
            useDelta?: boolean;
        };
    };

    isolation?: {
        enableTenantIsolation?: boolean;
        enableEventIsolation?: boolean;
        enableContextIsolation?: boolean;
        maxConcurrentOperations?: number;
    };

    idempotency?: {
        enableOperationIdempotency?: boolean;
        enableEventIdempotency?: boolean;
        operationTimeout?: number;
        maxRetries?: number;
    };

    debug?: boolean;
    monitor?: boolean;
}

export const snapshotSchema = z.object({
    xcId: z.string(),
    ts: z.number(),
    events: z.array(z.unknown()),
    state: z.unknown(),
    hash: z.string(),
});

export const deltaSnapshotSchema = snapshotSchema.extend({
    isDelta: z.literal(true),
    baseHash: z.string(),
    eventsDelta: z.unknown().optional(),
    stateDelta: z.unknown().optional(),
});

export type ExtendedContext = BaseContext & { jobId?: string };

export interface RuntimeConfig {
    queueSize?: number;
    batchSize?: number;
    enableObservability?: boolean;

    maxEventDepth?: number;
    maxEventChainLength?: number;

    cleanupInterval?: number;
    staleThreshold?: number;
    memoryMonitor?: MemoryMonitorConfig;

    middleware?: Middleware[];

    enableAcks?: boolean;
    ackTimeout?: number;

    tenantId?: string;

    persistor?: Persistor;
    executionId?: string;

    queueConfig?: Partial<EventQueueConfig>;

    enableEventStore?: boolean;
    eventStoreConfig?: {
        persistorType?: PersistorType;
        persistorOptions?: Record<string, unknown>;
        replayBatchSize?: number;
        maxStoredEvents?: number;
    };

    batching?: {
        enabled?: boolean;
        defaultBatchSize?: number;
        defaultBatchTimeout?: number;
        maxBatchSize?: number;
        flushOnEventTypes?: string[];
    };
}

export interface EmitOptions {
    deliveryGuarantee?: 'at-most-once' | 'at-least-once' | 'exactly-once';
    priority?: number;
    timeout?: number;
    retryPolicy?: {
        maxRetries: number;
        backoff: 'linear' | 'exponential';
        initialDelay: number;
    };
    correlationId?: string;
    tenantId?: string;

    batch?: boolean;
    batchSize?: number;
    batchTimeout?: number;
    flushBatch?: boolean;
}

export interface EmitResult {
    success: boolean;
    eventId: string;
    queued: boolean;
    error?: Error;
    correlationId?: string;
}

export interface Runtime {
    on(eventType: EventType, handler: EventHandler<AnyEvent>): void;
    emit<T extends EventType>(
        eventType: T,
        data?: EventPayloads[T],
        options?: EmitOptions,
    ): EmitResult;
    emitAsync<T extends EventType>(
        eventType: T,
        data?: EventPayloads[T],
        options?: EmitOptions,
    ): Promise<EmitResult>;
    off(eventType: EventType, handler: EventHandler<AnyEvent>): void;

    process(withStats?: boolean): Promise<void | {
        processed: number;
        acked: number;
        failed: number;
    }>;

    ack(eventId: string): Promise<void>;
    nack(eventId: string, error?: Error): Promise<void>;

    createEvent<T extends EventType>(
        type: T,
        data?: EventPayloads[T],
    ): TEvent<T>;

    createStream<S extends AnyEvent>(
        generator: () => AsyncGenerator<S>,
    ): EventStream<S>;

    forTenant(tenantId: string): Runtime;

    getStats(): Record<string, unknown>;
    getRecentEvents?(limit?: number): Array<{
        eventId: string;
        eventType: string;
        timestamp: number;
        correlationId?: string;
    }>;

    getEnhancedQueue?(): EventQueue | null;
    getQueueSnapshot?(limit?: number): Array<{
        eventId: string;
        eventType: string;
        priority: number;
        retryCount: number;
        timestamp: number;
        correlationId?: string;
        tenantId?: string;
    }>;
    reprocessFromDLQ?(eventId: string): Promise<boolean>;
    reprocessDLQByCriteria?(criteria: {
        maxAge?: number;
        limit?: number;
        eventType?: string;
    }): Promise<{ reprocessedCount: number; events: AnyEvent[] }>;

    getEventStore?(): EventStore | null;
    replayEvents?(
        fromTimestamp: number,
        options?: {
            toTimestamp?: number;
            onlyUnprocessed?: boolean;
            batchSize?: number;
        },
    ): AsyncGenerator<AnyEvent[]>;

    clear(): void;
    cleanup(): Promise<void>;
}

export interface TrackedEventHandler<TEvent extends AnyEvent = AnyEvent>
    extends EventHandler<TEvent> {
    _handlerId?: string;
    _lastUsed?: number;
    _isActive?: boolean;
}

export type MiddlewareKind = 'pipeline' | 'handler';

export type Middleware<TEvent extends AnyEvent = AnyEvent> = ((
    handler: EventHandler<TEvent>,
) => EventHandler<TEvent>) & {
    kind?: MiddlewareKind;
    name?: string;
    displayName?: string;
};

export type MiddlewareFactoryType<
    TConfig,
    TEvent extends AnyEvent = AnyEvent,
> = (config: TConfig) => Middleware<TEvent>;

export function composeMiddleware<TEvent extends AnyEvent = AnyEvent>(
    ...middlewares: Array<Middleware<TEvent>>
): Middleware<TEvent> {
    return (handler: EventHandler<TEvent>) => {
        return middlewares.reduceRight(
            (acc, middleware) => middleware(acc),
            handler,
        );
    };
}

export class MiddlewareError extends Error {
    constructor(
        public readonly middleware: string,
        message: string,
        public readonly context?: Record<string, unknown>,
    ) {
        super(`[${middleware}] ${message}`);
        this.name = 'MiddlewareError';
    }
}

export interface MiddlewareContext {
    readonly startTime: number;
    readonly middlewareChain: string[];
    data: Record<string, unknown>;
    event: AnyEvent;
    observability: ObservabilitySystem;
    metadata?: Record<string, unknown>;
}

export type MiddlewareFunction = (
    context: MiddlewareContext,
    next: () => Promise<void>,
) => Promise<void>;

export type MiddlewareCondition = (
    context: MiddlewareContext,
) => boolean | Promise<boolean>;

export interface ConditionalMiddleware {
    middleware: MiddlewareFunction;
    condition: MiddlewareCondition;
    name?: string;
    priority?: number;
}

// ✅ SIMPLIFIED MIDDLEWARE CONFIG - 86% menos interfaces!
export interface MiddlewareConfig {
    retry?: {
        maxAttempts?: number; // Default: 3
        backoffMs?: number; // Default: 1000
    };
    timeout?: {
        ms?: number; // Default: 30000
    };
    concurrency?: {
        maxConcurrent?: number; // Default: 10
    };
    observability?: {
        level?: 'debug' | 'info' | 'warn' | 'error'; // Default: 'info'
    };
}

// 🔄 COMPATIBILITY INTERFACES (DEPRECATED - use MiddlewareConfig above)
export interface RetryConfig {
    maxAttempts?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
    retryableErrors?: string[];
    nonRetryableErrors?: string[];
    // Legacy properties
    name?: string;
    enabled?: boolean;
    condition?: MiddlewareCondition;
    priority?: number;
    metadata?: Record<string, unknown>;
}

export interface TimeoutConfig {
    timeoutMs?: number;
    errorMessage?: string;
    // Legacy properties
    name?: string;
    enabled?: boolean;
    condition?: MiddlewareCondition;
    priority?: number;
    metadata?: Record<string, unknown>;
}

export interface ConcurrencyConfig {
    maxConcurrent?: number;
    key?: string | ((context: MiddlewareContext) => string);
    queueTimeoutMs?: number;
    dropOnTimeout?: boolean;
    // Legacy properties
    name?: string;
    enabled?: boolean;
    condition?: MiddlewareCondition;
    priority?: number;
    metadata?: Record<string, unknown>;
}

export interface ValidationConfig {
    schema?: unknown;
    validateEvent?: boolean;
    validateContext?: boolean;
    strict?: boolean;
    // Legacy properties
    name?: string;
    enabled?: boolean;
    condition?: MiddlewareCondition;
    priority?: number;
    metadata?: Record<string, unknown>;
}

// ObservabilityConfig já existe mais abaixo no arquivo (linha ~4726)

// CircuitBreakerConfig já existe mais abaixo no arquivo (linha ~4373)

// Constantes internas (não expostas ao usuário)
export const MIDDLEWARE_CONSTANTS = {
    RETRY: {
        DEFAULT_MAX_ATTEMPTS: 3,
        DEFAULT_BACKOFF_MS: 1000,
        DEFAULT_MAX_BACKOFF_MS: 30000,
    },
    TIMEOUT: {
        DEFAULT_MS: 30000,
    },
    CONCURRENCY: {
        DEFAULT_MAX_CONCURRENT: 10,
    },
    OBSERVABILITY: {
        DEFAULT_LEVEL: 'info' as const,
    },
} as const;

export interface MiddlewareFactory {
    // ✅ SIMPLIFIED - Apenas middlewares essenciais
    createRetryMiddleware(
        config?: MiddlewareConfig['retry'],
    ): ConditionalMiddleware;
    createTimeoutMiddleware(
        config?: MiddlewareConfig['timeout'],
    ): ConditionalMiddleware;
    createConcurrencyMiddleware(
        config?: MiddlewareConfig['concurrency'],
    ): ConditionalMiddleware;
    createObservabilityMiddleware(
        config?: MiddlewareConfig['observability'],
    ): ConditionalMiddleware;

    createCustomMiddleware(
        middleware: MiddlewareFunction,
        config?: MiddlewareConfig,
    ): ConditionalMiddleware;
}

export interface ConditionUtils {
    forEventTypes(types: string[]): MiddlewareCondition;

    forPriority(minPriority: number, maxPriority?: number): MiddlewareCondition;

    forEventSize(minSize: number, maxSize?: number): MiddlewareCondition;

    forMetadata(key: string, value: unknown): MiddlewareCondition;

    forContext(
        predicate: (context: MiddlewareContext) => boolean,
    ): MiddlewareCondition;

    forTimeWindow(startHour: number, endHour: number): MiddlewareCondition;

    forOrigin(origins: string[]): MiddlewareCondition;

    forTenant(tenants: string[]): MiddlewareCondition;

    and(...conditions: MiddlewareCondition[]): MiddlewareCondition;

    or(...conditions: MiddlewareCondition[]): MiddlewareCondition;

    not(condition: MiddlewareCondition): MiddlewareCondition;

    withProbability(probability: number): MiddlewareCondition;

    forCriticalEvents(): MiddlewareCondition;

    forDebugEvents(): MiddlewareCondition;

    forProductionEvents(): MiddlewareCondition;
}

export interface MemoryMonitorConfig {
    intervalMs?: number;

    thresholds?: {
        heapUsed?: number;

        rss?: number;

        external?: number;

        heapTotal?: number;
    };

    leakDetection?: {
        enabled?: boolean;

        samples?: number;

        minGrowthMb?: number;

        sampleIntervalMs?: number;
    };

    enabled?: boolean;

    onAlert?: (alert: MemoryAlert) => void;
}

export interface MemoryMetrics {
    timestamp: number;

    heapUsed: number;

    heapTotal: number;

    heapFree: number;

    rss: number;

    external: number;

    arrayBuffers: number;

    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    externalMb: number;

    heapUsagePercent: number;
}

export interface MemoryAlert {
    type: 'THRESHOLD_EXCEEDED' | 'MEMORY_LEAK_DETECTED' | 'HIGH_USAGE';

    severity: 'WARNING' | 'ERROR' | 'CRITICAL';

    message: string;

    metrics: MemoryMetrics;

    threshold?: number;

    growth?: {
        samples: number;
        growthMb: number;
        growthPercent: number;
    };

    timestamp: number;
}

export interface MemoryMonitorStats {
    totalMeasurements: number;

    totalAlerts: number;

    lastMeasurement?: MemoryMetrics;

    peakUsage: {
        heapUsed: number;
        rss: number;
        external: number;
        timestamp: number;
    };

    averageUsage: {
        heapUsed: number;
        rss: number;
        external: number;
    };

    leaksDetected: number;

    isRunning: boolean;

    nextMeasurementIn: number;
}

export interface EventStoreConfig {
    executionId: string;
    enableReplay?: boolean;
    replayBatchSize?: number;
    maxStoredEvents?: number;

    persistor?: Persistor;
    persistorType?: PersistorType;
    persistorOptions?: Record<string, unknown>;

    enableObservability?: boolean;
}

export interface EventMetadata {
    eventId: string;
    eventType: string;
    timestamp: number;
    processed: boolean;
    processingAttempts: number;
    lastProcessedAt?: number;
}

export interface EventQueueConfig {
    maxMemoryUsage?: number;
    maxCpuUsage?: number;
    maxQueueDepth?: number;

    enableObservability?: boolean;
    batchSize?: number;
    chunkSize?: number;
    maxConcurrent?: number;

    largeEventThreshold?: number;
    hugeEventThreshold?: number;
    enableCompression?: boolean;
    maxEventSize?: number;
    dropHugeEvents?: boolean;

    enablePersistence?: boolean;
    persistor?: Persistor;
    executionId?: string;
    persistCriticalEvents?: boolean;
    persistAllEvents?: boolean;
    maxPersistedEvents?: number;
    enableAutoRecovery?: boolean;
    recoveryBatchSize?: number;
    criticalEventTypes?: string[];
    criticalEventPrefixes?: string[];

    enableEventStore?: boolean;

    eventStore?: EventStore;

    enableGlobalConcurrency?: boolean;

    maxProcessedEvents?: number;
}

export interface SystemMetrics {
    timestamp: number;
    memoryUsage: number;
    cpuUsage: number;
    queueDepth: number;
    processingRate: number;
    averageProcessingTime: number;
}

export interface QueueItem {
    event: AnyEvent;
    timestamp: number;
    priority: number;
    retryCount: number;
    size?: number;
    isLarge?: boolean;
    isHuge?: boolean;
    compressed?: boolean;
    originalSize?: number;

    persistent?: boolean;
    persistedAt?: number;

    lastRetryAt?: number;
    nextRetryAt?: number;
    retryDelays?: number[];
    originalError?: string;
}

export interface QueueItemSnapshot {
    eventId: string;
    eventType: string;
    priority: number;
    retryCount: number;
    timestamp: number;
    correlationId?: string;
    tenantId?: string;
}

export interface OptimizedEventProcessorConfig {
    maxEventDepth?: number;
    maxEventChainLength?: number;
    enableObservability?: boolean;
    middleware?: Middleware[];
    batchSize?: number;
    cleanupInterval?: number;
    staleThreshold?: number;
    operationTimeoutMs?: number;
}

export interface TrackedEventHandler extends EventHandler<AnyEvent> {
    _handlerId?: string;
    _lastUsed?: number;
    _isActive?: boolean;
}

export interface OptimizedHandlerMap {
    exact: Map<string, TrackedEventHandler[]>;
    wildcard: TrackedEventHandler[];
    patterns: Map<RegExp, TrackedEventHandler[]>;
    _cleanupTimer?: NodeJS.Timeout;
}

export interface EventProcessingContext {
    depth: number;
    eventChain: EventChainTracker;
    startTime: number;
    correlationId?: string;
}

export interface CircularBuffer<T> {
    items: T[];
    head: number;
    tail: number;
    size: number;
    capacity: number;
}

type WorkflowEventFactory = <P = void, K extends EventType = EventType>(
    name?: K,
) => EventDef<P, K>;

export const workflowEvent: WorkflowEventFactory = <
    P = void,
    K extends EventType = EventType,
>(
    name?: K,
) => {
    const type = name ?? (IdGenerator.callId().slice(5) as K);

    const def: EventDef<P, K> = {
        type: type,
        with(data: P): TEvent<K> {
            return {
                id: IdGenerator.callId(),
                type: type,
                threadId: `workflow-${Date.now()}`,
                data: (data ?? {}) as EventPayloads[K],
                ts: Date.now(),
            };
        },
        include(ev): ev is TEvent<K> {
            return ev.type === type;
        },
    };
    return def;
};

export const isEventTypeGroup = (
    event: AnyEvent,
    types: EventType[],
): boolean => {
    return types.includes(event.type);
};

export const extractEventData = <T extends EventType>(
    event: AnyEvent,
    type: T,
): EventPayloads[T] | undefined => {
    if (event.type === type) {
        return event.data === undefined
            ? ({} as EventPayloads[T])
            : (event.data as EventPayloads[T]);
    }
    return undefined;
};

export enum CircuitState {
    CLOSED = 'CLOSED',
    OPEN = 'OPEN',
    HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
    name: string;

    failureThreshold?: number;

    recoveryTimeout?: number;

    successThreshold?: number;

    operationTimeout?: number;

    enabled?: boolean;

    onStateChange?: (state: CircuitState, previousState: CircuitState) => void;

    onFailure?: (error: Error, context?: unknown) => void;

    onSuccess?: (result: unknown, context?: unknown) => void;
}

export interface CircuitMetrics {
    state: CircuitState;

    totalCalls: number;

    successfulCalls: number;

    failedCalls: number;

    rejectedCalls: number;

    successRate: number;

    failureRate: number;

    lastFailure?: {
        timestamp: number;
        error: string;
    };

    lastSuccess?: {
        timestamp: number;
    };

    timeInCurrentState: number;

    nextAttempt?: number;
}

export interface CircuitResult<T> {
    result?: T;

    error?: Error;

    state: CircuitState;

    executed: boolean;

    rejected: boolean;

    duration: number;
}

export type KernelErrorCode =
    | 'RETRY_EXCEEDED'
    | 'TIMEOUT_EXCEEDED'
    | 'ABORTED'
    | 'VALIDATION_ERROR'
    | 'UNKNOWN'
    | 'INTERNAL_ERROR'
    | 'KERNEL_QUOTA_EXCEEDED'
    | 'KERNEL_CONTEXT_CORRUPTION'
    | 'KERNEL_STATE_SYNC_FAILED'
    | 'KERNEL_INITIALIZATION_FAILED'
    | 'KERNEL_SHUTDOWN_FAILED'
    | 'KERNEL_OPERATION_TIMEOUT';

export type RuntimeErrorCode =
    | 'EVENT_LOOP_DETECTED'
    | 'EVENT_CHAIN_TOO_LONG'
    | 'CIRCULAR_EVENT_DETECTED'
    | 'CONTEXT_NOT_INITIALIZED'
    | 'WORKFLOW_ABORTED'
    | 'BUFFER_OVERFLOW'
    | 'HANDLER_NOT_FOUND'
    | 'STREAM_ERROR'
    | 'RUNTIME_EVENT_PROCESSING_TIMEOUT'
    | 'RUNTIME_MIDDLEWARE_CHAIN_BROKEN'
    | 'RUNTIME_STREAM_BUFFER_FULL'
    | 'RUNTIME_EVENT_QUEUE_FULL'
    | 'RUNTIME_MEMORY_EXCEEDED'
    | 'RUNTIME_PROCESSING_FAILED';

export type EngineErrorCode =
    | 'AGENT_ERROR'
    | 'TOOL_ERROR'
    | 'WORKFLOW_ERROR'
    | 'STEP_FAILED'
    | 'TOOL_NOT_FOUND'
    | 'INVALID_TOOL_INPUT'
    | 'AGENT_TIMEOUT'
    | 'WORKFLOW_CYCLE_DETECTED'
    | 'EXECUTION_TIMEOUT'
    | 'AGENT_LOOP_DETECTED'
    | 'ENGINE_AGENT_INITIALIZATION_FAILED'
    | 'ENGINE_TOOL_EXECUTION_TIMEOUT'
    | 'ENGINE_WORKFLOW_VALIDATION_FAILED'
    | 'ENGINE_PLANNING_FAILED'
    | 'ENGINE_ROUTING_FAILED'
    | 'ENGINE_COORDINATION_FAILED'
    | 'LLM_ERROR';

export type MiddlewareErrorCode =
    | 'CONCURRENCY_DROP'
    | 'CONCURRENCY_TIMEOUT'
    | 'SCHEDULE_ERROR'
    | 'STATE_ERROR'
    | 'MIDDLEWARE_INIT_ERROR'
    | 'MIDDLEWARE_VALIDATION_FAILED'
    | 'MIDDLEWARE_RETRY_EXCEEDED'
    | 'MIDDLEWARE_CIRCUIT_BREAKER_OPEN'
    | 'MIDDLEWARE_TIMEOUT_ERROR'
    | 'MIDDLEWARE_RATE_LIMIT_EXCEEDED';

export type OrchestrationErrorCode =
    | 'ORCHESTRATION_AGENT_NOT_FOUND'
    | 'ORCHESTRATION_TOOL_NOT_FOUND'
    | 'ORCHESTRATION_WORKFLOW_NOT_FOUND'
    | 'ORCHESTRATION_INVALID_CONFIGURATION'
    | 'ORCHESTRATION_TENANT_NOT_FOUND'
    | 'ORCHESTRATION_PERMISSION_DENIED'
    | 'ORCHESTRATION_RESOURCE_LIMIT_EXCEEDED'
    | 'ORCHESTRATION_OPERATION_FAILED';

export type ErrorCode =
    | KernelErrorCode
    | RuntimeErrorCode
    | EngineErrorCode
    | MiddlewareErrorCode
    | OrchestrationErrorCode;

export interface SDKErrorOptions<T extends ErrorCode = ErrorCode> {
    code: T;
    message?: string;
    cause?: Error | unknown;
    context?: Record<string, unknown>;
    recoverable?: boolean;
    retryable?: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
    [key: string]: unknown;
}

export type LogContextProvider = () => LogContext | undefined;

export type LogProcessor = (
    level: LogLevel,
    message: string,
    component: string,
    context?: LogContext,
    error?: Error,
) => void;

export interface Logger {
    debug(message: string, context?: LogContext): void;
    info(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    error(message: string, error?: Error, context?: LogContext): void;
}

export interface TelemetryConfig {
    enabled: boolean;
    serviceName: string;
    serviceVersion?: string;
    environment?: string;

    sampling: {
        rate: number;
        strategy: 'probabilistic';
    };

    globalAttributes?: Record<string, string | number | boolean>;

    features: {
        traceEvents: boolean;
        traceKernel: boolean;
        traceSnapshots: boolean;
        tracePersistence: boolean;
        metricsEnabled: boolean;
    };

    externalTracer?: Tracer;

    privacy?: {
        includeSensitiveData?: boolean;
    };

    spanTimeouts?: {
        enabled?: boolean;
        maxDurationMs?: number;
    };
}

export interface Span {
    setAttribute(key: string, value: string | number | boolean): Span;
    setAttributes(attributes: Record<string, string | number | boolean>): Span;
    setStatus(status: SpanStatus): Span;
    recordException(exception: Error): Span;
    addEvent(name: string, attributes?: Record<string, unknown>): Span;
    end(endTime?: number): void;

    getSpanContext(): SpanContext;
    isRecording(): boolean;
}

export interface SpanStatus {
    code: 'ok' | 'error' | 'timeout';
    message?: string;
}

export interface SpanContext {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    traceFlags: number;
}

export interface Tracer {
    startSpan(name: string, options?: SpanOptions): Span;
    createSpanContext(traceId: string, spanId: string): SpanContext;
}

export interface SpanOptions {
    kind?: SpanKind;
    parent?: SpanContext;
    attributes?: Record<string, string | number | boolean>;
    startTime?: number;
}

export type SpanKind =
    | 'internal'
    | 'server'
    | 'client'
    | 'producer'
    | 'consumer';

export interface Metrics {
    counter(
        name: string,
        value: number,
        attributes?: Record<string, string>,
    ): void;
    histogram(
        name: string,
        value: number,
        attributes?: Record<string, string>,
    ): void;
    gauge(
        name: string,
        value: number,
        attributes?: Record<string, string>,
    ): void;
}

export type MetricValue = number | string | boolean;

export interface KernelMetrics {
    lifecycle: {
        startTime: number;
        status: 'initialized' | 'running' | 'paused' | 'completed' | 'failed';
        eventCount: number;
        pauseCount: number;
        resumeCount: number;
    };
}

export interface RuntimeMetrics {
    eventProcessing: {
        totalEvents: number;
        processedEvents: number;
        failedEvents: number;
        averageProcessingTimeMs: number;
    };

    performance: {
        memoryUsageBytes: number;
        cpuUsagePercent: number;
    };
}

export interface EngineMetrics {
    agentOperations: {
        totalAgents: number;
        activeAgents: number;
        agentExecutions: number;
        agentSuccesses: number;
        agentFailures: number;
        averageAgentExecutionTimeMs: number;
    };

    toolOperations: {
        totalTools: number;
        activeTools: number;
        toolCalls: number;
        toolSuccesses: number;
        toolFailures: number;
        averageToolExecutionTimeMs: number;
    };

    workflowOperations: {
        totalWorkflows: number;
        activeWorkflows: number;
        workflowExecutions: number;
        workflowSuccesses: number;
        workflowFailures: number;
        averageWorkflowExecutionTimeMs: number;
    };
}

export interface SystemMetrics {
    kernel: KernelMetrics;
    runtime: RuntimeMetrics;
    engine: EngineMetrics;

    health: {
        overallHealth: 'healthy' | 'degraded' | 'unhealthy';
        lastHealthCheck: number;
        uptimeMs: number;
        memoryUsageBytes: number;
        cpuUsagePercent: number;
    };
}

export interface MetricsConfig {
    enabled: boolean;
    collectionIntervalMs: number;
    retentionPeriodMs: number;
    enableRealTime: boolean;
    enableHistorical: boolean;
    maxMetricsHistory: number;
    exportFormats: ('json' | 'prometheus' | 'statsd')[];
}

export interface OtelContext {
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    [key: string]: unknown;
}

export interface ObservabilityConfig {
    enabled: boolean;
    environment: 'development' | 'production' | 'test';
    debug: boolean;
    logging?: {
        enabled?: boolean;
        level?: LogLevel;
        outputs?: string[];
        filePath?: string;
    };
    telemetry?: Partial<TelemetryConfig>;
    mongodb?: {
        type: 'mongodb';
        connectionString?: string;
        database?: string;
        collections?: {
            logs?: string;
            telemetry?: string;
            errors?: string;
        };
        batchSize?: number;
        flushIntervalMs?: number;
        ttlDays?: number;
        enableObservability?: boolean;
    };
}

export interface ResourceLeak {
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    timestamp: number;
}

export interface ObservabilityInterface {
    logger: Logger;
    telemetry: TelemetrySystem;
    createContext(correlationId?: string): ObservabilityContext;
    setContext(context: ObservabilityContext): void;
    getContext(): ObservabilityContext | undefined;
    clearContext(): void;

    trace<T>(
        name: string,
        fn: () => T | Promise<T>,
        context?: Partial<ObservabilityContext>,
    ): Promise<T>;

    // ✅ Adicionado: salvar ciclo completo do agente
    saveAgentExecutionCycle(
        agentName: string,
        executionId: string,
        cycle: {
            startTime: number;
            endTime?: number;
            input: any;
            output?: any;
            actions: any[];
            errors?: Error[];
            metadata?: Record<string, any>;
        },
    ): Promise<void>;

    logError(
        error: Error | BaseSDKError,
        message: string,
        context?: Partial<ObservabilityContext>,
    ): void;
    wrapAndLogError(
        error: unknown,
        code: ErrorCode,
        message?: string,
        context?: Partial<ObservabilityContext>,
    ): BaseSDKError;

    flush(): Promise<void>;
    dispose(): Promise<void>;
}

export interface HealthStatus {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    components: {
        logging: { status: 'ok' | 'warning' | 'error'; message?: string };
        telemetry: { status: 'ok' | 'warning' | 'error'; message?: string };
        monitoring: { status: 'ok' | 'warning' | 'error'; message?: string };
        debugging: { status: 'ok' | 'warning' | 'error'; message?: string };
    };
    lastCheck: number;
}

export interface UnifiedReport {
    timestamp: number;
    environment: string;
    health: HealthStatus;

    insights: {
        warnings: string[];
        recommendations: string[];
        criticalIssues: string[];
    };
}

// ⚡ CONFIGURAÇÃO SILENCIOSA PARA DESENVOLVIMENTO
export const SILENT_CONFIG: ObservabilityConfig = {
    enabled: false,
    environment: 'development',
    debug: false,

    logging: {
        enabled: false, // 🔇 NENHUM LOG
        level: 'error',
        outputs: [],
    },

    telemetry: {
        enabled: false,
        serviceName: 'kodus-flow',
        sampling: { rate: 0.0, strategy: 'probabilistic' },
        features: {
            traceEvents: false,
            traceKernel: false,
            traceSnapshots: false,
            tracePersistence: false,
            metricsEnabled: false,
        },
    },
};

// 📊 CONFIGURAÇÃO PADRÃO ORIGINAL (para quando precisar)
export const DEFAULT_CONFIG: ObservabilityConfig = {
    enabled: true,
    environment: 'development',
    debug: false,

    logging: {
        enabled: true,
        level: 'error', // 🔇 SILENCIA LOGS DE DEBUG/INFO/WARN
        outputs: ['console'],
    },

    telemetry: {
        enabled: false, // 🔇 DESABILITA TELEMETRY COMPLETAMENTE
        serviceName: 'kodus-flow',
        sampling: { rate: 0.1, strategy: 'probabilistic' }, // Apenas 10% se habilitar
        features: {
            traceEvents: true,
            traceKernel: true,
            traceSnapshots: false,
            tracePersistence: false,
            metricsEnabled: true,
        },
    },
};

export interface TraceItem {
    name: string;
    context: SpanContext;
    attributes: Record<string, string | number | boolean>;
    startTime: number;
    endTime: number;
}

export type AgentPhase = 'think' | 'act' | 'observe' | 'analyze' | 'synthesize';

export interface AgentSpanAttributes {
    agentName: string;
    tenantId?: string;
    correlationId?: string;
    iteration?: number;
    attributes?: Record<string, string | number | boolean>;
}

export interface LLMSpanAttributes {
    model?: string;
    technique?: string;
    inputTokens?: number;
    outputTokens?: number;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    tenantId?: string;
    correlationId?: string;
    attributes?: Record<string, string | number | boolean>;
}

export interface ToolSpanAttributes {
    toolName: string;
    callId?: string;
    timeoutMs?: number;
    tenantId?: string;
    correlationId?: string;
    attributes?: Record<string, string | number | boolean>;
}

export interface TimeoutOptions {
    timeoutMs?: number;
}

export interface CircuitBreakerMiddlewareConfig extends CircuitBreakerConfig {
    circuitKey?: string;

    keyGenerator?: (event: unknown) => string;

    shouldProtect?: (event: unknown) => boolean;

    onRejected?: (event: unknown, result: CircuitResult<unknown>) => void;
}

export interface SchemaLike {
    parse: (data: unknown) => unknown;
    safeParse: (data: unknown) => { success: boolean; error?: unknown };
}

export interface ValidateOptions {
    throwOnError?: boolean;

    errorCode?: KernelErrorCode;
}

export interface ScheduleOptions {
    intervalMs: number;

    maxTriggers?: number;

    triggerImmediately?: boolean;

    generateData?: (triggerCount: number, originalEvent: TEvent) => unknown;
}

export const DEFAULT_SCHEDULE_OPTIONS: Partial<ScheduleOptions> = {
    triggerImmediately: false,
};

export interface ConcurrencyOptions {
    maxConcurrent: number;
    getKey?: (ev: TEvent) => string;
    queueTimeoutMs?: number;
    emitMetrics?: boolean;
    context?: { cost?: { concurrencyDrops: number } };
}

export const DEFAULT_OPTS: ConcurrencyOptions = {
    maxConcurrent: 5,
    getKey: (ev) => ev.type,
    queueTimeoutMs: 0,
    emitMetrics: true,
};

export interface StandardMiddlewareOptions {
    retry?: Partial<RetryOptions> | boolean;
    timeout?: number;
    concurrency?: number;
    monitoring?: boolean;
}

export interface ObservabilityOptions {
    namePrefix?: string;
    includeSensitiveData?: boolean;

    includeEventTypes?: string[];
    excludeEventTypes?: string[];
}

export const DEFAULT: RetryOptions = {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 5_000,
    maxTotalMs: 60_000,
    backoffFactor: 2,
    jitter: true,
    retryableErrorCodes: ['NETWORK_ERROR', 'TIMEOUT_ERROR', 'TIMEOUT_EXCEEDED'],
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

export interface HasCostCtx {
    ctx?: { cost?: { retries: number } };
}

export const DEFAULT_TIMEOUT_MS = 180000;

export interface StateManager {
    get<T = unknown>(namespace: string, key: string): Promise<T | undefined>;
    set(namespace: string, key: string, value: unknown): Promise<void>;
    delete(namespace: string, key: string): Promise<boolean>;
    clear(namespace?: string): Promise<void>;
    has(namespace: string, key: string): Promise<boolean>;
    keys(namespace: string): Promise<string[]>;
    size(namespace?: string): Promise<number>;
}

export interface StateManagerStats {
    namespaceCount: number;
    totalKeys: number;
    memoryUsage: number;
    namespaces: Record<
        string,
        {
            keyCount: number;
            estimatedSize: number;
        }
    >;
}

export interface Transaction {
    id: string;
    begin(): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    addOperation(op: TransactionOperation): void;
}

export interface TransactionOperation {
    type: 'save' | 'delete' | 'update';
    data: Snapshot | DeltaSnapshot;
    options?: SnapshotOptions;
}

export interface TransactionState {
    id: string;
    operations: TransactionOperation[];
    status: 'pending' | 'committed' | 'rolled_back';
    startTime: number;
    endTime?: number;
}

export interface ObservabilityStorageConfig {
    type: 'mongodb';
    connectionString: string;
    database: string;
    collections?: {
        logs?: string;
        telemetry?: string;
        metrics?: string;
        errors?: string;
    };
    batchSize?: number;
    flushIntervalMs?: number;
    ttlDays?: number;
    enableObservability?: boolean;
}

export interface MongoDBExporterConfig {
    connectionString: string;
    database: string;
    collections: {
        logs: string;
        telemetry: string;
        errors: string;
    };
    batchSize: number;
    flushIntervalMs: number;
    maxRetries: number;
    ttlDays: number;
    enableObservability: boolean;
}

export interface MongoDBLogItem {
    _id?: string;
    timestamp: Date;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    component: string;
    correlationId?: string;
    tenantId?: string;
    executionId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
    createdAt: Date;
}

export interface MongoDBTelemetryItem {
    _id?: string;
    timestamp: Date;
    name: string;
    duration: number;
    correlationId?: string;
    tenantId?: string;
    executionId?: string;
    sessionId?: string;
    agentName?: string;
    toolName?: string;
    phase?: 'think' | 'act' | 'observe';
    attributes: Record<string, string | number | boolean>;
    status: 'ok' | 'error';
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
    createdAt: Date;
}

export interface MongoDBMetricsItem {
    _id?: string;
    timestamp: Date;
    correlationId?: string;
    tenantId?: string;
    executionId?: string;
    metrics: SystemMetrics;
    createdAt: Date;
}

export interface MongoDBErrorItem {
    _id?: string;
    timestamp: Date;
    correlationId?: string;
    tenantId?: string;
    executionId?: string;
    sessionId?: string;
    errorName: string;
    errorMessage: string;
    errorStack?: string;
    context: Record<string, unknown>;
    createdAt: Date;
}

export interface Step<TInput = unknown, TOutput = unknown> {
    readonly name: string;
    readonly handler: (input: TInput, ctx: StepContext) => Promise<TOutput>;
}

export interface ExecutionResult<T = unknown> {
    status: 'completed' | 'failed' | 'paused';
    data?: T;
    error?: {
        message: string;
        details?: unknown;
    };
    metadata: {
        executionId: ExecutionId;
        duration: number;
        eventCount: number;
        snapshotId?: string;
    };
}

export interface KernelHandlerConfig {
    tenantId: string;
    debug?: boolean;
    monitor?: boolean;

    kernelConfig?: Partial<KernelConfig>;

    runtimeConfig?: {
        queueSize?: number;
        batchSize?: number;
        middleware?: Middleware[];
    };

    performance?: {
        enableBatching?: boolean;
        enableCaching?: boolean;
        enableLazyLoading?: boolean;
    };

    loopProtection?: {
        enabled?: boolean;
        maxEventCount?: number;
        maxEventRate?: number;
        windowSize?: number;
        circuitBreakerConfig?: {
            failureThreshold?: number;
            timeout?: number;
            resetTimeout?: number;
        };
    };
}

export interface KernelHandlerInterface {
    initialize(): Promise<void>;
    isInitialized(): boolean;
    cleanup(): Promise<void>;

    getContext<T = unknown>(
        namespace: string,
        key: string,
        threadId?: string,
    ): T | undefined;
    setContext(
        namespace: string,
        key: string,
        value: unknown,
        threadId?: string,
    ): void;
    incrementContext(
        namespace: string,
        key: string,
        delta?: number,
        threadId?: string,
    ): number;

    emit<T extends EventType>(eventType: T, data?: unknown): void;
    on<T extends AnyEvent>(eventType: string, handler: EventHandler<T>): void;
    off(eventType: string, handler: EventHandler<AnyEvent>): void;

    createStream<S extends AnyEvent>(
        generator: () => AsyncGenerator<S>,
    ): unknown;

    registerWorkflow(workflow: Workflow): void;
    getWorkflowContext(): WorkflowContext | null;

    pause(reason?: string): Promise<string>;
    resume(snapshotId: string): Promise<void>;
    getStatus(): Record<string, unknown>;

    getKernel(): ExecutionKernel | null;

    run(startEvent: AnyEvent): Promise<ExecutionResult>;
    getExecutionStatus(): {
        executionId: ExecutionId;
        tenantId: string;
        status: Record<string, unknown>;
        uptime: number;
    };
}

export interface ToolParameters {
    input?: unknown;
    options?: Record<string, unknown>;
    timeout?: number;
    retry?: number;
}

export interface AgentParameters {
    input?: unknown;
    context?: Record<string, unknown>;
    options?: Record<string, unknown>;
    timeout?: number;
}

export interface PlanStepParameters {
    tool?: ToolParameters;
    agent?: AgentParameters;
    custom?: Record<string, unknown>;
}

export interface PlanStep {
    id: string;
    description: string;

    tool?: ToolId;
    agent?: AgentId;
    params?: PlanStepParameters;
    critical?: boolean;
    retry?: number;

    dependencies?: string[];
    estimatedDuration?: number;
    complexity?: 'low' | 'medium' | 'high';
    completed?: boolean;
    result?: unknown;

    canRunInParallel?: boolean;
    toolDependencies?: string[];
    resourceRequirements?: {
        memory?: 'low' | 'medium' | 'high';
        cpu?: 'low' | 'medium' | 'high';
        network?: 'low' | 'medium' | 'high';
    };
}

export enum PlanningStrategy {
    REACT = 'react',
    PLAN_EXECUTE = 'plan-execute',
    REWOO = 'rewoo',
}

export interface Plan {
    id: string;
    goal: string | string[];
    strategy: PlanningStrategy;
    steps: PlanStep[];
    context: Record<string, unknown>;
    createdAt: number;
    agentName: string;
    status: 'created' | 'executing' | 'completed' | 'failed';
    reasoning?: string;
    action?: AgentAction;

    metadata?: Record<string, unknown>;
}

export interface Planner {
    name: string;
    strategy: PlanningStrategy;

    createPlan(
        goal: string | string[],
        context: AgentContext,
        options?: PlannerOptions,
        callbacks?: PlannerCallbacks,
    ): Promise<Plan>;
}

export interface PlannerOptions {
    maxSteps?: number;
    maxDepth?: number;
    beamWidth?: number;
    temperature?: number;
    timeout?: number;
    context?: Record<string, unknown>;
}

export interface PlannerCallbacks {
    onPlanStart?: (
        goal: string | string[],
        context: AgentContext,
        strategy: PlanningStrategy,
    ) => void;
    onPlanStep?: (step: PlanStep, stepIndex: number, plan: Plan) => void;
    onPlanComplete?: (plan: Plan) => void;
    onPlanError?: (error: Error, plan?: Plan) => void;
    onReplan?: (plan: Plan, reason: string) => void;
}

export interface PlanningContext {
    plan(goal: string | string[], options?: PlannerOptions): Promise<Plan>;

    setPlanner(strategy: PlanningStrategy): void;

    getPlanner(): PlanningStrategy;
}

export interface PlanExecutorConfig {
    enableReWOO?: boolean;
    maxRetries?: number;
    maxExecutionRounds?: number;
}

export interface WrappedToolResult {
    result: {
        isError?: boolean;
        content: Array<{
            type: string;
            text: string;
        }>;
    };
}

export interface InnerToolResult {
    successful?: boolean;
    error?: string;
    data?: Record<string, unknown>;
}

export type PlanSignals = {
    failurePatterns?: string[];
    needs?: string[];
    noDiscoveryPath?: string[];
    errors?: string[];
    suggestedNextStep?: string;
};

export interface StepAnalysis {
    success: boolean;
    shouldReplan: boolean;
}

export interface ExecutionSummary {
    successfulSteps: string[];
    failedSteps: string[];
    skippedSteps: string[];
    allStepsProcessed: boolean;
    hasNoMoreExecutableSteps: boolean;
}

export interface AgentRegistryEntry {
    agentName: string;
    tenantId: TenantId;
    status: string;
    executionId?: ExecutionId;
    startedAt?: number;
    pausedAt?: number;
    stoppedAt?: number;
    snapshotId?: string;
    config?: Record<string, unknown>;
    context?: Record<string, unknown>;
    error?: Error;
    scheduleConfig?: AgentScheduleConfig;
    scheduleTimer?: NodeJS.Timeout;
}

export interface LifecycleStats {
    totalAgents: number;
    agentsByStatus: Record<string, number>;
    agentsByTenant: Record<string, number>;
    totalTransitions: number;
    totalErrors: number;
    uptime: number;
}

export interface AgentCoreConfig {
    tenantId: TenantId;
    agentName?: string;
    llmAdapter?: LLMAdapter;
    llmDefaults?: LLMDefaults;
    maxThinkingIterations?: number;
    thinkingTimeout?: number;

    debug?: boolean;
    monitoring?: boolean;
    enableDebugging?: boolean;

    maxConcurrentAgents?: number;
    agentTimeout?: number;

    timeout?: number;
    enableFallback?: boolean;
    concurrency?: number;

    enableMultiAgent?: boolean;
    maxChainDepth?: number;
    enableDelegation?: boolean;

    enableAdvancedCoordination?: boolean;
    enableMessaging?: boolean;
    enableMetrics?: boolean;
    maxHistorySize?: number;
    deliveryRetryInterval?: number;
    defaultMaxAttempts?: number;

    enableTools?: boolean;
    toolTimeout?: number;
    maxToolRetries?: number;

    enableKernelIntegration?: boolean;

    plannerOptions: {
        replanPolicy?: Partial<ReplanPolicyConfig>;
        type: PlannerType;
    };
}

export type SessionForStorage = Omit<Session, 'createdAt' | 'lastActivity'> & {
    createdAt: string;
    lastActivity: string;
    createdAtTimestamp: number;
    lastActivityTimestamp: number;
};

export type SessionFromStorage = Omit<Session, 'createdAt' | 'lastActivity'> & {
    createdAt: string | number;
    lastActivity: string | number;
    createdAtTimestamp?: number;
    lastActivityTimestamp?: number;
};

export interface SessionAdapterConfig {
    adapterType: StorageEnum;
    connectionString?: string;
    options?: Record<string, unknown>;
    timeout?: number;
    retries?: number;
}

export interface SessionStorageItem extends BaseStorageItem {
    sessionData: SessionForStorage;
}

export interface ContextBuilderConfig {
    memory?: {
        adapterType?: StorageEnum;
        adapterConfig?: {
            connectionString?: string;
            options?: Record<string, unknown>;
        };
    };
    session?: SessionConfig;
    snapshot?: {
        adapterType?: StorageEnum;
        adapterConfig?: {
            connectionString?: string;
            options?: Record<string, unknown>;
        };
    };
}

export interface MemoryAdapterConfig {
    adapterType: StorageEnum;
    connectionString?: string;
    options?: Record<string, unknown>;
    timeout?: number;
    retries?: number;
}

export interface MemoryAdapter {
    initialize(): Promise<void>;
    store(item: MemoryItem): Promise<void>;
    retrieve(id: string): Promise<MemoryItem | null>;
    search(query: MemoryQuery): Promise<MemoryItem[]>;
    delete(id: string): Promise<boolean>;
    clear(): Promise<void>;
    getStats(): Promise<{
        itemCount: number;
        totalSize: number;
        adapterType: string;
    }>;
    isHealthy(): Promise<boolean>;
    cleanup(): Promise<void>;
}

export type AdapterType = StorageEnum;

export type DistanceMetric = 'cosine' | 'euclidean' | 'dot';

export const DEFAULT_LLM_SETTINGS = {
    temperature: 0,

    maxTokens: 10000,

    stop: [
        'Observation:',
        '\nObservation',

        'Human:',
        'User:',
        'Assistant:',
        '\nHuman:',
        '\nUser:',

        'System:',
        '\nSystem:',
        '<|endoftext|>',
        '<|im_end|>',
    ],
} as const;

export interface LangChainMessage {
    role: AgentInputEnum;
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: Array<{
        id: string;
        type: string;
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

export interface LangChainOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxReasoningTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stop?: readonly string[] | string[];
    stream?: boolean;
    tools?: unknown[];
    toolChoice?: string;
    signal?: AbortSignal;
}

export interface LangChainResponse {
    content: string;
    toolCalls?: Array<{
        id: string;
        type: string;
        function: {
            name: string;
            arguments: string;
        };
    }>;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    additionalKwargs?: Record<string, unknown>;
}

export interface LangChainLLM {
    call(
        messages: LangChainMessage[],
        options?: LangChainOptions,
    ): Promise<LangChainResponse | string>;
    stream?(
        messages: LangChainMessage[],
        options?: LangChainOptions,
    ): AsyncGenerator<LangChainResponse | string>;
    name?: string;
}

export interface PlanningResult {
    strategy: string;
    goal: string;
    steps: Array<{
        id: string;
        description: string;
        tool?: string;
        arguments?: Record<string, unknown>;
        dependencies?: string[];
        type:
            | 'analysis'
            | 'action'
            | 'decision'
            | 'observation'
            | 'verification';
    }>;
    reasoning: string;
    signals?: {
        needs?: string[];
        noDiscoveryPath?: string[];
        errors?: string[];
        suggestedNextStep?: string;
    };
    audit?: string[];
}

export const planStepSchema = {
    type: 'object',
    properties: {
        id: { type: 'string', pattern: '^[a-z0-9-]+$' },
        description: { type: 'string', minLength: 1 },
        tool: { type: 'string', nullable: true },
        arguments: {
            type: 'object',
            additionalProperties: true,
            nullable: true,
        },
        dependencies: {
            type: 'array',
            items: { type: 'string' },
            nullable: true,
        },
        type: {
            type: 'string',
            enum: [
                'analysis',
                'action',
                'decision',
                'observation',
                'verification',
            ],
        },
        parallel: { type: 'boolean', nullable: true },
        argsTemplate: {
            type: 'object',
            additionalProperties: true,
            nullable: true,
        },
        status: {
            type: 'string',
            enum: ['pending', 'executing', 'completed', 'failed', 'skipped'],
            nullable: true,
        },
    },
    required: ['id', 'description'],
    additionalProperties: true,
};

export const planningResultSchema = {
    type: 'object',
    properties: {
        strategy: { type: 'string', minLength: 1 },
        goal: { type: 'string', minLength: 1 },
        steps: {
            type: 'array',
            items: planStepSchema,
            minItems: 0,
        },
        plan: {
            type: 'array',
            items: planStepSchema,
            minItems: 0,
        },
        signals: {
            type: 'object',
            properties: {
                needs: {
                    type: 'array',
                    items: { type: 'string' },
                    nullable: true,
                },
                noDiscoveryPath: {
                    type: 'array',
                    items: { type: 'string' },
                    nullable: true,
                },
                errors: {
                    type: 'array',
                    items: { type: 'string' },
                    nullable: true,
                },
                suggestedNextStep: { type: 'string', nullable: true },
            },
            additionalProperties: true,
            nullable: true,
        },
        audit: {
            type: 'array',
            items: { type: 'string' },
            nullable: true,
        },
        reasoning: {
            oneOf: [
                { type: 'string' },
                {
                    type: 'array',
                    items: { type: 'string' },
                },
            ],
        },
    },
    oneOf: [
        { required: ['strategy', 'goal', 'steps'] },
        { required: ['strategy', 'goal', 'plan'] },
    ],
    additionalProperties: true,
};

export const llmResponseSchema = {
    type: 'object',
    properties: {
        content: { type: 'string' },
        toolCalls: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    type: { type: 'string' },
                    function: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            arguments: { type: 'string' },
                        },
                        required: ['name', 'arguments'],
                    },
                },
                required: ['id', 'type', 'function'],
            },
            nullable: true,
        },
        usage: {
            type: 'object',
            properties: {
                promptTokens: { type: 'number', nullable: true },
                completionTokens: { type: 'number', nullable: true },
                totalTokens: { type: 'number', nullable: true },
            },
            nullable: true,
        },
        additionalKwargs: {
            type: 'object',
            additionalProperties: true,
            nullable: true,
        },
    },
    required: ['content'],
    additionalProperties: true,
};

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ErrorDomain =
    | 'infrastructure'
    | 'business'
    | 'security'
    | 'performance';
export type UserImpact = 'none' | 'degraded' | 'broken';

export interface EnhancedErrorOptions {
    context?: Record<string, unknown>;
    severity?: ErrorSeverity;
    domain?: ErrorDomain;
    userImpact?: UserImpact;
    userMessage?: string;
    recoveryHints?: string[];
    retryable?: boolean;
    recoverable?: boolean;
    tags?: string[];
}

export interface StructuredErrorResponse {
    error: {
        id: string;
        code: ErrorCode;
        message: string;
        severity: ErrorSeverity;
        domain: ErrorDomain;
        userImpact: UserImpact;
        correlationId: string;
        timestamp: number;
        userMessage?: string;
        retryable: boolean;
        recoverable: boolean;
        recoveryHints: string[];
        tags: string[];
    };
    metadata: {
        component: string;
        tenantId: string;
        version: string;
        requestId?: string;
    };
    context?: Record<string, unknown>;
}

export interface UnifiedEventConfig {
    enableObservability?: boolean;
    enablePersistence?: boolean;
    enableRequestResponse?: boolean;

    maxListeners?: number;
    bufferSize?: number;
    flushInterval?: number;

    eventFilters?: string[];
    componentFilters?: string[];

    enableErrorHandling?: boolean;
    maxRetries?: number;
}

export interface UnifiedEventContext {
    correlationId?: string;
    tenantId?: string;
    timestamp?: number;
    source?: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    retryable?: boolean;
}

export interface EventResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: Error;
    timestamp: number;
    duration: number;
}

export interface OrchestrationConfig {
    llmAdapter: LLMAdapter;
    tenantId?: string;
    mcpAdapter?: MCPAdapter;
    defaultMaxIterations?: number;
    storage?: {
        type?: StorageEnum;
        connectionString?: string;
        database?: string;
    };
    observability?: Partial<ObservabilityConfig>;
}

export interface OrchestrationConfigInternal
    extends Omit<OrchestrationConfig, 'mcpAdapter'> {
    mcpAdapter: MCPAdapter | null;
}

export interface ToolConfig {
    name: string;
    title?: string;
    description: string;
    inputSchema: z.ZodSchema<unknown>;
    outputSchema?: z.ZodSchema<unknown>;
    execute: (input: unknown, context: ToolContext) => Promise<unknown>;
    categories?: string[];
    dependencies?: string[];
    annotations?: Record<string, unknown>;
}

export interface OrchestrationResult<T = unknown> {
    success: boolean;
    result?: T;
    error?: string;
    context: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export interface AgentData {
    instance: AgentEngine | AgentExecutor;
    definition: AgentDefinition;
    config: {
        executionMode: 'simple' | 'workflow';
        simpleConfig?: Record<string, unknown>;
        workflowConfig?: Record<string, unknown>;
        hooks?: {
            onStart?: (
                input: unknown,
                context: Record<string, unknown>,
            ) => Promise<void>;
            onFinish?: (
                result: unknown,
                context: Record<string, unknown>,
            ) => Promise<void>;
            onError?: (
                error: Error,
                context: Record<string, unknown>,
            ) => Promise<void>;
        };
    };
}

export type UnknownRecord = Record<string, unknown>;
export type LooseOtelSpan = {
    setAttribute: (key: string, value: string | number | boolean) => void;
    setStatus: (status: { code: number; message?: string }) => void;
    recordException: (exception: Error) => void;
    addEvent: (name: string, attributes?: UnknownRecord) => void;
    end: (endTime?: number) => void;
    spanContext: () => { traceId: string; spanId: string; traceFlags: number };
    isRecording: () => boolean;
};
export type LooseOtelAPI = {
    trace: {
        getTracer: (name: string) => {
            startSpan: (
                name: string,
                options?: {
                    kind?: number;
                    startTime?: number;
                    attributes?: UnknownRecord;
                },
                context?: unknown,
            ) => LooseOtelSpan;
        };
        setSpan: (context: unknown, span: unknown) => unknown;
    };
    context: {
        active: () => unknown;
    };
};
