import {
    AgentRuntimeContext,
    SessionManager,
    ChatMessage,
    ExecutionSnapshot,
    EntityRef,
    isValidRuntimeContext,
    isValidChatMessage,
    isRecoveryNeeded,
    SessionConfig,
    SESSION_CONSTANTS,
    DEFAULT_SESSION_CONFIG,
} from '../types/context-types.js';

import { StorageEnum, Thread } from '../../types/allTypes.js';

import { createLogger } from '../../../observability/logger.js';
import {
    StorageContextSessionAdapter,
    StorageSnapshotAdapter,
} from './storage-context-adapter.js';
import { IdGenerator } from '../../../utils/id-generator.js';

const logger = createLogger('enhanced-session-service');

export class EnhancedSessionService implements SessionManager {
    private sessionsAdapter: StorageContextSessionAdapter;
    private snapshotsAdapter: StorageSnapshotAdapter;
    private isInitialized = false;
    private sessionCreationLocks = new Map<
        string,
        Promise<AgentRuntimeContext>
    >();

    private readonly config: SessionConfig;

    constructor(
        connectionString?: string,
        options?: {
            adapterType?: StorageEnum;
            dbName?: string;
            database?: string; // Novo: suporte a database customizado
            sessionsCollection?: string; // Ignorado
            snapshotsCollection?: string; // Ignorado
            sessionTTL?: number; // Default 24h
            snapshotTTL?: number; // Ignorado
            maxMessagesInMemory?: number;
            maxMessagesInMemoryByRole?: Partial<
                Record<'user' | 'assistant' | 'tool' | 'system', number>
            >;
        },
    ) {
        this.config = {
            adapterType: connectionString
                ? StorageEnum.MONGODB
                : StorageEnum.INMEMORY,
            connectionString,
            sessionTTL:
                options?.sessionTTL || DEFAULT_SESSION_CONFIG.sessionTTL,
            maxMessagesInMemory: options?.maxMessagesInMemory,
            maxMessagesInMemoryByRole: options?.maxMessagesInMemoryByRole,
        };

        // Use database customizado se fornecido, senão use default
        const databaseName = options?.database || options?.dbName;

        this.sessionsAdapter = new StorageContextSessionAdapter({
            adapterType: this.config.adapterType,
            connectionString: this.config.connectionString,
            options: {
                database: databaseName,
                collection: SESSION_CONSTANTS.COLLECTIONS.SESSIONS,
                sessionTTL: this.config.sessionTTL as number | undefined,
                maxMessagesInMemory: this.config.maxMessagesInMemory,
            },
        });

        this.snapshotsAdapter = new StorageSnapshotAdapter({
            adapterType: this.config.adapterType,
            connectionString: this.config.connectionString,
            options: {
                database: databaseName,
                collection: SESSION_CONSTANTS.COLLECTIONS.SNAPSHOTS,
            },
        });

        logger.info('Enhanced Session Service configured', {
            adapterType: this.config.adapterType,
            database: databaseName,
            sessionTTL: this.config.sessionTTL,
        });
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        await this.sessionsAdapter.initialize();
        await this.snapshotsAdapter.initialize();

        this.isInitialized = true;
        logger.info('Enhanced Session Service initialized');
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    // ===== SESSION MANAGEMENT =====

    async getOrCreateSession(
        threadId: Thread['id'],
        tenantId: string,
    ): Promise<AgentRuntimeContext> {
        await this.ensureInitialized();

        const existingLock = this.sessionCreationLocks.get(threadId);
        if (existingLock) {
            logger.info(
                `Waiting for existing session creation for thread: ${threadId}`,
            );
            return existingLock;
        }

        // Create a promise for this session creation
        const sessionPromise = this.doGetOrCreateSession(threadId, tenantId);
        this.sessionCreationLocks.set(threadId, sessionPromise);

        try {
            const result = await sessionPromise;
            return result;
        } finally {
            // Clean up the lock
            this.sessionCreationLocks.delete(threadId);
        }
    }

    private async doGetOrCreateSession(
        threadId: Thread['id'],
        tenantId: string,
    ): Promise<AgentRuntimeContext> {
        const existingSession =
            await this.sessionsAdapter.retrieveContextSessionByThreadId(
                threadId,
            );

        if (existingSession) {
            const sessionAge = Date.now() - existingSession.lastActivityAt;
            const ttl = this.config.sessionTTL!;

            if (sessionAge > ttl) {
                logger.info(
                    `Deleting expired session ${existingSession.sessionId} (age: ${Math.round(sessionAge / 1000 / 60)}min)`,
                );
                await this.sessionsAdapter.deleteContextSession(
                    existingSession.sessionId,
                );
            } else {
                await this.sessionsAdapter.storeContextSession(
                    existingSession.sessionId, // Use sessionId as primary key
                    existingSession.threadId, // Keep threadId for queries
                    existingSession.tenantId,
                    existingSession.status,
                    existingSession.runtime,
                    existingSession.createdAt,
                    Date.now(), // Update last activity
                );

                logger.info(
                    `Recovered session ${existingSession.sessionId} for thread: ${threadId}`,
                );
                return existingSession.runtime;
            }
        }

        const sessionId = IdGenerator.sessionId();

        const newRuntime: AgentRuntimeContext = {
            sessionId,
            threadId,
            executionId: IdGenerator.executionId(),
            timestamp: new Date().toISOString(),

            state: {
                phase: 'planning',
                lastUserIntent: 'conversation',
                pendingActions: [],
                // 📊 OPTIMIZATION: Track iteration count
                currentIteration: 0,
                totalIterations: 0,
            },

            messages: [],
            entities: {},

            execution: {
                completedSteps: [],
                failedSteps: [],
                skippedSteps: [],
                replanCount: 0,
                // 📊 OPTIMIZATION: Simple counters instead of detailed tracking
                toolCallCount: 0,
                iterationCount: 0,
            },

            // ✅ RUNTIME ONLY: These will be rebuilt from ToolEngine when needed
            // Don't persist empty arrays/objects to keep session data clean
        };

        const now = Date.now();
        await this.sessionsAdapter.storeContextSession(
            sessionId, // Use sessionId as unique document ID
            threadId, // Keep threadId for queries
            tenantId,
            'active',
            newRuntime,
            now, // createdAt
            now, // lastActivityAt
        );

        logger.info(
            `🆕 Created session ${sessionId} for thread ${threadId} (tenant: ${tenantId})`,
        );
        return newRuntime;
    }

    async addMessage(threadId: string, message: ChatMessage): Promise<void> {
        await this.ensureInitialized();

        // 🔍 DEBUG: Log detalhado no enhanced-session-service
        logger.info('🔍 ENHANCED SESSION - addMessage called', {
            threadId,
            role: message.role,
            contentLength: message.content?.length || 0,
            timestamp: message.timestamp,
            hasMetadata: !!message.metadata,
        });

        if (!isValidChatMessage(message)) {
            logger.error('❌ Invalid chat message format', undefined, {
                message,
            });
            throw new Error('Invalid chat message format');
        }

        const session =
            await this.sessionsAdapter.retrieveContextSessionByThreadId(
                threadId,
            );
        if (!session) {
            logger.error(`❌ Session for thread ${threadId} not found`);
            throw new Error(`Session for thread ${threadId} not found`);
        }

        logger.info('🔍 ENHANCED SESSION - Session found, adding message', {
            threadId,
            sessionId: session.sessionId,
            currentMessagesCount: session.runtime.messages.length,
            newMessageRole: message.role,
        });

        let messages = [...session.runtime.messages, message];

        // Windowing: cap messages in memory and keep a digest of older ones
        const MAX =
            this.config.maxMessagesInMemory ||
            SESSION_CONSTANTS.PERFORMANCE.MAX_MESSAGES_IN_MEMORY;
        const caps = this.config.maxMessagesInMemoryByRole;
        let messagesDigest = session.runtime.messagesDigest || '';
        const digestLine = (m: ChatMessage) =>
            `[${m.role}] ${m.content?.substring(0, 60) || ''}$${
                m.content && m.content.length > 60 ? '…' : ''
            }`;
        // 1) Apply per-role caps if provided
        if (caps && Object.keys(caps).length > 0) {
            const roles: Array<'user' | 'assistant' | 'tool' | 'system'> = [
                'user',
                'assistant',
                'tool',
                'system',
            ];
            for (const role of roles) {
                const cap = caps[role];
                if (!cap || cap <= 0) continue;
                const count = messages.filter(
                    (m) => m.role === (role as any),
                ).length;
                if (count > cap) {
                    let toRemove = count - cap;
                    const keep: ChatMessage[] = [];
                    for (const m of messages) {
                        if (toRemove > 0 && m.role === (role as any)) {
                            messagesDigest = messagesDigest
                                ? `${messagesDigest} | ${digestLine(m)}`
                                : digestLine(m);
                            toRemove--;
                            continue;
                        }
                        keep.push(m);
                    }
                    messages = keep;
                }
            }
        }
        // 2) Apply global cap
        if (messages.length > MAX) {
            const excess = messages.length - MAX;
            const removed = messages.slice(0, excess);
            const digestPart = removed.map(digestLine).join(' | ');
            messagesDigest = messagesDigest
                ? `${messagesDigest} | ${digestPart}`
                : digestPart;
            messages = messages.slice(excess);
        }

        // Update runtime with new message
        const updatedRuntime: AgentRuntimeContext = {
            ...session.runtime,
            messages,
            ...(messagesDigest ? { messagesDigest } : {}),
            timestamp: new Date().toISOString(),
        };

        if (message.role === 'user') {
            updatedRuntime.state.lastUserIntent = this.inferIntent(
                message.content,
            );
        }

        // Store updated session
        logger.info('🔍 ENHANCED SESSION - Storing session to MongoDB', {
            threadId,
            sessionId: session.sessionId,
            messagesCount: updatedRuntime.messages.length,
            messageRoles: updatedRuntime.messages.map((m) => m.role),
            newMessageRole: message.role,
        });

        await this.sessionsAdapter.storeContextSession(
            session.sessionId, // Use sessionId as primary key
            session.threadId, // Keep threadId
            session.tenantId,
            session.status,
            updatedRuntime,
            session.createdAt,
            Date.now(),
            { expectedVersion: (session as any).version },
        );

        logger.info(
            `✅ ENHANCED SESSION - Successfully added ${message.role} message to thread ${threadId}`,
            {
                finalMessagesCount: updatedRuntime.messages.length,
                finalRoles: updatedRuntime.messages.map((m) => m.role),
            },
        );
    }

    async updateMessage(
        threadId: string,
        messageId: string,
        updates: {
            content?: string;
            metadata?: Record<string, unknown>;
        },
    ): Promise<void> {
        await this.ensureInitialized();

        logger.info('🔄 ENHANCED SESSION - updateMessage called', {
            threadId,
            messageId,
            hasContent: !!updates.content,
            hasMetadata: !!updates.metadata,
        });

        const session =
            await this.sessionsAdapter.retrieveContextSessionByThreadId(
                threadId,
            );
        if (!session) {
            logger.error(`❌ Session for thread ${threadId} not found`);
            throw new Error(`Session for thread ${threadId} not found`);
        }

        // Find and update the message by messageId
        const messages = [...session.runtime.messages];
        const messageIndex = messages.findIndex(
            (m) => m.metadata?.messageId === messageId,
        );

        if (messageIndex === -1) {
            logger.error(
                `❌ Message ${messageId} not found in thread ${threadId}`,
            );
            throw new Error(`Message ${messageId} not found`);
        }

        // Update the message
        const existingMessage = messages[messageIndex];
        if (!existingMessage) {
            logger.error(
                `❌ Message at index ${messageIndex} is undefined for thread ${threadId}`,
            );
            throw new Error(`Message at index ${messageIndex} is undefined`);
        }

        const updatedMessage: ChatMessage = {
            ...existingMessage,
            content: updates.content ?? existingMessage.content,
            role: existingMessage.role, // Ensure role is preserved
            metadata: {
                ...existingMessage.metadata,
                ...updates.metadata,
                messageId, // Preserve messageId
                lastUpdated: Date.now(),
            },
        };

        messages[messageIndex] = updatedMessage;

        logger.info('🔄 ENHANCED SESSION - Message updated in array', {
            threadId,
            messageId,
            messageIndex,
            newContentLength: updatedMessage.content.length,
        });

        // Update runtime with modified messages
        const updatedRuntime: AgentRuntimeContext = {
            ...session.runtime,
            messages,
            timestamp: new Date().toISOString(),
        };

        // Store updated session
        await this.sessionsAdapter.storeContextSession(
            session.sessionId,
            session.threadId,
            session.tenantId,
            session.status,
            updatedRuntime,
            session.createdAt,
            Date.now(),
        );

        logger.info(
            `✅ ENHANCED SESSION - Successfully updated message ${messageId} in thread ${threadId}`,
            {
                finalContentLength: updatedMessage.content.length,
                messageIndex,
            },
        );
    }

    async addEntities(
        threadId: string,
        entities: Partial<AgentRuntimeContext['entities']>,
    ): Promise<void> {
        await this.ensureInitialized();

        const session =
            await this.sessionsAdapter.retrieveContextSessionByThreadId(
                threadId,
            );
        if (!session) {
            throw new Error(`Session for thread ${threadId} not found`);
        }

        // Smart entity updates with deduplication
        const updatedEntities = { ...session.runtime.entities };

        // Update runtime with new entities
        const updatedRuntime: AgentRuntimeContext = {
            ...session.runtime,
            entities: updatedEntities,
            timestamp: new Date().toISOString(),
        };

        // Store updated session
        await this.sessionsAdapter.storeContextSession(
            session.sessionId, // Use sessionId as primary key
            session.threadId, // Keep threadId
            session.tenantId,
            session.status,
            updatedRuntime,
            session.createdAt,
            Date.now(),
        );

        logger.debug(
            `🏷️ Updated entities for thread ${threadId}: ${Object.keys(entities).join(', ')}`,
        );
    }

    async updateExecution(
        threadId: string,
        execution: Partial<AgentRuntimeContext['execution']> & {
            phase?: AgentRuntimeContext['state']['phase'];
            correlationId?: string;
            stepsJournalAppend?: {
                stepId: string;
                type: string;
                toolName?: string;
                status: 'executing' | 'completed' | 'failed' | 'skipped';
                startedAt?: number;
                endedAt?: number;
                durationMs?: number;
                errorSubcode?: string;
            };
        },
    ): Promise<void> {
        await this.ensureInitialized();

        const session =
            await this.sessionsAdapter.retrieveContextSessionByThreadId(
                threadId,
            );
        if (!session) {
            throw new Error(`Session for thread ${threadId} not found`);
        }

        // 📊 OPTIMIZATION: Auto-increment counters
        const currentExecution = session.runtime.execution || {};
        const updatedExecution: AgentRuntimeContext['execution'] = {
            ...currentExecution,
            ...execution,
        };

        // Append stepsJournal entry (cap 20)
        if (execution.stepsJournalAppend) {
            const journal = currentExecution.stepsJournal || [];
            const next = [...journal, execution.stepsJournalAppend];
            const capped = next.slice(Math.max(0, next.length - 20));
            (updatedExecution as any).stepsJournal = capped;
        }

        // Merge completedSteps without duplicados
        if (execution.completedSteps && execution.completedSteps.length > 0) {
            const existing = new Set(currentExecution.completedSteps || []);
            for (const s of execution.completedSteps) existing.add(s);
            updatedExecution.completedSteps = Array.from(existing);
        }

        // Auto-increment tool call counter if currentTool changed
        if (
            execution.currentTool &&
            execution.currentTool !== currentExecution.currentTool
        ) {
            updatedExecution.toolCallCount =
                (currentExecution.toolCallCount || 0) + 1;

            // 🆕 Track which tools were actually used
            if (execution.currentTool !== 'tool_executing') {
                const lastTools = currentExecution.lastToolsUsed || [];
                if (!lastTools.includes(execution.currentTool)) {
                    updatedExecution.lastToolsUsed = [
                        ...lastTools,
                        execution.currentTool,
                    ];
                } else {
                    updatedExecution.lastToolsUsed = lastTools;
                }
            }
        }

        // Update execution state
        const updatedRuntime: AgentRuntimeContext = {
            ...session.runtime,
            execution: updatedExecution,
            timestamp: new Date().toISOString(),
        };

        // Phase update (coerência com finalização)
        if (execution.phase) {
            updatedRuntime.state = {
                ...updatedRuntime.state,
                phase: execution.phase,
            } as any;
        }

        // Store updated session
        // Correlation history (cap 20)
        let extras:
            | { lastCorrelationId?: string; correlationIdHistory?: string[] }
            | undefined = undefined;
        if (execution.correlationId) {
            // Read last stored history from session (optional)
            const historyPrev: string[] | undefined = (session as any)
                .correlationIdHistory;
            const set = new Set<string>(historyPrev || []);
            set.add(execution.correlationId);
            const newHistory = Array.from(set).slice(-20);
            extras = {
                lastCorrelationId: execution.correlationId,
                correlationIdHistory: newHistory,
            };
        }

        await this.sessionsAdapter.storeContextSession(
            session.sessionId, // Use sessionId as primary key
            session.threadId, // Keep threadId
            session.tenantId,
            session.status,
            updatedRuntime,
            session.createdAt,
            Date.now(),
            extras,
        );

        // 🆕 Log tools being tracked
        if (
            updatedExecution.lastToolsUsed &&
            updatedExecution.lastToolsUsed.length > 0
        ) {
            logger.info('🔧 Tools tracked in session', {
                threadId,
                toolsUsed: updatedExecution.lastToolsUsed,
                toolCallCount: updatedExecution.toolCallCount,
            });
        }

        logger.debug(
            `⚙️ Updated execution for thread ${threadId}: ${Object.keys(execution).join(', ')}`,
        );
    }

    async saveSnapshot(
        threadId: string,
        snapshot: ExecutionSnapshot,
    ): Promise<void> {
        await this.ensureInitialized();

        // 📊 OPTIMIZATION: Create minimal snapshot for storage
        const optimizedSnapshot = this.createOptimizedSnapshot(
            threadId,
            snapshot,
        );

        await this.snapshotsAdapter.storeExecutionSnapshot(
            optimizedSnapshot,
            Math.ceil(SESSION_CONSTANTS.SNAPSHOT_TTL / (24 * 60 * 60 * 1000)), // Convert to days
        );

        logger.debug(
            `📸 Saved optimized execution snapshot: ${snapshot.executionId}`,
            {
                originalSize: JSON.stringify(snapshot).length,
                optimizedSize: JSON.stringify(optimizedSnapshot).length,
            },
        );
    }

    /**
     * 🎯 OPTIMIZATION: Create minimal snapshot for storage
     */
    private createOptimizedSnapshot(
        _threadId: string,
        snapshot: ExecutionSnapshot,
    ): ExecutionSnapshot {
        // Extract only essential data for recovery
        return {
            sessionId: snapshot.sessionId,
            executionId: snapshot.executionId,
            timestamp: snapshot.timestamp,
            outcome: snapshot.outcome,

            // Minimal plan info
            plan: {
                goal: snapshot.plan.goal,
                steps: snapshot.plan.steps.slice(0, 5), // Keep only first 5 steps
            },

            // Summary of results instead of full details
            results: Object.keys(snapshot.results).reduce(
                (acc, key) => {
                    const result = snapshot.results[key];
                    if (result) {
                        acc[key] = {
                            status: result.status,
                            // Omit detailed output, keep only status
                        } as any; // Type assertion for simplified result
                    }
                    return acc;
                },
                {} as Record<string, any>,
            ),

            // Error info if any
            error: snapshot.error,
        };
    }

    // ===== RECOVERY =====

    async recoverSession(threadId: string): Promise<{
        context: AgentRuntimeContext;
        wasRecovered: boolean;
        gapDuration: number;
        inferences: Record<string, string>;
    }> {
        await this.ensureInitialized();

        const session =
            await this.sessionsAdapter.retrieveContextSessionByThreadId(
                threadId,
            );
        if (!session) {
            throw new Error(`Session for thread ${threadId} not found`);
        }

        const lastActivity = session.lastActivityAt;
        const gapDuration = Date.now() - lastActivity;
        const needsRecovery = isRecoveryNeeded(lastActivity);

        let inferences: Record<string, string> = {};

        if (needsRecovery) {
            // Get latest snapshot for enhanced recovery context
            const latestSnapshot =
                await this.snapshotsAdapter.retrieveLatestSnapshotForSession(
                    session.runtime.sessionId, // Use sessionId for snapshot retrieval
                );

            if (latestSnapshot) {
                inferences = this.buildInferences(
                    session.runtime,
                    latestSnapshot,
                );
            }

            logger.info(
                `🔄 Session recovered after ${Math.round(gapDuration / 1000)}s gap`,
            );
        }

        // Ensure runtime context is valid
        if (!isValidRuntimeContext(session.runtime)) {
            throw new Error(`Invalid runtime context for thread ${threadId}`);
        }

        return {
            context: session.runtime,
            wasRecovered: needsRecovery,
            gapDuration,
            inferences,
        };
    }

    // ===== ANALYTICS & UTILITIES =====

    async getSessionStats(
        _userId: string,
        _tenantId: string = 'default',
    ): Promise<{
        totalSessions: number;
        activeSessions: number;
        averageSessionDuration: number;
        totalExecutions: number;
        recentActivity: number;
    }> {
        await this.ensureInitialized();

        // This would require more complex querying - simplified for now
        const stats = await this.sessionsAdapter.getStats();

        return {
            totalSessions: stats.itemCount,
            activeSessions: 0, // Would need query support
            averageSessionDuration: 0, // Would need query support
            totalExecutions: 0, // Would need aggregation
            recentActivity: 0, // Would need query support
        };
    }

    // ===== PRIVATE UTILITIES =====

    private inferIntent(message: string): string {
        const lower = message.toLowerCase();

        // Generic intent detection patterns (framework agnostic)
        if (
            lower.includes('create') ||
            lower.includes('add') ||
            lower.includes('make')
        ) {
            return 'create';
        }

        if (
            lower.includes('update') ||
            lower.includes('edit') ||
            lower.includes('modify')
        ) {
            return 'update';
        }

        if (lower.includes('delete') || lower.includes('remove')) {
            return 'delete';
        }

        if (
            lower.includes('search') ||
            lower.includes('find') ||
            lower.includes('get')
        ) {
            return 'search';
        }

        if (
            lower.includes('validate') ||
            lower.includes('check') ||
            lower.includes('verify')
        ) {
            return 'validate';
        }

        if (lower.includes('help') || lower.includes('assist')) {
            return 'help';
        }

        return 'general-assistance';
    }

    private buildInferences(
        runtime: AgentRuntimeContext,
        snapshot: any,
    ): Record<string, string> {
        const inferences: Record<string, string> = {};
        const lastMessage =
            runtime.messages[runtime.messages.length - 1]?.content || '';

        // Generic reference resolution patterns (framework agnostic)
        const referencePatterns = [
            {
                patterns: ['this', 'that', 'the item', 'it'],
                entityType: 'items', // Generic fallback
            },
            {
                patterns: ['this one', 'that one', 'the current'],
                entityType: 'items',
            },
        ];

        referencePatterns.forEach(({ patterns, entityType }) => {
            patterns.forEach((pattern) => {
                if (lastMessage.includes(pattern)) {
                    const entities = runtime.entities[
                        entityType as keyof typeof runtime.entities
                    ] as EntityRef[] | undefined;
                    if (entities && entities.length > 0) {
                        const latestEntity = entities[entities.length - 1];
                        if (latestEntity) {
                            inferences[pattern] = latestEntity.id;
                        }
                    }
                }
            });
        });

        // Recovery context from snapshot
        if (snapshot.recoveryContext?.entities) {
            Object.entries(snapshot.recoveryContext.entities).forEach(
                ([entityType, entities]) => {
                    const entitiesArray = entities as any[];
                    if (entitiesArray && entitiesArray.length > 0) {
                        const latest = entitiesArray[entitiesArray.length - 1];
                        if (latest?.id) {
                            inferences[`last_${entityType}`] = latest.id;
                        }
                    }
                },
            );
        }

        return inferences;
    }

    // ===== CLEANUP =====

    async cleanup(): Promise<void> {
        try {
            await this.sessionsAdapter.cleanup();
            await this.snapshotsAdapter.cleanup();

            this.isInitialized = false;
            logger.info('🧹 Enhanced Session Service cleanup completed');
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            logger.error(`❌ Cleanup failed: ${errorMessage}`);
        }
    }
}
