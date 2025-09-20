export type {
    AgentRuntimeContext,
    ChatMessage,
    ToolCall,
    EntityRef,
    ConnectionStatus,

    // LLM Plan compatibility
    PlanStep,
    PlanningResult,
    PlanExecutionBridge,

    // Persistence (for recovery)
    ExecutionSnapshot,
    StepResult,

    // Context bridge (solves createFinalResponse)
    ContextBridgeService,
    FinalResponseContext,

    // Session management
    SessionManager,

    // Utilities
    ContextUpdate,
    EntityResolver,
    IntentInference,
    RecoveryStrategy,
    ContextHealth,
} from './types/context-types.js';

// 🎯 SENIOR SOLUTION: Context Service as Facade/Service Layer
export { ContextService, Context } from './context-service.js';

// 🎯 SIMPLIFIED SESSION CONFIGURATION
export type {
    SessionConfig,
    DEFAULT_SESSION_CONFIG,
    SESSION_CONSTANTS,
    createSessionConfig,
    SESSION_CONFIG_PRESETS,
} from './types/context-types.js';

// ===============================================
// 🏗️ ENHANCED CONTEXT BUILDER (SINGLETON PATTERN)
// ===============================================

import { EnhancedSessionService } from './services/enhanced-session-service.js';
import {
    getGlobalMemoryManager,
    MemoryManager,
    setGlobalMemoryManager,
} from '../memory/memory-manager.js';
import { createLogger } from '../../observability/logger.js';
import { StorageEnum, Thread } from '../types/allTypes.js';
import {
    ContextBridge,
    createContextBridge,
} from './services/context-bridge-service.js';
import {
    SESSION_CONSTANTS,
    DEFAULT_SESSION_CONFIG,
} from './types/context-types.js';

const logger = createLogger('EnhancedContextBuilder');

export interface EnhancedContextBuilderConfig {
    connectionString?: string;
    dbName?: string;
    database?: string;
    adapterType: StorageEnum;
    sessionsCollection?: string;
    snapshotsCollection?: string;
    memoryCollection?: string;
    sessionTTL?: number | string;
    maxMessagesInMemory?: number;
    maxMessagesInMemoryByRole?: Partial<
        Record<'user' | 'assistant' | 'tool' | 'system', number>
    >;
    snapshotTTL?: number;
}

export class EnhancedContextBuilder {
    private static instance: EnhancedContextBuilder | undefined;

    private readonly config: EnhancedContextBuilderConfig;
    private memoryManager!: MemoryManager;
    private sessionManager!: EnhancedSessionService;
    private contextBridge!: ContextBridge;
    private isInitialized = false;

    private constructor(
        config: EnhancedContextBuilderConfig = DEFAULT_SESSION_CONFIG,
    ) {
        // ✅ SIMPLE CONFIG - Apenas o essencial!
        const resolvedTTL = this.resolveTTL(config.sessionTTL);
        this.config = {
            adapterType: config.connectionString
                ? StorageEnum.MONGODB
                : StorageEnum.INMEMORY,
            connectionString: config.connectionString,
            database: config.database || config.dbName,
            sessionTTL: resolvedTTL || DEFAULT_SESSION_CONFIG.sessionTTL,
        };

        logger.info('EnhancedContextBuilder created', {
            adapterType: this.config.adapterType,
            database: this.config.database,
            sessionTTL: this.config.sessionTTL,
        });
    }

    private resolveTTL(ttl?: number | string): number | undefined {
        if (ttl === undefined) return undefined;
        if (typeof ttl === 'number') return ttl;
        const str = ttl.trim().toLowerCase();
        const match = str.match(/^(\d+)\s*(ms|s|m|h|d)?$/);
        if (!match) return undefined;
        const value = parseInt(match[1] as string, 10);
        const unit = ((match[2] as string) || 'ms') as string;
        switch (unit) {
            case 'ms':
                return value;
            case 's':
                return value * 1000;
            case 'm':
                return value * 60 * 1000;
            case 'h':
                return value * 60 * 60 * 1000;
            case 'd':
                return value * 24 * 60 * 60 * 1000;
            default:
                return undefined;
        }
    }

    static getInstance(
        config?: EnhancedContextBuilderConfig,
    ): EnhancedContextBuilder {
        if (!EnhancedContextBuilder.instance) {
            EnhancedContextBuilder.instance = new EnhancedContextBuilder(
                config,
            );
        }
        return EnhancedContextBuilder.instance;
    }

    static configure(
        config: EnhancedContextBuilderConfig,
    ): EnhancedContextBuilder {
        EnhancedContextBuilder.resetInstance();
        return EnhancedContextBuilder.getInstance(config);
    }

    static resetInstance(): void {
        EnhancedContextBuilder.instance = undefined;
    }

    getConfig(): EnhancedContextBuilderConfig {
        return this.config;
    }

    /**
     * Initialize the context infrastructure (collections, adapters, etc)
     * Should be called once during application startup
     */
    async initialize(): Promise<void> {
        await this.ensureInitialized();
    }

    private async ensureInitialized(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        logger.info('🚀 Starting ContextNew initialization', {
            adapterType: this.config.adapterType,
            connectionString: this.config.connectionString
                ? '[SET]'
                : '[NOT SET]',
            database: this.config.database,
        });

        // 1. Initialize memory manager
        logger.info('🧠 Step 1: Initializing memory manager...');
        if (this.config.adapterType === 'mongodb') {
            logger.info('🔗 Creating MongoDB memory manager', {
                database: this.config.database,
                collection: SESSION_CONSTANTS.COLLECTIONS.MEMORY,
            });

            this.memoryManager = new MemoryManager({
                adapterType: StorageEnum.MONGODB,
                adapterConfig: {
                    connectionString: this.config.connectionString,
                    options: {
                        database: this.config.database, // ✅ Agora usa database customizado
                        collection: SESSION_CONSTANTS.COLLECTIONS.MEMORY,
                        enableCompression:
                            SESSION_CONSTANTS.FEATURES.ENABLE_COMPRESSION,
                        cleanupInterval:
                            SESSION_CONSTANTS.PERFORMANCE.CLEANUP_INTERVAL,
                    },
                },
            });
            setGlobalMemoryManager(this.memoryManager);

            // Initialize memory manager to create collection
            logger.info(
                '📦 Initializing memory manager to create collection...',
            );
            await this.memoryManager.initialize();
            logger.info('✅ MongoDB memory manager created and initialized');
        } else {
            // Use existing global memory manager (InMemory case)
            this.memoryManager = getGlobalMemoryManager();
        }

        // 2. Initialize session manager with simplified config
        this.sessionManager = new EnhancedSessionService(
            this.config.connectionString,
            {
                adapterType: this.config.adapterType,
                database: this.config.database, // ✅ Agora usa database customizado
                sessionsCollection: SESSION_CONSTANTS.COLLECTIONS.SESSIONS,
                snapshotsCollection: SESSION_CONSTANTS.COLLECTIONS.SNAPSHOTS,
                sessionTTL: this.config.sessionTTL as number | undefined,
            },
        );

        // 3. Initialize context bridge
        this.contextBridge = createContextBridge(this.config.connectionString, {
            memoryManager: this.memoryManager,
            dbName: this.config.database, // ✅ Agora usa database customizado
            sessionsCollection: SESSION_CONSTANTS.COLLECTIONS.SESSIONS,
            snapshotsCollection: SESSION_CONSTANTS.COLLECTIONS.SNAPSHOTS,
            sessionTTL: this.config.sessionTTL as number | undefined,
            snapshotTTL: SESSION_CONSTANTS.SNAPSHOT_TTL,
        });

        logger.info(
            '📂 Step 3: Initializing session manager (creates sessions + snapshots collections)...',
        );
        await this.sessionManager.initialize();
        logger.info('✅ Session manager initialized');

        this.isInitialized = true;

        logger.info('EnhancedContextBuilder initialized', {
            memoryManager: 'ready',
            sessionManager: 'ready',
            contextBridge: 'ready',
            collectionsEnsured: this.config.adapterType === 'mongodb',
        });
    }

    /**
     * 🎯 MAIN METHOD: Initialize session for agent execution
     * Similar ao ContextBuilder, mas focado na sessão enhanced
     */
    async initializeAgentSession(
        threadId: Thread['id'],
        tenantId: string,
    ): Promise<void> {
        await this.ensureInitialized();

        logger.info('Initializing enhanced agent session', {
            threadId,
            tenantId,
        });

        // Create or recover session based on threadId
        await this.sessionManager.getOrCreateSession(threadId, tenantId);

        logger.debug('Enhanced agent session initialized', {
            threadId,
            tenantId,
        });
    }

    /**
     * 🔥 SOLVE createFinalResponse problem
     * Available everywhere in agent execution chain
     */
    async buildFinalResponseContext(plannerContext: any) {
        await this.ensureInitialized();
        return this.contextBridge.buildFinalResponseContext(plannerContext);
    }

    getSessionManager(): EnhancedSessionService {
        if (!this.isInitialized) {
            throw new Error('EnhancedContextBuilder not initialized');
        }
        return this.sessionManager;
    }

    getContextBridge(): ContextBridge {
        if (!this.isInitialized) {
            throw new Error('EnhancedContextBuilder not initialized');
        }
        return this.contextBridge;
    }

    getMemoryManager(): MemoryManager {
        return this.memoryManager;
    }

    async cleanup(): Promise<void> {
        if (this.isInitialized) {
            await this.sessionManager.cleanup();
            await this.memoryManager.cleanup();
            this.isInitialized = false;
            logger.info('EnhancedContextBuilder cleaned up');
        }
    }
}
