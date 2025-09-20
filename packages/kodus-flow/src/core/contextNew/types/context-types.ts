import {
    AgentInputEnum,
    PlannerExecutionContext,
    StorageEnum,
    Thread,
} from '../../types/allTypes.js';

// ===============================================
// 🎯 SESSION CONFIGURATION - SINGLE SOURCE OF TRUTH
// ===============================================

/**
 * 🎯 SIMPLIFIED SESSION CONFIGURATION
 *
 * Apenas o essencial que usuários realmente precisam configurar!
 * 82% menos propriedades - muito mais simples de usar.
 *
 * ANTES: 17 propriedades complexas
 * AGORA: 3 propriedades essenciais
 */
export interface SessionConfig {
    // 🎯 STORAGE - Só o que realmente importa
    adapterType: StorageEnum;
    connectionString?: string; // Só se usar MongoDB

    // ⏰ SESSION TTL - Opcional com default inteligente
    sessionTTL?: number; // Default: 24h (24 * 60 * 60 * 1000)
    maxMessagesInMemory?: number; // Optional window size for messages
    maxMessagesInMemoryByRole?: Partial<
        Record<'user' | 'assistant' | 'tool' | 'system', number>
    >;
}

/**
 * 🎯 DEFAULT SESSION CONFIGURATION
 *
 * Valores padrão para a configuração simplificada
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
    adapterType: StorageEnum.INMEMORY,
    sessionTTL: 24 * 60 * 60 * 1000, // 24h
};

export const SESSION_CONSTANTS = {
    COLLECTIONS: {
        SESSIONS: 'kodus-agent-sessions',
        SNAPSHOTS: 'kodus-execution-snapshots',
        MEMORY: 'kodus-agent-memory',
    } as const,

    PERFORMANCE: {
        CLEANUP_INTERVAL: 300000, // 5min
        MAX_MESSAGES_IN_MEMORY: 50, // Keep last N messages for fast access
    } as const,

    RECOVERY: {
        THRESHOLD: 300000, // 5min
        MAX_ATTEMPTS: 5,
    } as const,

    SNAPSHOT_TTL: 7 * 24 * 60 * 60 * 1000, // 7d

    FEATURES: {
        ENABLE_AUTO_CLEANUP: true,
        ENABLE_COMPRESSION: true,
        ENABLE_METRICS: true,
    } as const,
} as const;

/**
 * 🏭 SESSION CONFIG BUILDER
 *
 * Helper para criar configurações de sessão com defaults
 */
export function createSessionConfig(
    overrides: Partial<SessionConfig> = {},
): SessionConfig {
    return {
        ...DEFAULT_SESSION_CONFIG,
        ...overrides,
    };
}

/**
 * 🎯 SESSION CONFIG PRESETS
 *
 * Configurações pré-definidas para diferentes ambientes
 *
 * @example
 * ```typescript
 * import { SESSION_CONFIG_PRESETS, EnhancedContextBuilder } from '@kodus/flow';
 *
 * // Para produção
 * const builder = EnhancedContextBuilder.getInstance({
 *   ...SESSION_CONFIG_PRESETS.production,
 *   storage: {
 *     ...SESSION_CONFIG_PRESETS.production.storage,
 *     connectionString: process.env.MONGODB_URI,
 *   },
 * });
 *
 * // Para desenvolvimento
 * const devBuilder = EnhancedContextBuilder.getInstance(SESSION_CONFIG_PRESETS.development);
 *
 * // Customizado
 * const customConfig = createSessionConfig({
 *   ttl: { session: 2 * 60 * 60 * 1000 }, // 2h customizado
 *   performance: { maxMessagesInMemory: 30 },
 * });
 * ```
 */
export const SESSION_CONFIG_PRESETS = {
    // 🏭 PRODUÇÃO: MongoDB otimizado
    production: createSessionConfig({
        adapterType: StorageEnum.MONGODB,
        sessionTTL: 48 * 60 * 60 * 1000, // 48h para produção
    }),

    // 🧪 DESENVOLVIMENTO: InMemory rápido
    development: createSessionConfig({
        adapterType: StorageEnum.INMEMORY,
        sessionTTL: 60 * 60 * 1000, // 1h para dev
    }),

    // 🧪 TESTE: Configuração mínima
    test: createSessionConfig({
        adapterType: StorageEnum.INMEMORY,
        sessionTTL: 5 * 60 * 1000, // 5min para testes
    }),
};

// ===============================================
// 🎯 RUNTIME CONTEXT (What agent needs NOW)
// ===============================================

/**
 * Runtime context - lightweight, fast access for agent decisions
 */
export interface AgentRuntimeContext {
    // Identity
    sessionId: string;
    threadId: Thread['id'];
    executionId: string;
    timestamp: string; // ISO string for easy debugging

    // Current state for decisions
    state: {
        phase: 'planning' | 'execution' | 'completed' | 'error';
        lastUserIntent: string; // "create-kody-rule-and-notion", "validate-pr", etc
        pendingActions: string[]; // Actions that need to be completed
        currentStep?: string; // Current step being executed
        // 📊 OPTIMIZATION: Iteration tracking
        currentIteration?: number;
        totalIterations?: number;
    };

    // Essential conversation (last 6 messages max)
    messages: ChatMessage[];
    messagesDigest?: string;

    // Entities for reference resolution (framework agnostic)
    entities: Record<string, EntityRef[] | Record<string, object>>;

    // Current execution state (minimal)
    execution: {
        planId?: string;
        status?: 'in_progress' | 'success' | 'error' | 'partial';
        completedSteps: string[];
        failedSteps: string[];
        skippedSteps?: string[]; // Para compatibilidade com LLM schema
        currentTool?: string;
        lastError?: string;
        replanCount?: number;
        currentStep?: {
            id: string;
            status:
                | 'pending'
                | 'executing'
                | 'completed'
                | 'failed'
                | 'skipped';
            toolCall?: {
                name: string;
                arguments: string; // JSON string
                result?: Record<string, object>;
            };
            error?: string; // Para casos de falha
        };
        // 📊 OPTIMIZATION: Simple counters instead of detailed tracking
        toolCallCount?: number;
        iterationCount?: number;
        lastToolsUsed?: string[]; // 🆕 Track which tools were actually used
        // 📝 Lightweight journal of recent steps (cap 20)
        stepsJournal?: Array<{
            stepId: string;
            type: string;
            toolName?: string;
            status: 'executing' | 'completed' | 'failed' | 'skipped';
            startedAt?: number;
            endedAt?: number;
            durationMs?: number;
            errorSubcode?: string;
        }>;
    };

    // Tools and connections are handled by ToolEngine, not stored in context
}

/**
 * OpenAI-compatible message format
 */
export interface ChatMessage {
    role: AgentInputEnum;
    content: string;
    timestamp: number;

    // For tool calls/responses
    toolCalls?: ToolCall[];
    toolCallId?: string;
    name?: string; // For tool responses

    // Additional metadata
    metadata?: Record<string, unknown>;
}

/**
 * Tool call following OpenAI format
 */
export interface ToolCall {
    id: string;
    name: string;
    arguments: string; // JSON string
}

/**
 * Entity reference for context resolution
 */
export interface EntityRef {
    id: string;
    title?: string;
    type?: string;
    lastUsed?: number;
}

/**
 * Connection status for MCP tools
 */
export interface ConnectionStatus {
    connected: boolean;
    lastUsed?: number;
    error?: string;
}

// ===============================================
// 🎯 LLM PLAN COMPATIBILITY (Direct mapping)
// ===============================================

/**
 * Plan step - compatível 100% com seu planStepSchema
 */
export interface PlanStep {
    id: string;
    description: string;
    status: 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';
    toolCall?: {
        name: string;
        arguments: string; // JSON string
        result?: Record<string, object>;
    };
    error?: string;
    dependencies?: string[];
}

/**
 * Planning result - compatível 100% com seu planningResultSchema
 */
export interface PlanningResult {
    goal: string;
    plan: PlanStep[];
    reasoning?: string;
    confidence?: number;
    estimatedDuration?: number;
}

/**
 * Utility para converter entre formatos
 */
export interface PlanExecutionBridge {
    /**
     * Converte planning result do LLM para runtime context
     */
    applyPlanToContext(
        context: AgentRuntimeContext,
        planResult: PlanningResult,
    ): AgentRuntimeContext;

    /**
     * Extrai execution status para o LLM
     */
    extractExecutionStatus(context: AgentRuntimeContext): {
        completedSteps: PlanStep[];
        failedSteps: PlanStep[];
        currentStep?: PlanStep;
        nextSteps: PlanStep[];
    };
}

// ===============================================
// 🗄️ EXECUTION SNAPSHOT (For persistence & recovery)
// ===============================================

/**
 * Execution snapshot - saved to MongoDB for recovery/audit
 */
export interface ExecutionSnapshot {
    // Identity
    sessionId: string;
    executionId: string;
    timestamp: string;

    // Outcome
    outcome: 'success' | 'error' | 'partial';

    // Plan that was executed
    plan: {
        goal: string;
        steps: string[];
    };

    // Results of each step
    results: Record<string, StepResult>;

    // Error details (if any)
    error?: {
        step: string;
        message: string;
        recoverable: boolean;
        toolCall?: string;
    };

    // Context needed for recovery
    recoveryContext?: {
        entities: Record<string, EntityRef[]>;
        assumptions: string[];
        nextAction: string;
        userIntent: string;
    };
}

/**
 * Result of a single step
 */
export interface StepResult {
    status: 'success' | 'error';
    output?: Record<string, object>;
    error?: string;
    duration?: number;
    toolCall?: {
        tool: string;
        method: string;
        params: Record<string, object>;
        result: Record<string, object>;
    };
}

// ===============================================
// 🌉 CONTEXT BRIDGE (Solves createFinalResponse)
// ===============================================

/**
 * Bridge to build complete context for createFinalResponse
 */
export interface ContextBridgeService {
    /**
     * THE CORE METHOD - Builds complete context for createFinalResponse
     */
    buildFinalResponseContext(
        plannerContext: PlannerExecutionContext,
    ): Promise<FinalResponseContext>;

    /**
     * Gets current runtime context using threadId
     */
    getRuntimeContext(threadId: string): Promise<AgentRuntimeContext>;

    /**
     * Updates runtime context with new information
     */
    updateRuntimeContext(
        threadId: string,
        updates: Partial<AgentRuntimeContext>,
    ): Promise<void>;
}

/**
 * Complete context for createFinalResponse (solves the original problem!)
 */
export interface FinalResponseContext {
    // Current runtime context
    runtime: AgentRuntimeContext;

    executionSummary: {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        successRate: number; // 0-100
        replanCount: number;
    };

    // Recovery information (if session was recovered)
    recovery?: {
        wasRecovered: boolean;
        gapDuration: number; // milliseconds
        recoveredFrom: string; // checkpoint, snapshot, etc
        confidence: number; // 0-1 how confident we are in the recovery
    };

    // Inferences made during recovery
    inferences?: Record<string, string>; // "esse card" -> "PROJ-123"
}

// ===============================================
// 🔧 SESSION MANAGEMENT
// ===============================================

/**
 * Session management service interface
 */
export interface SessionManager {
    /**
     * Get or create session using threadId
     */
    getOrCreateSession(
        threadId: string,
        userId: string,
        tenantId?: string,
    ): Promise<AgentRuntimeContext>;

    /**
     * Update conversation with new message
     */
    addMessage(threadId: string, message: ChatMessage): Promise<void>;

    /**
     * Add discovered entities to context
     */
    addEntities(
        threadId: string,
        entities: Partial<AgentRuntimeContext['entities']>,
    ): Promise<void>;

    /**
     * Update execution state
     */
    updateExecution(
        threadId: string,
        execution: Partial<AgentRuntimeContext['execution']>,
    ): Promise<void>;

    /**
     * Save execution snapshot (for recovery)
     */
    saveSnapshot(threadId: string, snapshot: ExecutionSnapshot): Promise<void>;

    /**
     * Recover session from snapshots (handles gaps)
     */
    recoverSession(threadId: string): Promise<{
        context: AgentRuntimeContext;
        wasRecovered: boolean;
        gapDuration: number;
        inferences: Record<string, string>;
    }>;
}

// ===============================================
// 🎛️ UTILITY TYPES
// ===============================================

/**
 * Context update operations
 */
export type ContextUpdate = {
    type: 'message' | 'entity' | 'execution' | 'state';
    data: any;
    timestamp: number;
};

/**
 * Entity resolution for references like "esse card"
 */
export interface EntityResolver {
    resolveReference(
        reference: string,
        context: AgentRuntimeContext,
    ): string | null;
    inferEntitiesFromMessage(
        message: string,
    ): Partial<AgentRuntimeContext['entities']>;
}

/**
 * Intent inference from user messages
 */
export interface IntentInference {
    inferIntent(message: string, context?: AgentRuntimeContext): string;
    getIntentConfidence(intent: string, message: string): number;
}

/**
 * Session recovery strategies
 */
export type RecoveryStrategy =
    | 'memory-based'
    | 'snapshot-based'
    | 'entity-inference'
    | 'conversation-analysis';

/**
 * Context health check
 */
export interface ContextHealth {
    healthy: boolean;
    issues: string[];
    warnings: string[];
    recommendations: string[];
}

// ===============================================
// 🏷️ TYPE GUARDS & VALIDATORS
// ===============================================

export function isValidRuntimeContext(obj: any): obj is AgentRuntimeContext {
    return (
        obj &&
        typeof obj.sessionId === 'string' &&
        typeof obj.executionId === 'string' &&
        obj.state &&
        Array.isArray(obj.messages) &&
        obj.execution
    );
}

export function isValidChatMessage(obj: any): obj is ChatMessage {
    return (
        obj &&
        [
            AgentInputEnum.USER,
            AgentInputEnum.ASSISTANT,
            AgentInputEnum.SYSTEM,
            AgentInputEnum.TOOL,
        ].includes(obj.role) &&
        typeof obj.content === 'string' &&
        typeof obj.timestamp === 'number'
    );
}

export function isRecoveryNeeded(
    lastActivity: number,
    threshold: number = 300000,
): boolean {
    return Date.now() - lastActivity > threshold; // 5 minutes default
}
