import { createLogger } from '../../observability/logger.js';
import { StorageAdapterFactory } from '../storage/factory.js';
import {
    BaseStorage,
    BaseStorageItem,
    MemoryAdapter,
    MemoryAdapterConfig,
    MemoryItem,
    MemoryQuery,
    StorageEnum,
} from '../types/allTypes.js';

const logger = createLogger('memory-storage-adapter');

/**
 * Adapter that implements the old MemoryAdapter interface using the new BaseStorage
 */
export class StorageMemoryAdapter implements MemoryAdapter {
    private storage: BaseStorage<BaseStorageItem> | null = null;
    private isInitialized = false;
    private inMemoryIndex: Map<string, BaseStorageItem> = new Map();

    constructor(
        private config: MemoryAdapterConfig = {
            adapterType: StorageEnum.INMEMORY,
        },
    ) {}

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        this.storage = await StorageAdapterFactory.create({
            type: this.config.adapterType,
            connectionString: this.config.connectionString,
            options: {
                ...this.config.options,
                database: this.config.options?.database || 'kodus-flow',
                collection:
                    this.config.options?.collection || 'kodus-agent-memory',
            },
            maxItems: 10000,
            enableCompression: true,
            cleanupInterval: 300000,
            timeout: this.config.timeout || 5000,
            retries: this.config.retries || 3,
            enableObservability: true,
            enableHealthChecks: true,
            enableMetrics: true,
        });

        this.isInitialized = true;
        logger.info('StorageMemoryAdapter initialized', {
            adapterType: this.config.adapterType,
        });
    }

    async store(item: MemoryItem): Promise<void> {
        await this.ensureInitialized();

        const storageItem: BaseStorageItem = {
            id: item.id,
            timestamp: item.timestamp,
            metadata: {
                type: item.type,
                entityId: item.entityId,
                sessionId: item.sessionId,
                tenantId: item.tenantId,
                contextId: item.contextId,
                key: item.key,
                value: item.value,
                ...item.metadata,
            },
        };

        await this.storage!.store(storageItem);
        this.inMemoryIndex.set(storageItem.id, storageItem);
        logger.debug('Memory item stored', { id: item.id, type: item.type });
    }

    async retrieve(id: string): Promise<MemoryItem | null> {
        await this.ensureInitialized();

        const item =
            (await this.storage!.retrieve(id)) ||
            this.inMemoryIndex.get(id) ||
            null;
        if (!item) return null;

        // Convert back to MemoryItem format
        return {
            id: item.id,
            timestamp: item.timestamp,
            type: item.metadata?.type as string,
            entityId: item.metadata?.entityId as string,
            sessionId: item.metadata?.sessionId as string,
            tenantId: item.metadata?.tenantId as string,
            contextId: item.metadata?.contextId as string,
            key: item.metadata?.key as string,
            value: item.metadata?.value,
            metadata: item.metadata,
        } as MemoryItem;
    }

    async search(_query: MemoryQuery): Promise<MemoryItem[]> {
        await this.ensureInitialized();

        // Implementação básica usando o índice em memória (metadados)
        // Suporta filtros: type, key, tenantId, entityId, sessionId, contextId, range temporal, limit e ordenação
        const query = _query || {};

        const items = Array.from(this.inMemoryIndex.values());

        const filtered = items.filter((it) => {
            const md = it.metadata || {};
            if (query.type && md.type !== query.type) return false;
            if (query.key && md.key !== query.key) return false;
            if (query.keyPattern && typeof md.key === 'string') {
                try {
                    const re = new RegExp(query.keyPattern);
                    if (!re.test(md.key as string)) return false;
                } catch {
                    // se regex inválida, ignora pattern
                }
            }
            if (query.tenantId && md.tenantId !== query.tenantId) return false;
            if (query.entityId && md.entityId !== query.entityId) return false;
            if (query.sessionId && md.sessionId !== query.sessionId)
                return false;
            if (query.contextId && md.contextId !== query.contextId)
                return false;
            if (query.fromTimestamp && it.timestamp < query.fromTimestamp)
                return false;
            if (query.toTimestamp && it.timestamp > query.toTimestamp)
                return false;
            return true;
        });

        // Ordenação
        const sortBy = query.sortBy || 'timestamp';
        const sortDir = query.sortDirection === 'asc' ? 1 : -1;
        filtered.sort((a, b) => {
            const av =
                (a as unknown as Record<string, unknown>)[sortBy] ??
                (a.metadata || {})[sortBy as string];
            const bv =
                (b as unknown as Record<string, unknown>)[sortBy] ??
                (b.metadata || {})[sortBy as string];
            if (typeof av === 'number' && typeof bv === 'number') {
                return (av - bv) * sortDir;
            }
            const as = String(av ?? '');
            const bs = String(bv ?? '');
            return as.localeCompare(bs) * sortDir;
        });

        // Paginação
        const offset = query.offset ?? 0;
        const limit = query.limit ?? filtered.length;
        const sliced = filtered.slice(offset, offset + limit);

        // Mapear para MemoryItem
        const result: MemoryItem[] = sliced.map((it) => ({
            id: it.id,
            timestamp: it.timestamp,
            type: (it.metadata?.type as string) || undefined,
            entityId: (it.metadata?.entityId as string) || undefined,
            sessionId: (it.metadata?.sessionId as string) || undefined,
            tenantId: (it.metadata?.tenantId as string) || undefined,
            contextId: (it.metadata?.contextId as string) || undefined,
            key: (it.metadata?.key as string) || 'default',
            value: it.metadata?.value,
            metadata: it.metadata,
        }));

        return result;
    }

    async delete(id: string): Promise<boolean> {
        await this.ensureInitialized();

        const deleted = await this.storage!.delete(id);
        if (deleted) {
            logger.debug('Memory item deleted', { id });
            this.inMemoryIndex.delete(id);
        }
        return deleted;
    }

    async clear(): Promise<void> {
        await this.ensureInitialized();

        await this.storage!.clear();
        this.inMemoryIndex.clear();
        logger.info('All memory items cleared');
    }

    async getStats(): Promise<{
        itemCount: number;
        totalSize: number;
        adapterType: string;
    }> {
        await this.ensureInitialized();

        const stats = await this.storage!.getStats();

        return {
            itemCount: stats.itemCount,
            totalSize: stats.totalSize,
            adapterType: stats.adapterType,
        };
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
        logger.info('StorageMemoryAdapter cleaned up');
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }
}
