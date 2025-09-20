import { StoragePersistorAdapter } from './storage-adapter.js';
import { createLogger } from '../observability/logger.js';
import {
    Persistor,
    PersistorConfig,
    StorageEnum,
} from '../core/types/allTypes.js';

const logger = createLogger('persistor-factory');

export function createPersistorFromConfig(config: PersistorConfig): Persistor {
    logger.info('Creating persistor', { type: config.type });

    const type = config.type;

    switch (type) {
        case 'memory':
            return new StoragePersistorAdapter(
                { type: StorageEnum.INMEMORY },
                {
                    maxSnapshots: config.maxSnapshots,
                    enableCompression: config.enableCompression,
                    enableDeltaCompression: config.enableDeltaCompression,
                    cleanupInterval: config.cleanupInterval,
                },
            );

        case 'mongodb':
            return new StoragePersistorAdapter(
                {
                    type: StorageEnum.MONGODB,
                    connectionString: config.connectionString,
                    options: {
                        database: config.database,
                        collection: config.collection,
                        maxPoolSize: config.maxPoolSize,
                        serverSelectionTimeoutMS:
                            config.serverSelectionTimeoutMS,
                        connectTimeoutMS: config.connectTimeoutMS,
                        socketTimeoutMS: config.socketTimeoutMS,
                        ttl: config.ttl,
                    },
                },
                {
                    maxSnapshots: config.maxSnapshots,
                    enableCompression: config.enableCompression,
                    enableDeltaCompression: config.enableDeltaCompression,
                    cleanupInterval: config.cleanupInterval,
                },
            );

        default:
            throw new Error(`Unknown persistor type: ${type}`);
    }
}

/**
 * Create persistor with simple type and options
 */
export function createPersistor(
    type: 'memory' | 'mongodb' = 'memory',
    options: Record<string, unknown> = {},
): Persistor {
    const config: PersistorConfig = {
        type,
        maxSnapshots: 1000,
        enableCompression: true,
        enableDeltaCompression: true,
        cleanupInterval: 300000,
        ...options,
    } as PersistorConfig;

    return createPersistorFromConfig(config);
}

/**
 * Global persistor instance management
 */
let globalPersistor: Persistor | null = null;

/**
 * Get global persistor instance
 */
export function getGlobalPersistor(): Persistor {
    if (!globalPersistor) {
        globalPersistor = createPersistor('memory');
        logger.info('Created global memory persistor');
    }
    return globalPersistor;
}

/**
 * Set global persistor instance
 */
export function setGlobalPersistor(persistor: Persistor): void {
    globalPersistor = persistor;
    logger.info('Set global persistor', {
        type: persistor.constructor.name,
    });
}

/**
 * Reset global persistor to default
 */
export function resetGlobalPersistor(): void {
    globalPersistor = null;
    logger.info('Reset global persistor');
}
