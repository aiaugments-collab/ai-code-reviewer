import { createLogger } from '../../observability/logger.js';
import {
    BaseStorage,
    BaseStorageItem,
    STORAGE_DEFAULTS,
    StorageAdapterConfig,
    StorageEnum,
} from '../types/allTypes.js';
import { InMemoryStorageAdapter } from './adapters/in-memory-adapter.js';
import { MongoDBStorageAdapter } from './adapters/mongodb-adapter.js';

const logger = createLogger('storage-factory');

export class StorageAdapterFactory {
    private static adapters = new Map<string, BaseStorage<BaseStorageItem>>();

    static async create<T extends BaseStorage<BaseStorageItem>>(
        config: StorageAdapterConfig,
    ): Promise<T> {
        logger.info('Creating storage adapter', { type: config.type, config });

        const collection = (config.options?.collection ?? 'default') as string;
        const adapterKey = `${config.type}_${config.connectionString || 'default'}_${collection}`;

        if (this.adapters.has(adapterKey)) {
            logger.info('Returning cached adapter', { adapterKey });
            return this.adapters.get(adapterKey) as T;
        }

        const defaults =
            STORAGE_DEFAULTS[config.type] || STORAGE_DEFAULTS.memory;
        const mergedConfig = {
            ...defaults,
            ...config,
            options: {
                ...defaults.options,
                ...config.options,
            },
        };

        let adapter: BaseStorage<BaseStorageItem>;

        try {
            switch (config.type) {
                case 'memory':
                    adapter = new InMemoryStorageAdapter(mergedConfig);
                    break;

                case 'mongodb':
                    adapter = new MongoDBStorageAdapter(mergedConfig);
                    break;

                default:
                    throw new Error(`Unknown storage type: ${config.type}`);
            }

            await adapter.initialize();

            this.adapters.set(adapterKey, adapter);

            logger.info('Storage adapter created', {
                type: config.type,
                adapterKey,
            });

            return adapter as T;
        } catch (error) {
            logger.error('Failed to create storage adapter', error as Error, {
                type: config.type,
                adapterKey,
            });
            throw error;
        }
    }

    static getCached<T extends BaseStorage<BaseStorageItem>>(
        type: StorageEnum,
        connectionString?: string,
    ): T | null {
        const adapterKey = `${type}_${connectionString || 'default'}`;
        return (this.adapters.get(adapterKey) as T) || null;
    }

    static async clearCache(): Promise<void> {
        const adapters = Array.from(this.adapters.values());
        await Promise.all(adapters.map((adapter) => adapter.cleanup()));
        this.adapters.clear();
        logger.info('Storage adapter cache cleared');
    }

    static getCachedAdapters(): Map<string, BaseStorage<BaseStorageItem>> {
        return new Map(this.adapters);
    }
}

let globalStorageAdapter: BaseStorage<BaseStorageItem> | null = null;

export function getGlobalStorageAdapter(): BaseStorage<BaseStorageItem> {
    if (!globalStorageAdapter) {
        throw new Error(
            'Global storage adapter not initialized. Call setGlobalStorageAdapter first.',
        );
    }
    return globalStorageAdapter;
}

export function setGlobalStorageAdapter(
    adapter: BaseStorage<BaseStorageItem>,
): void {
    globalStorageAdapter = adapter;
    logger.info('Set global storage adapter', {
        type: adapter.constructor.name,
    });
}

export function resetGlobalStorageAdapter(): void {
    globalStorageAdapter = null;
    logger.info('Reset global storage adapter');
}
