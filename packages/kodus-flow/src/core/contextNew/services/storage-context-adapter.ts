/**
 * 🍃 STORAGE CONTEXT ADAPTER - Following Existing Pattern
 *
 * Uses StorageAdapterFactory to support InMemory and MongoDB
 * Follows the same pattern as storage-session-adapter.ts
 */

import {
    BaseStorage,
    BaseStorageStats,
    StorageAdapterConfig,
    StorageEnum,
} from '../../types/allTypes.js';
import { createLogger } from '../../../observability/logger.js';
import { StorageAdapterFactory } from '../../storage/index.js';
import {
    AgentRuntimeContext,
    ExecutionSnapshot,
} from '../types/context-types.js';

const logger = createLogger('storage-context-adapter');

// ===============================================
// 🗄️ STORAGE ITEM TYPES
// ===============================================

/**
 * Context session storage item
 */
export interface ContextSessionStorageItem {
    id: string; // sessionId (unique document ID)
    threadId: string; // threadId for query/recovery
    timestamp: number;
    sessionData: {
        sessionId: string;
        threadId: string; // Also store threadId in sessionData
        tenantId: string;
        status: 'active' | 'paused' | 'completed' | 'expired';
        runtime: AgentRuntimeContext;
        createdAt: string; // ISO string
        lastActivityAt: string; // ISO string
        createdAtTimestamp: number;
        lastActivityTimestamp: number;
        lastCorrelationId?: string;
        correlationIdHistory?: string[];
    };
}

/**
 * Execution snapshot storage item
 */
export interface SnapshotStorageItem {
    id: string; // snapshotId
    timestamp: number;
    snapshotData: ExecutionSnapshot & {
        createdAt: string; // ISO string
        expiresAt: string; // ISO string
        // Timestamps for recovery
        createdAtTimestamp: number;
        expiresAtTimestamp: number;
    };
}

// ===============================================
// 🛠️ DATE TRANSFORMATION UTILITIES
// ===============================================

class ContextDateUtils {
    static timestampToFormattedDate(timestamp: number): string {
        return new Date(timestamp).toISOString();
    }

    static formattedDateToTimestamp(dateString: string): number {
        return new Date(dateString).getTime();
    }

    static transformContextSessionForStorage(
        sessionId: string,
        threadId: string,
        tenantId: string,
        status: 'active' | 'paused' | 'completed' | 'expired',
        runtime: AgentRuntimeContext,
        createdAt: number,
        lastActivityAt: number,
        extras?: {
            lastCorrelationId?: string;
            correlationIdHistory?: string[];
        },
    ): ContextSessionStorageItem['sessionData'] {
        return {
            sessionId,
            threadId,
            tenantId,
            status,
            runtime,
            createdAt: this.timestampToFormattedDate(createdAt),
            lastActivityAt: this.timestampToFormattedDate(lastActivityAt),
            createdAtTimestamp: createdAt,
            lastActivityTimestamp: lastActivityAt,
            ...(extras?.lastCorrelationId && {
                lastCorrelationId: extras.lastCorrelationId,
            }),
            ...(extras?.correlationIdHistory && {
                correlationIdHistory: extras.correlationIdHistory,
            }),
        };
    }

    static transformSnapshotForStorage(
        snapshot: ExecutionSnapshot,
        createdAt: number,
        expiresAt: number,
    ): SnapshotStorageItem['snapshotData'] {
        return {
            ...snapshot,
            createdAt: this.timestampToFormattedDate(createdAt),
            expiresAt: this.timestampToFormattedDate(expiresAt),
            createdAtTimestamp: createdAt,
            expiresAtTimestamp: expiresAt,
        };
    }

    static restoreContextSessionFromStorage(
        sessionData: ContextSessionStorageItem['sessionData'],
    ) {
        return {
            sessionId: sessionData.sessionId,
            threadId: sessionData.threadId,
            tenantId: sessionData.tenantId,
            status: sessionData.status,
            runtime: sessionData.runtime,
            createdAt:
                sessionData.createdAtTimestamp ||
                this.formattedDateToTimestamp(sessionData.createdAt),
            lastActivityAt:
                sessionData.lastActivityTimestamp ||
                this.formattedDateToTimestamp(sessionData.lastActivityAt),
        };
    }

    static restoreSnapshotFromStorage(
        snapshotData: SnapshotStorageItem['snapshotData'],
    ): ExecutionSnapshot & { createdAt: number; expiresAt: number } {
        const {
            createdAt,
            expiresAt,
            createdAtTimestamp,
            expiresAtTimestamp,
            ...snapshot
        } = snapshotData;

        return {
            ...snapshot,
            createdAt:
                createdAtTimestamp || this.formattedDateToTimestamp(createdAt),
            expiresAt:
                expiresAtTimestamp || this.formattedDateToTimestamp(expiresAt),
        };
    }
}

// ===============================================
// 🏗️ CONTEXT SESSIONS ADAPTER
// ===============================================

export class StorageContextSessionAdapter
    implements BaseStorage<ContextSessionStorageItem>
{
    private storage: BaseStorage<ContextSessionStorageItem> | null = null;
    private config: StorageAdapterConfig;
    private isInitialized = false;

    constructor(config: {
        adapterType: StorageEnum;
        connectionString?: string;
        options?: Record<string, unknown>;
        timeout?: number;
        retries?: number;
    }) {
        this.config = {
            type: config.adapterType || StorageEnum.INMEMORY,
            connectionString: config.connectionString,
            options: {
                ...config.options,
                database: config.options?.database || 'kodus-flow',
                collection:
                    config.options?.collection || 'kodus-agent-sessions',
            },
            maxItems: 1000,
            enableCompression: true,
            cleanupInterval: 300000, // 5 minutes
            timeout: config.timeout || 10000,
            retries: config.retries || 3,
            enableObservability: true,
            enableHealthChecks: true,
            enableMetrics: true,
        };
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        this.storage = await StorageAdapterFactory.create<
            BaseStorage<ContextSessionStorageItem>
        >(this.config);

        // Create indexes for MongoDB optimization
        await this.ensureIndexes();

        this.isInitialized = true;
        logger.info('StorageContextSessionAdapter initialized', {
            adapterType: this.config.type,
            collection: this.config.options?.collection,
        });
    }

    private async ensureIndexes(): Promise<void> {
        const storageAny = this.storage as any;

        // Only create indexes for MongoDB
        if (
            storageAny?.collection &&
            typeof storageAny.collection.createIndex === 'function'
        ) {
            try {
                // Index for fast threadId queries
                await storageAny.collection.createIndex({ threadId: 1 });

                // Index for tenant queries
                await storageAny.collection.createIndex({
                    ['sessionData.tenantId']: 1,
                });

                // Index for TTL cleanup (if configured)
                if (this.config.options?.sessionTTL) {
                    await storageAny.collection.createIndex(
                        { ['sessionData.lastActivityTimestamp']: 1 },
                        {
                            expireAfterSeconds: Math.floor(
                                (this.config.options.sessionTTL as number) /
                                    1000,
                            ),
                        },
                    );
                }

                logger.info('MongoDB indexes created for sessions collection');
            } catch (error) {
                logger.warn('Failed to create MongoDB indexes', { error });
            }
        }
    }

    async store(item: ContextSessionStorageItem): Promise<void> {
        await this.ensureInitialized();
        await this.storage!.store(item);
        logger.debug('Context session stored', {
            sessionId: item.sessionData.sessionId,
        });
    }

    async retrieve(id: string): Promise<ContextSessionStorageItem | null> {
        await this.ensureInitialized();
        return await this.storage!.retrieve(id);
    }

    async delete(id: string): Promise<boolean> {
        await this.ensureInitialized();
        const deleted = await this.storage!.delete(id);
        if (deleted) {
            logger.debug('Context session deleted', { sessionId: id });
        }
        return deleted;
    }

    async clear(): Promise<void> {
        await this.ensureInitialized();
        await this.storage!.clear();
        logger.info('All context sessions cleared');
    }

    async getStats(): Promise<BaseStorageStats> {
        await this.ensureInitialized();
        return await this.storage!.getStats();
    }

    async isHealthy(): Promise<boolean> {
        await this.ensureInitialized();
        return this.storage!.isHealthy();
    }

    async cleanup(): Promise<void> {
        if (this.storage) {
            await this.storage.cleanup();
        }
        this.isInitialized = false;
        logger.info('StorageContextSessionAdapter cleaned up');
    }

    // ===== CONTEXT-SPECIFIC METHODS =====

    async storeContextSession(
        sessionId: string,
        threadId: string,
        tenantId: string,
        status: 'active' | 'paused' | 'completed' | 'expired',
        runtime: AgentRuntimeContext,
        createdAt: number,
        lastActivityAt: number,
        extras?: {
            lastCorrelationId?: string;
            correlationIdHistory?: string[];
            expectedVersion?: number;
        },
    ): Promise<void> {
        const sessionData = ContextDateUtils.transformContextSessionForStorage(
            sessionId,
            threadId,
            tenantId,
            status,
            runtime,
            createdAt,
            lastActivityAt,
            extras,
        );

        const storageAny = this.storage as any;
        if (
            storageAny?.collection &&
            typeof storageAny.collection.updateOne === 'function'
        ) {
            const filter: any = { id: sessionId };
            if (typeof extras?.expectedVersion === 'number') {
                filter['sessionData.version'] = extras.expectedVersion;
            }
            const setObj: Record<string, unknown> = {};
            setObj['id'] = sessionId;
            setObj['threadId'] = threadId;
            setObj['timestamp'] = lastActivityAt;
            setObj['sessionData.sessionId'] = sessionData.sessionId;
            setObj['sessionData.threadId'] = sessionData.threadId;
            setObj['sessionData.tenantId'] = sessionData.tenantId;
            setObj['sessionData.status'] = sessionData.status;
            setObj['sessionData.runtime'] = sessionData.runtime;
            setObj['sessionData.createdAt'] = sessionData.createdAt;
            setObj['sessionData.lastActivityAt'] = sessionData.lastActivityAt;
            setObj['sessionData.createdAtTimestamp'] =
                sessionData.createdAtTimestamp;
            setObj['sessionData.lastActivityTimestamp'] =
                sessionData.lastActivityTimestamp;
            if (sessionData.lastCorrelationId) {
                setObj['sessionData.lastCorrelationId'] =
                    sessionData.lastCorrelationId;
            }
            if (sessionData.correlationIdHistory) {
                setObj['sessionData.correlationIdHistory'] =
                    sessionData.correlationIdHistory;
            }
            const incObj: Record<string, number> = {};
            incObj['sessionData.version'] = 1;
            const update: any = {
                $set: setObj,
                $inc: incObj,
            };
            const opts = { upsert: true };
            const res = await storageAny.collection.updateOne(
                filter,
                update,
                opts,
            );
            if (
                typeof extras?.expectedVersion === 'number' &&
                res.matchedCount === 0 &&
                res.upsertedCount === 0
            ) {
                logger.warn(
                    'Optimistic concurrency conflict on session store',
                    {
                        sessionId,
                        expectedVersion: extras?.expectedVersion,
                    },
                );
            }
            return;
        }

        const storageItem: ContextSessionStorageItem = {
            id: sessionId, // Use sessionId as unique document ID
            threadId, // Keep threadId for queries
            timestamp: lastActivityAt,
            sessionData,
        };

        await this.store(storageItem);
    }

    async retrieveContextSession(sessionId: string) {
        const item = await this.retrieve(sessionId);

        if (!item) {
            return null;
        }

        const restored = ContextDateUtils.restoreContextSessionFromStorage(
            item.sessionData,
        );
        (restored as any).version = (item as any).sessionData?.version;
        return restored;
    }

    async retrieveContextSessionByThreadId(threadId: string) {
        await this.ensureInitialized();

        // Optimized direct query for MongoDB
        const storageAny = this.storage as any;

        // Check if it's MongoDB adapter with direct collection access
        if (
            storageAny?.collection &&
            typeof storageAny.collection.findOne === 'function'
        ) {
            try {
                // Direct MongoDB query with index optimization
                const item = await storageAny.collection.findOne({ threadId });
                if (!item) return null;

                const restored =
                    ContextDateUtils.restoreContextSessionFromStorage(
                        item.sessionData,
                    );
                (restored as any).version = (item as any).sessionData?.version;
                return restored;
            } catch (error) {
                logger.warn(
                    'Direct MongoDB query failed, falling back to generic query',
                    { error },
                );
            }
        }

        // Fallback for InMemory or if direct access fails
        const result = await this.findContextSessionByQuery({ threadId });
        return result;
    }

    async deleteContextSession(sessionId: string): Promise<boolean> {
        return await this.delete(sessionId);
    }

    async findContextSessionByQuery(query: Record<string, unknown>) {
        await this.ensureInitialized();

        try {
            const anyStorage = this.storage as unknown as {
                findOneByQuery?: (
                    query: Record<string, unknown>,
                ) => Promise<ContextSessionStorageItem | null>;
            };

            if (typeof anyStorage.findOneByQuery === 'function') {
                const item = await anyStorage.findOneByQuery(query);
                if (!item) return null;

                return ContextDateUtils.restoreContextSessionFromStorage(
                    item.sessionData,
                );
            }

            return null;
        } catch (error) {
            logger.warn('Query failed', { error, query });
            return null;
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }
}

// ===============================================
// 🏗️ EXECUTION SNAPSHOTS ADAPTER
// ===============================================

export class StorageSnapshotAdapter
    implements BaseStorage<SnapshotStorageItem>
{
    private storage: BaseStorage<SnapshotStorageItem> | null = null;
    private config: StorageAdapterConfig;
    private isInitialized = false;

    constructor(
        config: {
            adapterType?: StorageEnum;
            connectionString?: string;
            options?: Record<string, unknown>;
            timeout?: number;
            retries?: number;
        } = {},
    ) {
        this.config = {
            type: config.adapterType || StorageEnum.INMEMORY,
            connectionString: config.connectionString,
            options: {
                ...config.options,
                database: config.options?.database || 'kodus-flow',
                collection:
                    config.options?.collection || 'kodus-execution-snapshots',
            },
            maxItems: 5000, // More snapshots
            enableCompression: true,
            cleanupInterval: 300000,
            timeout: config.timeout || 10000,
            retries: config.retries || 3,
            enableObservability: true,
            enableHealthChecks: true,
            enableMetrics: true,
        };
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        this.storage = await StorageAdapterFactory.create<
            BaseStorage<SnapshotStorageItem>
        >(this.config);

        this.isInitialized = true;
        logger.info('StorageSnapshotAdapter initialized', {
            adapterType: this.config.type,
            collection: this.config.options?.collection,
        });
    }

    async store(item: SnapshotStorageItem): Promise<void> {
        await this.ensureInitialized();
        await this.storage!.store(item);
        logger.debug('Execution snapshot stored', {
            executionId: item.snapshotData.executionId,
            sessionId: item.snapshotData.sessionId,
        });
    }

    async retrieve(id: string): Promise<SnapshotStorageItem | null> {
        await this.ensureInitialized();
        return await this.storage!.retrieve(id);
    }

    async delete(id: string): Promise<boolean> {
        await this.ensureInitialized();
        return await this.storage!.delete(id);
    }

    async clear(): Promise<void> {
        await this.ensureInitialized();
        await this.storage!.clear();
        logger.info('All execution snapshots cleared');
    }

    async getStats(): Promise<BaseStorageStats> {
        await this.ensureInitialized();
        return await this.storage!.getStats();
    }

    async isHealthy(): Promise<boolean> {
        await this.ensureInitialized();
        return this.storage!.isHealthy();
    }

    async cleanup(): Promise<void> {
        if (this.storage) {
            await this.storage.cleanup();
        }
        this.isInitialized = false;
        logger.info('StorageSnapshotAdapter cleaned up');
    }

    // ===== SNAPSHOT-SPECIFIC METHODS =====

    async storeExecutionSnapshot(
        snapshot: ExecutionSnapshot,
        ttlDays: number = 7,
    ): Promise<void> {
        const now = Date.now();
        const expiresAt = now + ttlDays * 24 * 60 * 60 * 1000;

        const snapshotData = ContextDateUtils.transformSnapshotForStorage(
            snapshot,
            now,
            expiresAt,
        );

        const storageItem: SnapshotStorageItem = {
            id: `${snapshot.executionId}_${now}`,
            timestamp: now,
            snapshotData,
        };

        await this.store(storageItem);
    }

    async retrieveLatestSnapshotForSession(sessionId: string) {
        await this.ensureInitialized();

        try {
            const anyStorage = this.storage as unknown as {
                findOneByQuery?: (
                    query: Record<string, unknown>,
                    options?: { sort?: Record<string, number> },
                ) => Promise<SnapshotStorageItem | null>;
            };

            if (typeof anyStorage.findOneByQuery === 'function') {
                const query = { snapshotData: { sessionId } };
                const item = await anyStorage.findOneByQuery(
                    query,
                    { sort: { timestamp: -1 } }, // Latest first
                );

                if (!item) return null;

                return ContextDateUtils.restoreSnapshotFromStorage(
                    item.snapshotData,
                );
            }

            return null;
        } catch (error) {
            logger.warn('Failed to retrieve latest snapshot', {
                error,
                sessionId,
            });
            return null;
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }
}
