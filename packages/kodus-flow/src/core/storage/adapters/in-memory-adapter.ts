import { createLogger } from '../../../observability/logger.js';
import {
    BaseStorage,
    BaseStorageItem,
    BaseStorageStats,
    StorageAdapterConfig,
    StorageEnum,
} from '../../../core/types/allTypes.js';

const logger = createLogger('in-memory-storage-adapter');

export class InMemoryStorageAdapter<T extends BaseStorageItem>
    implements BaseStorage<T>
{
    private items: Map<string, T> = new Map();
    private config: StorageAdapterConfig;
    private isInitialized = false;

    constructor(config: StorageAdapterConfig) {
        this.config = config;
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        this.startCleanupInterval();

        this.isInitialized = true;
        logger.info('InMemoryStorageAdapter initialized', {
            maxItems: this.config.maxItems,
            enableCompression: this.config.enableCompression,
        });
    }

    async store(item: T): Promise<void> {
        await this.ensureInitialized();

        if (this.items.size >= (this.config.maxItems ?? 1000)) {
            await this.removeOldestItems();
        }

        this.items.set(item.id, item);

        logger.debug('Item stored', {
            id: item.id,
            totalItems: this.items.size,
        });
    }

    async retrieve(id: string): Promise<T | null> {
        await this.ensureInitialized();

        const item = this.items.get(id);
        if (!item) {
            return null;
        }

        if (
            item.metadata?.expireAt &&
            typeof item.metadata.expireAt === 'number' &&
            Date.now() > item.metadata.expireAt
        ) {
            await this.delete(id);
            return null;
        }

        return item;
    }

    async delete(id: string): Promise<boolean> {
        await this.ensureInitialized();

        const deleted = this.items.delete(id);

        if (deleted) {
            logger.debug('Item deleted', { id });
        }

        return deleted;
    }

    async clear(): Promise<void> {
        await this.ensureInitialized();

        this.items.clear();
        logger.info('All items cleared');
    }

    async getStats(): Promise<BaseStorageStats> {
        await this.ensureInitialized();

        const items = Array.from(this.items.values());
        const totalSize = items.reduce((size, item) => {
            return size + JSON.stringify(item).length;
        }, 0);

        return {
            itemCount: this.items.size,
            totalSize,
            averageItemSize:
                this.items.size > 0 ? totalSize / this.items.size : 0,
            adapterType: StorageEnum.INMEMORY,
        };
    }

    async isHealthy(): Promise<boolean> {
        return this.isInitialized;
    }

    async cleanup(): Promise<void> {
        this.items.clear();
        this.isInitialized = false;
        logger.info('InMemoryStorageAdapter cleaned up');
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    private startCleanupInterval(): void {
        const cleanupInterval = this.config.cleanupInterval ?? 300000;
        if (cleanupInterval > 0) {
            setInterval(async () => {
                await this.cleanupExpiredItems();
            }, cleanupInterval);
        }
    }

    private async removeOldestItems(): Promise<void> {
        const items = Array.from(this.items.entries());

        items.sort(([, a], [, b]) => a.timestamp - b.timestamp);

        const toRemove = items.slice(
            0,
            Math.floor((this.config.maxItems ?? 1000) * 0.1),
        ); // Remove 10%

        for (const [id] of toRemove) {
            this.items.delete(id);
        }

        logger.debug('Removed oldest items', {
            removedCount: toRemove.length,
            remainingCount: this.items.size,
        });
    }

    private async cleanupExpiredItems(): Promise<void> {
        const now = Date.now();
        let expiredCount = 0;

        for (const [id, item] of this.items.entries()) {
            if (
                item.metadata?.expireAt &&
                typeof item.metadata.expireAt === 'number' &&
                now > item.metadata.expireAt
            ) {
                this.items.delete(id);
                expiredCount++;
            }
        }

        if (expiredCount > 0) {
            logger.debug('Cleaned up expired items', {
                expiredCount,
                remainingCount: this.items.size,
            });
        }
    }

    getAllItems(): Map<string, T> {
        return new Map(this.items);
    }
}
