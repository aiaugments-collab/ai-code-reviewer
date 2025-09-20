import {
    LogContext,
    MongoDBErrorItem,
    MongoDBExporterConfig,
    MongoDBLogItem,
    MongoDBTelemetryItem,
    ObservabilityStorageConfig,
} from '@/core/types/allTypes.js';
import { createLogger } from '../logger.js';
import { TraceItem, LogProcessor, LogLevel } from '../types.js';

export class MongoDBExporter implements LogProcessor {
    private config: MongoDBExporterConfig;
    private logger: ReturnType<typeof createLogger>;

    private client: any = null;

    private db: any = null;
    private collections: {
        logs: any;

        telemetry: any;

        errors: any;
    } | null = null;

    // Buffers para batch processing
    private logBuffer: MongoDBLogItem[] = [];
    private telemetryBuffer: MongoDBTelemetryItem[] = [];

    private errorBuffer: MongoDBErrorItem[] = [];

    // Flush timers
    private logFlushTimer: NodeJS.Timeout | null = null;
    private telemetryFlushTimer: NodeJS.Timeout | null = null;

    private errorFlushTimer: NodeJS.Timeout | null = null;

    private isInitialized = false;

    constructor(config: Partial<MongoDBExporterConfig> = {}) {
        this.config = {
            connectionString: 'mongodb://localhost:27017/kodus',
            database: 'kodus',
            collections: {
                logs: 'observability_logs',
                telemetry: 'observability_telemetry',
                errors: 'observability_errors',
            },
            batchSize: 50, // Otimizado para menor latência
            flushIntervalMs: 15000, // 15s para dados mais frescos
            maxRetries: 3,
            ttlDays: 30,
            enableObservability: true,
            ...config,
        };

        this.logger = createLogger('mongodb-exporter');
    }

    /**
     * Inicializar conexão com MongoDB
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Dynamic import para evitar dependência obrigatória
            const { MongoClient: mongoClient } = await import('mongodb');

            this.client = new mongoClient(this.config.connectionString, {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
                socketTimeoutMS: 45000,
            });

            await this.client.connect();
            this.db = this.client.db(this.config.database);

            // Inicializar collections
            this.collections = {
                logs: this.db.collection(this.config.collections.logs),
                telemetry: this.db.collection(
                    this.config.collections.telemetry,
                ),
                errors: this.db.collection(this.config.collections.errors),
            };

            // Criar índices para performance
            await this.createIndexes();

            // Configurar TTL para limpeza automática
            await this.setupTTL();

            // Iniciar timers de flush
            this.startFlushTimers();

            this.isInitialized = true;

            this.logger.info('MongoDB Exporter initialized', {
                database: this.config.database,
                collections: this.config.collections,
                batchSize: this.config.batchSize,
                flushIntervalMs: this.config.flushIntervalMs,
            });
        } catch (error) {
            this.logger.error(
                'Failed to initialize MongoDB Exporter',
                error as Error,
            );
            throw error;
        }
    }

    /**
     * Criar índices para performance
     */
    private async createIndexes(): Promise<void> {
        if (!this.collections) return;

        try {
            // Logs indexes
            await this.collections.logs.createIndex({ timestamp: 1 });
            await this.collections.logs.createIndex({ correlationId: 1 });
            await this.collections.logs.createIndex({ tenantId: 1 });
            await this.collections.logs.createIndex({ level: 1 });
            await this.collections.logs.createIndex({ component: 1 });

            // Telemetry indexes
            await this.collections.telemetry.createIndex({ timestamp: 1 });
            await this.collections.telemetry.createIndex({ correlationId: 1 });
            await this.collections.telemetry.createIndex({ tenantId: 1 });
            await this.collections.telemetry.createIndex({ name: 1 });
            await this.collections.telemetry.createIndex({ agentName: 1 });
            await this.collections.telemetry.createIndex({ toolName: 1 });
            await this.collections.telemetry.createIndex({ phase: 1 });

            // Errors indexes
            await this.collections.errors.createIndex({ timestamp: 1 });
            await this.collections.errors.createIndex({ correlationId: 1 });
            await this.collections.errors.createIndex({ tenantId: 1 });
            await this.collections.errors.createIndex({ errorName: 1 });

            this.logger.info('Performance indexes created successfully');
        } catch (error) {
            this.logger.warn(
                'Failed to create performance indexes, continuing without indexes',
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                },
            );
            // Não falhar a inicialização por causa dos índices
        }
    }

    /**
     * Configurar TTL para limpeza automática
     */
    private async setupTTL(): Promise<void> {
        if (!this.collections) return;

        // Só criar TTL se ttlDays estiver configurado e for maior que 0
        if (!this.config.ttlDays || this.config.ttlDays <= 0) {
            this.logger.info('TTL not configured, skipping TTL setup');
            return;
        }

        const ttlSeconds = this.config.ttlDays * 24 * 60 * 60;

        try {
            const collections = [
                { name: 'logs', collection: this.collections.logs },
                { name: 'telemetry', collection: this.collections.telemetry },
                { name: 'errors', collection: this.collections.errors },
            ];

            for (const { name, collection } of collections) {
                try {
                    // Check if TTL index already exists
                    const existingIndexes = await collection
                        .listIndexes()
                        .toArray();
                    const ttlIndexExists = existingIndexes.some(
                        (index) =>
                            index.key.createdAt === 1 &&
                            index.expireAfterSeconds,
                    );

                    if (!ttlIndexExists) {
                        // Try to drop existing non-TTL index if it exists
                        try {
                            await collection.dropIndex('createdAt_1');
                            this.logger.info(
                                `Dropped existing createdAt index without TTL for ${name}`,
                            );
                        } catch {
                            // Index doesn't exist or can't be dropped, continue
                            this.logger.debug(
                                `Could not drop existing createdAt index for ${name}, continuing`,
                            );
                        }

                        // Create TTL index
                        await collection.createIndex(
                            { createdAt: 1 },
                            {
                                expireAfterSeconds: ttlSeconds,
                                background: true,
                            },
                        );
                        this.logger.info(
                            `Created TTL index for ${name} collection`,
                        );
                    } else {
                        this.logger.debug(
                            `TTL index already exists for ${name} collection`,
                        );
                    }
                } catch (collectionError) {
                    this.logger.warn(
                        `Failed to setup TTL for ${name} collection`,
                        { error: (collectionError as Error).message },
                    );
                }
            }
        } catch (error) {
            this.logger.warn(
                'Failed to create TTL indexes, continuing without TTL',
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    ttlDays: this.config.ttlDays,
                },
            );
            // Não falhar a inicialização por causa do TTL
        }
    }

    /**
     * Iniciar timers de flush
     */
    private startFlushTimers(): void {
        this.logFlushTimer = setInterval(
            () => this.flushLogs(),
            this.config.flushIntervalMs,
        );

        this.telemetryFlushTimer = setInterval(
            () => this.flushTelemetry(),
            this.config.flushIntervalMs,
        );

        this.errorFlushTimer = setInterval(
            () => this.flushErrors(),
            this.config.flushIntervalMs,
        );
    }

    /**
     * Exportar log
     */
    exportLog(
        level: 'debug' | 'info' | 'warn' | 'error',
        message: string,
        component: string,
        context?: LogContext,
        error?: Error,
    ): void {
        if (!this.isInitialized) return;

        const logItem: MongoDBLogItem = {
            timestamp: new Date(),
            level,
            message,
            component,
            correlationId: context?.correlationId as string | undefined,
            tenantId: context?.tenantId as string | undefined,
            executionId: context?.executionId as string | undefined,
            sessionId: context?.sessionId as string | undefined, // ✅ NEW: Extract sessionId from context
            metadata: context,
            error: error
                ? {
                      name: error.name,
                      message: error.message,
                      stack: error.stack,
                  }
                : undefined,
            createdAt: new Date(),
        };

        this.logBuffer.push(logItem);

        // Flush se buffer cheio
        if (this.logBuffer.length >= this.config.batchSize) {
            void this.flushLogs();
        }
    }

    process(
        level: LogLevel,
        message: string,
        context?: LogContext,
        error?: Error,
    ): void {
        const component = String(context?.component || 'unknown');

        this.exportLog(level, message, component, context, error);
    }

    exportTelemetry(item: TraceItem): void {
        if (!this.isInitialized) {
            return;
        }

        const duration = item.endTime - item.startTime;

        // Extract values from attributes using OpenTelemetry semantic conventions
        // correlationId, sessionId, tenantId, executionId are now stored as span attributes
        const correlationId = item.attributes['correlationId'] as string;
        const tenantId =
            (item.attributes['agent.tenant.id'] as string) ||
            (item.attributes['tenant.id'] as string);
        const executionId =
            (item.attributes['agent.execution.id'] as string) ||
            (item.attributes['execution.id'] as string);
        const sessionId =
            (item.attributes['agent.conversation.id'] as string) ||
            (item.attributes['conversation.id'] as string);
        const agentName = item.attributes['agent.name'] as string;
        const toolName = item.attributes['tool.name'] as string;
        const phase = item.attributes['agent.phase'] as
            | 'think'
            | 'act'
            | 'observe';

        const telemetryItem: MongoDBTelemetryItem = {
            timestamp: new Date(item.startTime),
            name: item.name,
            duration,
            correlationId,
            tenantId,
            executionId, // ✅ Now properly extracted from trace attributes
            sessionId, // ✅ Link to session for proper hierarchy
            agentName,
            toolName,
            phase,
            attributes: item.attributes,
            status: 'ok', // Assumir OK por padrão
            error: undefined, // Não disponível no TraceItem
            createdAt: new Date(),
        };

        this.telemetryBuffer.push(telemetryItem);

        // Flush se buffer cheio
        if (this.telemetryBuffer.length >= this.config.batchSize) {
            void this.flushTelemetry();
        }
    }

    /**
     * Exportar erro
     */
    exportError(
        error: Error,
        context?: {
            correlationId?: string;
            tenantId?: string;
            executionId?: string;
            [key: string]: unknown;
        },
    ): void {
        if (!this.isInitialized) return;

        const errorItem: MongoDBErrorItem = {
            timestamp: new Date(),
            correlationId: context?.correlationId,
            tenantId: context?.tenantId,
            executionId: context?.executionId,
            sessionId: context?.sessionId as string | undefined, // ✅ NEW: Extract sessionId from context
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack,
            context: context || {},
            createdAt: new Date(),
        };

        this.errorBuffer.push(errorItem);

        // Flush se buffer cheio
        if (this.errorBuffer.length >= this.config.batchSize) {
            void this.flushErrors();
        }
    }

    /**
     * Flush logs para MongoDB
     */
    private async flushLogs(): Promise<void> {
        if (!this.collections || this.logBuffer.length === 0) return;

        const logsToFlush = [...this.logBuffer];
        this.logBuffer = [];

        try {
            await this.collections.logs.insertMany(logsToFlush);

            if (this.config.enableObservability) {
                this.logger.debug('Logs flushed to MongoDB', {
                    count: logsToFlush.length,
                    collection: this.config.collections.logs,
                });
            }
        } catch (error) {
            this.logger.error(
                'Failed to flush logs to MongoDB',
                error as Error,
            );
            // Re-add to buffer for retry
            this.logBuffer.unshift(...logsToFlush);
        }
    }

    /**
     * Flush telemetry para MongoDB
     */
    private async flushTelemetry(): Promise<void> {
        if (!this.collections || this.telemetryBuffer.length === 0) return;

        const telemetryToFlush = [...this.telemetryBuffer];
        this.telemetryBuffer = [];

        try {
            await this.collections.telemetry.insertMany(telemetryToFlush);

            if (this.config.enableObservability) {
                this.logger.debug('Telemetry flushed to MongoDB', {
                    count: telemetryToFlush.length,
                    collection: this.config.collections.telemetry,
                });
            }
        } catch (error) {
            this.logger.error(
                'Failed to flush telemetry to MongoDB',
                error as Error,
            );
            // Re-add to buffer for retry
            this.telemetryBuffer.unshift(...telemetryToFlush);
        }
    }

    /**
     * Flush erros para MongoDB
     */
    private async flushErrors(): Promise<void> {
        if (!this.collections || this.errorBuffer.length === 0) return;

        const errorsToFlush = [...this.errorBuffer];
        this.errorBuffer = [];

        try {
            await this.collections.errors.insertMany(errorsToFlush);

            if (this.config.enableObservability) {
                this.logger.debug('Errors flushed to MongoDB', {
                    count: errorsToFlush.length,
                    collection: this.config.collections.errors,
                });
            }
        } catch (error) {
            this.logger.error(
                'Failed to flush errors to MongoDB',
                error as Error,
            );
            // Re-add to buffer for retry
            this.errorBuffer.unshift(...errorsToFlush);
        }
    }

    /**
     * Flush todos os buffers
     */
    async flush(): Promise<void> {
        await Promise.allSettled([
            this.flushLogs(),
            this.flushTelemetry(),
            this.flushErrors(),
        ]);
    }

    /**
     * Dispose do exporter
     */
    async dispose(): Promise<void> {
        // Parar timers
        if (this.logFlushTimer) clearInterval(this.logFlushTimer);
        if (this.telemetryFlushTimer) clearInterval(this.telemetryFlushTimer);
        if (this.errorFlushTimer) clearInterval(this.errorFlushTimer);

        // Flush final
        await this.flush();

        // Fechar conexão
        if (this.client) {
            await this.client.close();
        }

        this.isInitialized = false;
        this.logger.info('MongoDB Exporter disposed');
    }
}

/**
 * Converter configuração de storage para MongoDB Exporter
 */
export function createMongoDBExporterFromStorage(
    storageConfig: ObservabilityStorageConfig,
): MongoDBExporter {
    const config: Partial<MongoDBExporterConfig> = {
        connectionString: storageConfig.connectionString,
        database: storageConfig.database,
        collections: {
            logs: storageConfig.collections?.logs || 'observability_logs',
            telemetry:
                storageConfig.collections?.telemetry ||
                'observability_telemetry',

            errors: storageConfig.collections?.errors || 'observability_errors',
        },
        batchSize: storageConfig.batchSize || 100,
        flushIntervalMs: storageConfig.flushIntervalMs || 5000,
        maxRetries: 3,
        ttlDays: storageConfig.ttlDays || 30,
        enableObservability: storageConfig.enableObservability ?? true,
    };

    return new MongoDBExporter(config);
}

/**
 * Factory para criar MongoDB Exporter
 */
export function createMongoDBExporter(
    config?: Partial<MongoDBExporterConfig>,
): MongoDBExporter {
    return new MongoDBExporter(config);
}

/**
 * MongoDB Metrics Exporter
 */
export class MongoDBMetricsExporter {
    private config: MongoDBExporterConfig;
    private logger: ReturnType<typeof createLogger>;
    private client: any = null;
    private db: any = null;
    private collection: any = null;
    private isInitialized = false;

    constructor(config: Partial<MongoDBExporterConfig> = {}) {
        this.config = {
            connectionString: 'mongodb://localhost:27017/kodus',
            database: 'kodus',
            collections: {
                logs: 'observability_logs',
                telemetry: 'observability_telemetry',
                errors: 'observability_errors',
            },
            batchSize: 25, // Menor batch para métricas (menos frequente)
            flushIntervalMs: 60000, // 1min para métricas (menos crítico)
            maxRetries: 5, // Mais tentativas para métricas
            ttlDays: 90, // Métricas mantidas por mais tempo
            enableObservability: false,
            ...config,
        };

        this.logger = createLogger('mongodb-metrics-exporter');
    }

    /**
     * Initialize MongoDB connection
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Dynamic import para evitar dependência obrigatória
            const { MongoClient: mongoClient } = await import('mongodb');

            this.client = new mongoClient(this.config.connectionString, {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
                socketTimeoutMS: 45000,
            });

            await this.client.connect();
            this.db = this.client.db(this.config.database);
            this.collection = this.db.collection('observability_metrics'); // Dedicated metrics collection

            // Create indexes for metrics with error handling
            try {
                // Check if TTL index already exists
                const existingIndexes = await this.collection
                    .listIndexes()
                    .toArray();
                const ttlIndexExists = existingIndexes.some(
                    (index) =>
                        index.key.timestamp === 1 && index.expireAfterSeconds,
                );

                if (!ttlIndexExists) {
                    // Try to drop existing non-TTL index if it exists
                    try {
                        await this.collection.dropIndex('timestamp_1');
                        this.logger.info(
                            'Dropped existing timestamp index without TTL',
                        );
                    } catch {
                        // Index doesn't exist or can't be dropped, continue
                        this.logger.debug(
                            'Could not drop existing index, continuing with TTL creation',
                        );
                    }

                    // Create TTL index
                    await this.collection.createIndex(
                        { timestamp: 1 },
                        {
                            expireAfterSeconds:
                                this.config.ttlDays * 24 * 60 * 60,
                            background: true, // Create in background to avoid blocking
                        },
                    );
                    this.logger.info(
                        'Created TTL index for metrics collection',
                    );
                } else {
                    this.logger.debug(
                        'TTL index already exists for metrics collection',
                    );
                }

                // Create other indexes if they don't exist
                const indexesToCreate = [
                    { key: { metricName: 1 }, name: 'metricName_1' },
                    { key: { tenantId: 1 }, name: 'tenantId_1' },
                ];

                for (const indexSpec of indexesToCreate) {
                    const indexExists = existingIndexes.some(
                        (index) =>
                            JSON.stringify(index.key) ===
                            JSON.stringify(indexSpec.key),
                    );

                    if (!indexExists) {
                        await this.collection.createIndex(indexSpec.key, {
                            name: indexSpec.name,
                            background: true,
                        });
                        this.logger.info(`Created index: ${indexSpec.name}`);
                    }
                }
            } catch (indexError) {
                this.logger.warn(
                    'Failed to create some indexes, continuing without them',
                    { error: (indexError as Error).message },
                );
                // Continue without indexes rather than failing initialization
            }

            this.isInitialized = true;

            this.logger.info('MongoDB Metrics Exporter initialized', {
                database: this.config.database,
                collection: 'observability_metrics',
            });
        } catch (error) {
            this.logger.error(
                'Failed to initialize MongoDB Metrics Exporter',
                error as Error,
            );
            throw error;
        }
    }

    /**
     * Export metrics to MongoDB
     */
    async exportMetrics(metrics: Record<string, any>): Promise<void> {
        if (!this.isInitialized || !this.collection) {
            this.logger.debug(
                'Metrics exporter not initialized, skipping export',
            );
            return;
        }

        try {
            const metricsItem: any = {
                timestamp: new Date(),
                correlationId: metrics.correlationId,
                tenantId: metrics.tenantId,
                executionId: metrics.executionId,
                metrics: metrics,
                createdAt: new Date(),
            };

            await this.collection.insertOne(metricsItem);

            if (this.config.enableObservability) {
                this.logger.debug('Metrics exported to MongoDB', {
                    collection: 'observability_metrics',
                });
            }
        } catch (error) {
            this.logger.error(
                'Failed to export metrics to MongoDB',
                error as Error,
            );
        }
    }

    /**
     * Flush metrics (for interface compatibility)
     */
    async flush(): Promise<void> {
        // Metrics are exported immediately, no batch processing needed
        this.logger.debug('Metrics flush called (no-op)');
    }

    /**
     * Shutdown the exporter
     */
    async shutdown(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.isInitialized = false;
            this.logger.info('MongoDB Metrics Exporter shutdown');
        }
    }
}

/**
 * Factory para criar MongoDB Metrics Exporter
 */
export function createMongoDBMetricsExporter(
    config?: Partial<MongoDBExporterConfig>,
): MongoDBMetricsExporter {
    return new MongoDBMetricsExporter(config);
}
