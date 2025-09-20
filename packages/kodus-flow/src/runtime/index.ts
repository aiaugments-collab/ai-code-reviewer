import { EventQueue } from './core/event-queue.js';
import { OptimizedEventProcessor } from './core/event-processor-optimized.js';
import { createPersistorFromConfig } from '../persistor/factory.js';
import { StreamManager } from './core/stream-manager.js';
import { MemoryMonitor } from './core/memory-monitor.js';
import { createEventStore, type EventStore } from './core/event-store.js';

import type { ObservabilitySystem } from '../observability/index.js';

export { EventStore, createEventStore } from './core/event-store.js';

import {
    AnyEvent,
    createEvent,
    EmitOptions,
    EmitResult,
    EventHandler,
    EventPayloads,
    EventType,
    Runtime,
    RuntimeConfig,
    TEvent,
    WorkflowContext,
} from '../core/types/allTypes.js';

export { OptimizedEventProcessor } from './core/event-processor-optimized.js';

export { StreamManager } from './core/stream-manager.js';
export { MemoryMonitor } from './core/memory-monitor.js';

export function createRuntime(
    context: WorkflowContext,
    observability: ObservabilitySystem,
    config: RuntimeConfig = {},
): Runtime {
    const {
        queueSize = 1000,
        batchSize = 50,
        enableObservability = true,
        maxEventDepth = 50,
        maxEventChainLength = 500,
        cleanupInterval = 60 * 1000,
        staleThreshold = 5 * 60 * 1000,
        middleware = [],
        memoryMonitor,
        enableAcks = false,
        ackTimeout = 180000,
        tenantId,
        persistor,
        executionId,
        queueConfig = {},
        enableEventStore = false,
        eventStoreConfig = {},
        batching = {},
    } = config;

    // Create persistor if not provided
    const runtimePersistor =
        persistor ||
        createPersistorFromConfig({
            type: 'memory',
            maxSnapshots: 1000,
            enableCompression: true,
            enableDeltaCompression: true,
            cleanupInterval: 300000,
            maxMemoryUsage: 100 * 1024 * 1024,
        });
    const runtimeExecutionId =
        executionId ||
        `runtime_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    // Event Store - Optional for replay capability
    let eventStore: EventStore | undefined;
    if (enableEventStore) {
        eventStore = createEventStore(observability, {
            executionId: runtimeExecutionId,
            enableReplay: true,
            persistorType: eventStoreConfig.persistorType || 'memory',
            persistorOptions: eventStoreConfig.persistorOptions,
            replayBatchSize: eventStoreConfig.replayBatchSize || 100,
            maxStoredEvents: eventStoreConfig.maxStoredEvents || 10000,
            enableObservability,
        });
    }

    // Event Queue - Single unified queue with simplified configuration
    const eventQueue = new EventQueue(observability, {
        // Basic settings
        maxQueueDepth: queueSize,
        enableObservability,
        batchSize,

        enableGlobalConcurrency: true,

        // Persistence (enabled by default with in-memory persistor)
        enablePersistence: !!persistor,
        persistor: runtimePersistor,
        executionId: runtimeExecutionId,
        persistCriticalEvents: true,
        criticalEventPrefixes: ['agent.', 'workflow.', 'kernel.'],

        // Retry settings removed from EventQueue (handled externally if needed)

        // Event Store integration
        enableEventStore,
        eventStore,

        // Override with any specific queue config provided (incl. maxProcessedEvents if needed)
        ...queueConfig,
    });

    // Note: Schema validation will be applied at emit level, not in EventProcessor middleware
    // This is because EventProcessor uses Middleware (handler transformer) pattern
    // while Schema validation uses MiddlewareFunction (context/next) pattern

    // Event Processor with middleware
    const eventProcessor = new OptimizedEventProcessor(context, observability, {
        maxEventDepth,
        maxEventChainLength,
        enableObservability,
        batchSize,
        cleanupInterval,
        staleThreshold,
        middleware,
    });

    // Stream Manager
    const streamManager = new StreamManager();

    // Memory Monitor
    const memoryMonitorInstance = new MemoryMonitor(
        observability,
        memoryMonitor,
    );
    // Start memory monitor unless explicitly disabled
    if (memoryMonitor?.enabled !== false) {
        memoryMonitorInstance.start();
    }

    // ACK tracking para delivery guarantees (SEM RETRY)
    const pendingAcks = new Map<
        string,
        { event: AnyEvent; timestamp: number }
    >();

    // Batching configuration - simplified
    const batchingConfig = {
        enabled: batching.enabled ?? false,
        defaultBatchSize: batching.defaultBatchSize ?? 10,
        defaultBatchTimeout: batching.defaultBatchTimeout ?? 200,
        maxBatchSize: batching.maxBatchSize ?? 100,
        flushOnEventTypes: batching.flushOnEventTypes ?? [],
    };

    // Batch queue for buffering events
    const batchQueue: Array<{ event: AnyEvent; priority: number }> = [];
    let batchTimer: NodeJS.Timeout | null = null;

    // Function to flush the batch
    const flushBatch = async (): Promise<void> => {
        if (batchQueue.length === 0) return;

        // Clear timer
        if (batchTimer) {
            clearTimeout(batchTimer);
            batchTimer = null;
        }

        // Copy and clear the batch
        const eventsToProcess = [...batchQueue];
        batchQueue.length = 0;

        // Enqueue all batched events
        const errors: Error[] = [];
        for (const { event, priority } of eventsToProcess) {
            try {
                await eventQueue.enqueue(event, priority);
            } catch (error) {
                const err = error as Error;
                errors.push(err);
                if (enableObservability) {
                    observability.log(
                        'error',
                        'Failed to enqueue batched event',
                        {
                            error: err.message,
                            eventType: event.type,
                            eventId: event.id,
                        },
                    );
                }
            }
        }

        if (errors.length > 0) {
            // Consider using AggregateError if the environment supports it.
            throw new Error(
                `Failed to enqueue ${errors.length} batched events. First error: ${errors[0]?.message}`,
            );
        }

        if (enableObservability) {
            observability.log('debug', 'Batch flushed', {
                eventCount: eventsToProcess.length,
            });
        }
    };

    // Function to add event to batch
    const addToBatch = (
        event: AnyEvent,
        priority: number,
        options: EmitOptions,
    ) => {
        batchQueue.push({ event, priority });

        // Check if we should flush immediately
        const shouldFlushImmediately =
            options.flushBatch ||
            batchingConfig.flushOnEventTypes.includes(event.type) ||
            batchQueue.length >=
                (options.batchSize || batchingConfig.defaultBatchSize);

        if (shouldFlushImmediately) {
            // Fire-and-forget calls to flushBatch need error handling
            flushBatch().catch((error) => {
                if (enableObservability) {
                    observability.log(
                        'error',
                        'Failed to flush batch during addToBatch',
                        {
                            error: (error as Error).message,
                            eventType: event.type,
                            eventId: event.id,
                        },
                    );
                }
            });
        } else if (!batchTimer) {
            // Set timer for batch timeout
            const timeout =
                options.batchTimeout || batchingConfig.defaultBatchTimeout;
            batchTimer = setTimeout(() => {
                // Fire-and-forget calls to flushBatch need error handling
                flushBatch().catch((error) => {
                    if (enableObservability) {
                        observability.log(
                            'error',
                            'Failed to flush batch during timeout',
                            {
                                error: (error as Error).message,
                            },
                        );
                    }
                });
            }, timeout);
        }
    };

    // Cleanup de ACKs expirados (SEM RETRY AUTOMÁTICO)
    const ackSweepIntervalMs = Math.max(
        100,
        Math.min(3000, Math.floor(ackTimeout / 10)),
    );
    const ackCleanupInterval = setInterval(async () => {
        const now = Date.now();
        for (const [eventId, ackInfo] of pendingAcks.entries()) {
            if (now - ackInfo.timestamp > ackTimeout) {
                // ✅ SIMPLIFICADO: Apenas log e cleanup, SEM retry automático
                pendingAcks.delete(eventId);
                observability.log(
                    'warn',
                    'ACK timeout: event expired without acknowledgment',
                    {
                        eventId,
                        eventType: ackInfo.event.type,
                        correlationId: ackInfo.event.metadata?.correlationId,
                        tenantId: ackInfo.event.metadata?.tenantId,
                        ageMs: now - ackInfo.timestamp,
                    },
                );
            }
        }
    }, ackSweepIntervalMs);

    return {
        // Event handling
        on(eventType: EventType, handler: EventHandler<AnyEvent>) {
            eventProcessor.registerHandler(eventType, handler);
        },

        emit<T extends EventType>(
            eventType: T,
            data?: EventPayloads[T],
            options: EmitOptions = {},
        ): EmitResult {
            const event = createEvent(eventType, data);
            const correlationId =
                options.correlationId || `corr_${Date.now()}_${Math.random()}`;

            // Adicionar metadados de delivery
            if (enableAcks) {
                event.metadata = {
                    ...event.metadata,
                    correlationId,
                    tenantId: options.tenantId || tenantId,
                    timestamp: Date.now(),
                };

                // Track para ACK (SEM RETRY)
                pendingAcks.set(event.id, {
                    event,
                    timestamp: Date.now(),
                });
                observability.log('debug', 'ACK tracking started', {
                    eventId: event.id,
                    eventType: event.type,
                    correlationId,
                    tenantId: event.metadata?.tenantId,
                });
            }

            // Check if batching is enabled
            const useBatching = batchingConfig.enabled || options.batch;

            if (useBatching) {
                // Add to batch queue
                addToBatch(event, options.priority || 0, options);
            } else {
                // Enfileirar de forma não-bloqueante
                eventQueue
                    .enqueue(event, options.priority || 0)
                    .catch((error) => {
                        if (enableObservability) {
                            observability.log(
                                'error',
                                'Failed to enqueue event',
                                {
                                    error: (error as Error).message,
                                    eventType,
                                    data,
                                    correlationId,
                                },
                            );
                        }
                    });
            }

            return {
                success: true,
                eventId: event.id,
                queued: true,
                correlationId,
            };
        },

        async emitAsync<T extends EventType>(
            eventType: T,
            data?: EventPayloads[T],
            options: EmitOptions = {},
        ): Promise<EmitResult> {
            const event = createEvent(eventType, data); // event.metadata might already have correlationId from 'data'

            // Determine the final correlationId, prioritizing options, then existing metadata, then new generation
            const finalCorrelationId =
                options.correlationId ||
                event.metadata?.correlationId || // Check if createEvent already put one from 'data'
                `corr_${Date.now()}_${Math.random()}`;

            try {
                // Adicionar metadados de delivery
                if (enableAcks) {
                    event.metadata = {
                        ...event.metadata, // Preserve existing metadata from createEvent
                        correlationId: finalCorrelationId, // Use the determined final correlationId
                        tenantId: options.tenantId || tenantId,
                        timestamp: Date.now(),
                    };

                    // Track para ACK (SEM RETRY)
                    pendingAcks.set(event.id, {
                        event,
                        timestamp: Date.now(),
                    });
                    observability.log('debug', 'ACK tracking started', {
                        eventId: event.id,
                        eventType: event.type,
                        correlationId: finalCorrelationId,
                        tenantId: event.metadata?.tenantId,
                    });
                }

                // Check if batching is enabled
                const useBatching = batchingConfig.enabled || options.batch;

                if (useBatching) {
                    // Add to batch queue
                    addToBatch(event, options.priority || 0, options);

                    // If flushBatch is requested, wait for flush
                    if (options.flushBatch) {
                        try {
                            await flushBatch();
                        } catch (error) {
                            if (enableObservability) {
                                observability.log(
                                    'error',
                                    'Failed to flush batch during emit',
                                    {
                                        error: (error as Error).message,
                                        eventType,
                                        eventId: event.id,
                                        correlationId: finalCorrelationId,
                                    },
                                );
                            }

                            return {
                                success: false,
                                eventId: event.id,
                                queued: false,
                                error: error as Error,
                                correlationId: finalCorrelationId,
                            };
                        }
                    }

                    return {
                        success: true,
                        eventId: event.id,
                        queued: true,
                        correlationId: finalCorrelationId,
                    };
                } else {
                    const queued = await eventQueue.enqueue(
                        event,
                        options.priority || 0,
                    );

                    return {
                        success: queued,
                        eventId: event.id,
                        queued,
                        correlationId: finalCorrelationId,
                    };
                }
            } catch (error) {
                if (enableObservability) {
                    observability.log('error', 'Failed to enqueue event', {
                        error: (error as Error).message,
                        eventType,
                        data,
                        correlationId: finalCorrelationId,
                    });
                }

                return {
                    success: false,
                    eventId: event.id,
                    queued: false,
                    error: error as Error,
                    correlationId: finalCorrelationId,
                };
            }
        },

        off(eventType: EventType, handler: EventHandler<AnyEvent>) {
            // LIMITATION: OptimizedEventProcessor não suporta remoção de handlers específicos
            // Por enquanto, apenas logamos um warning
            if (enableObservability) {
                observability.log(
                    'warn',
                    'off() method limitation: cannot remove specific handler, use clearHandlers() instead',
                    {
                        eventType,
                        handlerName: handler.name || 'anonymous',
                    },
                );
            }

            // Para remover TODOS os handlers, descomente a linha abaixo:
            // eventProcessor.clearHandlers();
        },

        async process(withStats: boolean = false): Promise<void | {
            processed: number;
            acked: number;
            failed: number;
        }> {
            if (!withStats) {
                // Modo simples - sem estatísticas
                observability.log('info', '⚡ RUNTIME PROCESSING EVENTS', {
                    mode: 'simple',
                    trace: {
                        source: 'runtime',
                        step: 'process-start',
                        timestamp: Date.now(),
                    },
                });

                await eventQueue.processAll(async (event) => {
                    observability.log(
                        'debug',
                        '💬 RUNTIME - Processing event',
                        {
                            eventType: event.type,
                            eventId: event.id,
                            trace: {
                                source: 'runtime',
                                step: 'process-event',
                                timestamp: Date.now(),
                            },
                        },
                    );

                    try {
                        await eventProcessor.processEvent(event);

                        // Auto-ACK when delivery guarantees are enabled
                        if (enableAcks && event.metadata?.correlationId) {
                            await this.ack(event.id);
                        }
                    } catch (error) {
                        // Mirror stats-enabled path: NACK on failure (so retries follow policy)
                        if (enableAcks && event.metadata?.correlationId) {
                            await this.nack(event.id, error as Error);
                        }
                        throw error; // preserve queue error accounting
                    }
                });

                observability.log('info', '✅ RUNTIME EVENTS PROCESSED', {
                    mode: 'simple',
                    trace: {
                        source: 'runtime',
                        step: 'process-complete',
                        timestamp: Date.now(),
                    },
                });
                return;
            }

            // Modo com estatísticas
            let processed = 0;
            let acked = 0;
            let failed = 0;

            observability.log(
                'info',
                '⚡ RUNTIME PROCESSING EVENTS WITH STATS',
                {
                    mode: 'with-stats',
                    trace: {
                        source: 'runtime',
                        step: 'process-with-stats-start',
                        timestamp: Date.now(),
                    },
                },
            );

            await eventQueue.processAll(async (event) => {
                try {
                    observability.log(
                        'debug',
                        '💬 RUNTIME - Processing event with stats',
                        {
                            eventType: event.type,
                            eventId: event.id,
                            hasCorrelationId: !!event.metadata?.correlationId,
                            enableAcks,
                            trace: {
                                source: 'runtime',
                                step: 'process-event-with-stats',
                                timestamp: Date.now(),
                            },
                        },
                    );

                    await eventProcessor.processEvent(event);
                    processed++;

                    // ✅ REFACTOR: ACK automático sempre que habilitado
                    if (enableAcks && event.metadata?.correlationId) {
                        await this.ack(event.id);
                        acked++;
                    }
                } catch (error) {
                    failed++;
                    observability.log(
                        'error',
                        '❌ RUNTIME - Event processing failed',
                        {
                            error: (error as Error).message,
                            eventType: event.type,
                            eventId: event.id,
                            enableAcks,
                            trace: {
                                source: 'runtime',
                                step: 'process-event-error',
                                timestamp: Date.now(),
                            },
                        },
                    );

                    // ✅ REFACTOR: NACK automático sempre que habilitado
                    if (enableAcks && event.metadata?.correlationId) {
                        await this.nack(event.id, error as Error);
                    }
                    throw error;
                }
            });

            observability.log(
                'info',
                '✅ RUNTIME EVENTS PROCESSED WITH STATS',
                {
                    mode: 'with-stats',
                    processed,
                    acked,
                    failed,
                    trace: {
                        source: 'runtime',
                        step: 'process-with-stats-complete',
                        timestamp: Date.now(),
                    },
                },
            );

            return { processed, acked, failed };
        },

        async ack(eventId: string): Promise<void> {
            const ackInfo = pendingAcks.get(eventId);
            if (ackInfo) {
                pendingAcks.delete(eventId);
                // Mark event as processed in EventStore if available
                if (eventStore) {
                    try {
                        await eventStore.markEventsProcessed([eventId]);
                    } catch (err) {
                        if (enableObservability) {
                            observability.log(
                                'error',
                                'Failed to mark event as processed in EventStore',
                                {
                                    error: (err as Error).message,
                                    eventId,
                                },
                            );
                        }
                    }
                }
                if (enableObservability) {
                    observability.log(
                        'debug',
                        '✅ RUNTIME - Event acknowledged (ACK)',
                        {
                            eventId,
                            eventType: ackInfo.event.type,
                            pendingAcksCount: pendingAcks.size,
                            trace: {
                                source: 'runtime',
                                step: 'ack-event',
                                timestamp: Date.now(),
                            },
                        },
                    );
                }
            } else {
                if (enableObservability) {
                    observability.log(
                        'warn',
                        '⚠️ RUNTIME - ACK for unknown event',
                        {
                            eventId,
                            pendingAcksCount: pendingAcks.size,
                            trace: {
                                source: 'runtime',
                                step: 'ack-unknown-event',
                                timestamp: Date.now(),
                            },
                        },
                    );
                }
            }
        },

        async nack(eventId: string, error?: Error): Promise<void> {
            const ackInfo = pendingAcks.get(eventId);
            if (ackInfo) {
                // ✅ SIMPLIFICADO: Apenas cleanup, SEM retry automático
                pendingAcks.delete(eventId);
                if (enableObservability) {
                    observability.log(
                        'warn',
                        '❌ RUNTIME - Event NACK (no retry)',
                        {
                            eventId,
                            eventType: ackInfo.event.type,
                            error: error?.message,
                            pendingAcksCount: pendingAcks.size,
                            trace: {
                                source: 'runtime',
                                step: 'nack-no-retry',
                                timestamp: Date.now(),
                            },
                        },
                    );
                }
            } else {
                if (enableObservability) {
                    observability.log(
                        'warn',
                        '⚠️ RUNTIME - NACK for unknown event',
                        {
                            eventId,
                            error: error?.message,
                            pendingAcksCount: pendingAcks.size,
                            trace: {
                                source: 'runtime',
                                step: 'nack-unknown-event',
                                timestamp: Date.now(),
                            },
                        },
                    );
                }
            }
        },

        // Event factory
        createEvent<T extends EventType>(
            type: T,
            data?: EventPayloads[T],
        ): TEvent<T> {
            return createEvent(type, data);
        },

        // Stream processing
        createStream: (generator) => streamManager.createStream(generator),

        // Multi-tenant
        forTenant(tenantId: string): Runtime {
            // Evitar recursão infinita criando config isolado
            const tenantConfig: RuntimeConfig = {
                queueSize,
                batchSize,
                enableObservability,
                maxEventDepth,
                maxEventChainLength,
                cleanupInterval,
                staleThreshold,
                middleware,
                memoryMonitor,
                enableAcks,
                ackTimeout,
                tenantId, // Novo tenant ID
                // Criar novo persistor para isolamento
                persistor: undefined,
                executionId: `tenant_${tenantId}_${Date.now()}`,
            };

            return createRuntime(context, observability, tenantConfig);
        },

        // Statistics
        getStats: () => {
            return {
                queue: eventQueue.getStats(),
                processor: eventProcessor.getStats(),
                stream: streamManager.getStats(),
                memory: memoryMonitorInstance.getStats(),
                delivery: {
                    pendingAcks: pendingAcks.size,
                    enableAcks,
                    ackTimeout,
                },
                runtime: {
                    executionId: runtimeExecutionId,
                    persistorType: runtimePersistor?.constructor.name || 'none',
                    tenantId: tenantId || 'default',
                },
            };
        },

        // Recent events processed by the event processor (observability)
        getRecentEvents: (limit: number = 50) => {
            try {
                return eventProcessor.getRecentEvents(limit);
            } catch (err) {
                if (enableObservability) {
                    observability.log(
                        'error',
                        'Failed to get recent events snapshot',
                        {
                            error: (err as Error).message,
                        },
                    );
                }
                return [];
            }
        },

        // Enhanced queue access (unified EventQueue now)
        getEnhancedQueue: () => {
            return eventQueue;
        },

        // Queue snapshot for observability/debugging
        getQueueSnapshot: (limit: number = 50) => {
            try {
                return eventQueue.getQueueSnapshot(limit);
            } catch (err) {
                if (enableObservability) {
                    observability.log('error', 'Failed to get queue snapshot', {
                        error: (err as Error).message,
                    });
                }
                return [];
            }
        },

        // Event Store access
        getEventStore: () => {
            return eventStore || null;
        },

        // Event replay functionality
        replayEvents: async function* (
            fromTimestamp: number,
            options?: {
                toTimestamp?: number;
                onlyUnprocessed?: boolean;
                batchSize?: number;
            },
        ) {
            yield* eventQueue.replayEvents(fromTimestamp, options);
        },

        // reprocessFromDLQ: async (eventId: string) => {
        //     // DLQ functionality will be implemented later
        //     return false;
        // },

        // reprocessDLQByCriteria: async (criteria: {
        //     maxAge?: number;
        //     limit?: number;
        //     eventType?: string;
        // }) => {
        //     // DLQ functionality will be implemented later
        //     return { reprocessedCount: 0, events: [] };
        // },

        // Cleanup
        clear: () => {
            eventQueue.clear();
            eventProcessor.clearHandlers();
            pendingAcks.clear();
        },

        cleanup: async () => {
            // Flush any pending batched events
            if (batchQueue.length > 0) {
                try {
                    await flushBatch();
                } catch (error) {
                    if (enableObservability) {
                        observability.log(
                            'error',
                            'Failed to flush batch during cleanup',
                            {
                                error: (error as Error).message,
                            },
                        );
                    }
                    // Continue with cleanup even if batch flush fails
                }
            }

            // Clear batch timer
            if (batchTimer) {
                clearTimeout(batchTimer);
                batchTimer = null;
            }

            clearInterval(ackCleanupInterval);
            memoryMonitorInstance.stop();
            await Promise.all([
                eventProcessor.cleanup(),
                streamManager.cleanup(),
            ]);
            // Ensure queue resources are released
            eventQueue.destroy();
        },
    };
}
