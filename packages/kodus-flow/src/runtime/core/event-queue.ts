import * as os from 'os';
import type { ObservabilitySystem } from '../../observability/index.js';
import {
    AnyEvent,
    EventQueueConfig,
    Persistor,
    QueueItem,
    QueueItemSnapshot,
} from '../../core/types/allTypes.js';
import { EventStore } from '../index.js';

/**
 * Semáforo para controle de concorrência
 */
class Semaphore {
    private permits: number;
    private waitQueue: Array<() => void> = [];

    constructor(permits: number) {
        this.permits = permits;
    }

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            this.waitQueue.push(resolve);
        });
    }

    release(): void {
        if (this.waitQueue.length > 0) {
            const resolve = this.waitQueue.shift()!;
            resolve();
        } else {
            this.permits++;
        }
    }

    getAvailablePermits(): number {
        return this.permits;
    }

    getWaitingCount(): number {
        return this.waitQueue.length;
    }
}

/**
 * Fila de eventos com backpressure adaptativo baseado em recursos
 */
export class EventQueue {
    private queue: QueueItem[] = [];
    private processing = false;

    // ✅ DEDUPLICATION: Track processed events to prevent duplicates
    private processedEvents = new Set<string>();
    private readonly maxProcessedEvents: number; // Prevent memory leaks

    // Configuração baseada em recursos
    private readonly maxMemoryUsage: number;
    private readonly maxCpuUsage: number;
    private readonly maxQueueDepth?: number;

    // Configuração de processamento
    private readonly enableObservability: boolean;
    private batchSize: number; // Agora adaptativo
    private maxConcurrent: number; // Agora adaptativo
    private semaphore: Semaphore;

    // Event Size Awareness
    private readonly largeEventThreshold: number;
    private readonly hugeEventThreshold: number;
    private readonly enableCompression: boolean;
    private readonly maxEventSize: number;
    private readonly dropHugeEvents: boolean;

    // Persistence features
    private readonly enablePersistence: boolean;
    private readonly persistor?: Persistor;
    private readonly executionId: string;
    private readonly persistCriticalEvents: boolean;
    private readonly persistAllEvents: boolean;
    private readonly criticalEventTypes: string[];
    private readonly criticalEventPrefixes: string[];

    // CPU tracking for real measurement
    private lastCpuInfo?: { idle: number; total: number; timestamp: number };
    private lastCpuUsage?: number;
    private lastBackpressureActive: boolean = false;

    // Event Store integration
    private readonly enableEventStore: boolean;
    private readonly eventStore?: EventStore;
    private readonly useGlobalConcurrency: boolean;

    constructor(
        private observability: ObservabilitySystem,
        config: EventQueueConfig = {},
    ) {
        // Configuração baseada em recursos
        this.maxMemoryUsage = config.maxMemoryUsage ?? 0.8; // 80% da memória
        this.maxCpuUsage = config.maxCpuUsage ?? 0.85; // 85% da CPU (aumentado para evitar falsos positivos)
        this.maxQueueDepth = config.maxQueueDepth; // Sem limite por padrão

        // Configuração de processamento
        this.enableObservability = config.enableObservability ?? true;
        this.batchSize = config.batchSize ?? 20; // Reduzido de 100 para 20
        this.maxConcurrent = config.maxConcurrent ?? 25; // Aumentado de 10 para 25
        this.semaphore = new Semaphore(this.maxConcurrent);

        // Auto-ajuste (ENABLED by default for better performance!)

        // Event Size Awareness
        this.largeEventThreshold = config.largeEventThreshold ?? 1024 * 1024;
        this.hugeEventThreshold = config.hugeEventThreshold ?? 10 * 1024 * 1024;
        this.enableCompression = config.enableCompression ?? true;
        this.maxEventSize = config.maxEventSize ?? 100 * 1024 * 1024;
        this.dropHugeEvents = config.dropHugeEvents ?? false;

        // Persistence features (from DurableEventQueue)
        this.enablePersistence = config.enablePersistence ?? false;
        this.persistor = config.persistor;
        this.executionId = config.executionId ?? `queue_${Date.now()}`;
        this.persistCriticalEvents = config.persistCriticalEvents ?? true;
        this.persistAllEvents = config.persistAllEvents ?? false;
        this.criticalEventTypes = config.criticalEventTypes ?? [];
        this.criticalEventPrefixes = config.criticalEventPrefixes ?? [
            'agent.',
            'workflow.',
        ];

        // Event Store integration
        this.enableEventStore = config.enableEventStore ?? false;
        this.eventStore = config.eventStore;

        // Global concurrency (semaphore) only when explicitly enabled (Runtime integration)
        this.useGlobalConcurrency = config.enableGlobalConcurrency ?? false;

        // Processed events capacity
        this.maxProcessedEvents = config.maxProcessedEvents ?? 1000; // ✅ REDUZIDO: 1k em vez de 10k para evitar memory leaks
    }

    /**
     * Obter métricas do sistema
     */
    private getSystemMetrics(): {
        timestamp: number;
        memoryUsage: number;
        cpuUsage: number;
        queueDepth: number;
        processingRate: number;
        averageProcessingTime: number;
    } {
        const memoryUsage = this.getMemoryUsage();
        const cpuUsage = this.getCpuUsage();

        return {
            timestamp: Date.now(),
            memoryUsage,
            cpuUsage,
            queueDepth: this.queue.length,
            processingRate: 0, // Removed auto-scaling
            averageProcessingTime: 0, // Removed auto-scaling
        };
    }

    /**
     * Obter uso de memória (0.0 - 1.0)
     */
    private getMemoryUsage(): number {
        try {
            const memUsage = process.memoryUsage();
            const totalMemory = os.totalmem();

            // Use RSS (Resident Set Size) dividido pela memória total do sistema
            // Isso dá uma medida real do uso de memória do processo
            return Math.min(memUsage.rss / totalMemory, 1.0);
        } catch {
            return 0.5; // Fallback
        }
    }

    /**
     * Obter uso de CPU real (0.0 - 1.0)
     */
    private getCpuUsage(): number {
        try {
            const cpus = os.cpus();
            if (!cpus || cpus.length === 0) {
                return 0.5; // Fallback if no CPU info
            }

            // Calculate average CPU usage across all cores
            let totalIdle = 0;
            let totalTick = 0;

            for (const cpu of cpus) {
                const times = cpu.times;
                totalIdle += times.idle;
                totalTick +=
                    times.user +
                    times.nice +
                    times.sys +
                    times.idle +
                    times.irq;
            }

            // Store previous values for delta calculation
            if (!this.lastCpuInfo) {
                this.lastCpuInfo = {
                    idle: totalIdle,
                    total: totalTick,
                    timestamp: Date.now(),
                };
                return 0.5; // First measurement, return average
            }

            // Calculate delta
            const deltaIdle = totalIdle - this.lastCpuInfo.idle;
            const deltaTotal = totalTick - this.lastCpuInfo.total;
            const deltaTime = Date.now() - this.lastCpuInfo.timestamp;

            // Update stored values
            this.lastCpuInfo = {
                idle: totalIdle,
                total: totalTick,
                timestamp: Date.now(),
            };

            // If not enough time passed, use previous value
            if (deltaTime < 100 || deltaTotal === 0) {
                return this.lastCpuUsage || 0.5;
            }

            // Calculate usage (1 - idle percentage)
            const usage = 1 - deltaIdle / deltaTotal;
            this.lastCpuUsage = Math.max(0, Math.min(1, usage));

            return this.lastCpuUsage;
        } catch (error) {
            if (this.enableObservability) {
                this.observability.log('debug', 'Failed to get CPU usage', {
                    error,
                });
            }
            return this.lastCpuUsage || 0.5; // Use last known value or fallback
        }
    }

    /**
     * Verificar se deve ativar backpressure baseado em recursos
     */
    private shouldActivateBackpressure(): boolean {
        const metrics = this.getSystemMetrics();
        const isActive =
            metrics.memoryUsage > this.maxMemoryUsage ||
            metrics.cpuUsage > this.maxCpuUsage ||
            (this.maxQueueDepth !== undefined
                ? metrics.queueDepth >= this.maxQueueDepth
                : false);

        // Cache state for lightweight stats reads
        this.lastBackpressureActive = isActive;

        if (this.enableObservability && isActive) {
            this.observability.log('warn', '⚠️ BACKPRESSURE ACTIVATED', {
                queueSize: this.queue.length,
                memoryUsage: `${(metrics.memoryUsage * 100).toFixed(1)}%`,
                cpuUsage: `${(metrics.cpuUsage * 100).toFixed(1)}%`,
                queueDepth: metrics.queueDepth,
                memoryThreshold: `${(this.maxMemoryUsage * 100).toFixed(1)}%`,
                cpuThreshold: `${(this.maxCpuUsage * 100).toFixed(1)}%`,
                queueThreshold: this.maxQueueDepth,
                processedEventsCount: this.processedEvents.size,
                trace: {
                    source: 'event-queue',
                    step: 'backpressure-activated',
                    timestamp: Date.now(),
                },
            });
        }

        return isActive;
    }

    /**
     * Calcular tamanho estimado do evento
     */
    private calculateEventSize(event: AnyEvent): number {
        try {
            return JSON.stringify(event).length;
        } catch {
            return 100; // Tamanho padrão se não conseguir serializar
        }
    }

    /**
     * Determine if event should be persisted
     */
    private shouldPersistEvent(event: AnyEvent): boolean {
        if (!this.enablePersistence) return false;

        // Persist all events if configured
        if (this.persistAllEvents) return true;

        // Persist critical events if configured
        if (this.persistCriticalEvents) {
            // Check by exact type
            if (this.criticalEventTypes.includes(event.type)) return true;

            // Check by prefix
            return this.criticalEventPrefixes.some((prefix) =>
                event.type.startsWith(prefix),
            );
        }

        return false;
    }

    private generateEventHash(event: AnyEvent): string {
        try {
            const content = JSON.stringify({
                id: event.id,
                type: event.type,
                data: event.data,
            });
            // Simple hash based on content
            let hash = 0;
            for (let i = 0; i < content.length; i++) {
                const char = content.charCodeAt(i);
                hash = (hash << 5) - hash + char;
                hash = hash & hash; // Convert to 32-bit integer
            }
            return hash.toString(16);
        } catch {
            return `hash_${event.id}_${Date.now()}`;
        }
    }

    /**
     * Verificar se evento é grande
     */
    private isLargeEvent(size: number): boolean {
        return size >= this.largeEventThreshold;
    }

    /**
     * Verificar se evento é enorme
     */
    private isHugeEvent(size: number): boolean {
        return size >= this.hugeEventThreshold;
    }

    /**
     * Comprimir evento se necessário
     */
    private async compressEvent(
        event: AnyEvent,
        size: number,
    ): Promise<{ event: AnyEvent; compressed: boolean; originalSize: number }> {
        if (!this.enableCompression || size < this.largeEventThreshold) {
            return { event, compressed: false, originalSize: size };
        }

        try {
            // Implementação básica de compressão (em produção usaria gzip/brotli)
            // Non-intrusive: marcar compressão em metadata em vez de mutar data
            const compressed = { ...event } as AnyEvent & {
                metadata: Record<string, unknown> | undefined;
            };
            compressed.metadata = {
                ...(event.metadata || {}),
                compressed: true,
                originalSize: size,
                compressedAt: Date.now(),
            };

            if (this.enableObservability) {
                this.observability.log('info', 'Event compressed', {
                    eventType: event.type,
                    originalSize: size,
                    compressedSize: JSON.stringify(compressed).length,
                    compressionRatio:
                        (
                            (JSON.stringify(compressed).length / size) *
                            100
                        ).toFixed(2) + '%',
                });
            }

            return { event: compressed, compressed: true, originalSize: size };
        } catch (error) {
            if (this.enableObservability) {
                this.observability.log('warn', 'Failed to compress event', {
                    eventType: event.type,
                    size,
                    error: (error as Error).message,
                });
            }
            return { event, compressed: false, originalSize: size };
        }
    }

    /**
     * Adicionar evento à fila com backpressure e Event Size Awareness
     */
    async enqueue(event: AnyEvent, priority: number = 0): Promise<boolean> {
        // Initial enqueue debug (reduced noise): rely on success log below

        // ✅ ADD: Log detalhado para detectar duplicação
        const isAlreadyProcessed = this.processedEvents.has(event.id);
        const isAlreadyInQueue = this.queue.some(
            (item) => item.event.id === event.id,
        );

        if (isAlreadyProcessed || isAlreadyInQueue) {
            if (this.enableObservability) {
                this.observability.log('warn', '🔄 DUAL EVENT', {
                    eventId: event.id,
                    eventType: event.type,
                    correlationId: event.metadata?.correlationId,
                    isAlreadyProcessed,
                    isAlreadyInQueue,
                    processedEventsCount: this.processedEvents.size,
                    queueSize: this.queue.length,
                });
            }
        }

        // Check if event is already processed (deduplication)
        if (isAlreadyProcessed) {
            if (this.enableObservability) {
                this.observability.log(
                    'warn',
                    '🔄 EVENT ALREADY PROCESSED - SKIPPING',
                    {
                        eventId: event.id,
                        eventType: event.type,
                        processedEventsCount: this.processedEvents.size,
                    },
                );
            }
            return false;
        }

        // Check if event is already in queue (deduplication)
        if (isAlreadyInQueue) {
            if (this.enableObservability) {
                this.observability.log(
                    'warn',
                    '🔄 EVENT ALREADY IN QUEUE - SKIPPING',
                    {
                        eventId: event.id,
                        eventType: event.type,
                        queueSize: this.queue.length,
                    },
                );
            }
            return false;
        }

        // Calculate event size
        const eventSize = this.calculateEventSize(event);
        const isLarge = this.isLargeEvent(eventSize);
        const isHuge = this.isHugeEvent(eventSize);

        // Verbose sizing log removed to reduce noise

        // Drop huge events if configured
        if (isHuge && this.dropHugeEvents) {
            if (this.enableObservability) {
                this.observability.log('warn', '🚫 HUGE EVENT DROPPED', {
                    eventId: event.id,
                    eventType: event.type,
                    eventSize,
                    hugeEventThreshold: this.hugeEventThreshold,
                    dropHugeEvents: this.dropHugeEvents,
                });
            }
            return false;
        }

        // Check queue depth limits
        if (
            this.maxQueueDepth !== undefined &&
            this.queue.length >= this.maxQueueDepth
        ) {
            if (this.enableObservability) {
                this.observability.log(
                    'warn',
                    '🚫 QUEUE FULL - EVENT DROPPED',
                    {
                        eventId: event.id,
                        eventType: event.type,
                        queueSize: this.queue.length,
                        maxQueueDepth: this.maxQueueDepth,
                    },
                );
            }
            return false;
        }

        // Check resource limits
        if (this.shouldActivateBackpressure()) {
            // Backpressure already logged when activated; do not duplicate here
        }

        // Compress event if needed
        let compressedEvent = event;
        let compressed = false;
        let originalSize = eventSize;

        if (this.enableCompression && isLarge) {
            const compressionResult = await this.compressEvent(
                event,
                eventSize,
            );
            compressedEvent = compressionResult.event;
            compressed = compressionResult.compressed;
            originalSize = compressionResult.originalSize;

            // Compression details are logged by compressEvent(); skip duplicate log
        }

        // Create queue item
        const queueItem: QueueItem = {
            event: compressedEvent,
            timestamp: Date.now(),
            priority,
            retryCount: 0,
            size: this.calculateEventSize(compressedEvent),
            isLarge,
            isHuge,
            compressed,
            originalSize,
        };

        // Persist event if needed
        if (this.enablePersistence && this.persistor) {
            const shouldPersist = this.shouldPersistEvent(event);
            if (shouldPersist) {
                try {
                    // Create snapshot for persistence
                    const snapshot = {
                        xcId: this.executionId,
                        ts: Date.now(),
                        events: [event],
                        state: { eventId: event.id, eventType: event.type },
                        hash: this.generateEventHash(event),
                    };
                    await this.persistor.append(snapshot);
                    queueItem.persistent = true;
                    queueItem.persistedAt = Date.now();

                    if (this.enableObservability) {
                        this.observability.log('info', '💾 EVENT PERSISTED', {
                            eventId: event.id,
                            eventType: event.type,
                            persistent: true,
                            persistedAt: queueItem.persistedAt,
                        });
                    }
                } catch (error) {
                    if (this.enableObservability) {
                        this.observability.log(
                            'error',
                            '❌ EVENT PERSISTENCE FAILED',
                            {
                                error: (error as Error).message,
                                eventId: event.id,
                                eventType: event.type,
                            },
                        );
                    }
                }
            } else {
                if (this.enableObservability) {
                    this.observability.log(
                        'debug',
                        '💾 EVENT NOT PERSISTED (not critical)',
                        {
                            eventId: event.id,
                            eventType: event.type,
                            shouldPersist,
                            persistCriticalEvents: this.persistCriticalEvents,
                            criticalEventTypes: this.criticalEventTypes,
                            criticalEventPrefixes: this.criticalEventPrefixes,
                        },
                    );
                }
            }
        }

        // Add to queue with priority
        // Inserir com prioridade (maior prioridade primeiro)
        const insertIndex = this.queue.findIndex(
            (qi) => qi.priority < priority,
        );
        if (insertIndex === -1) {
            this.queue.push(queueItem);
        } else {
            this.queue.splice(insertIndex, 0, queueItem);
        }

        // Success enqueue is logged via observability below

        if (this.enableObservability) {
            this.observability.log('info', '✅ EVENT ENQUEUED SUCCESSFULLY', {
                eventId: event.id,
                eventType: event.type,
                priority,
                newQueueSize: this.queue.length,
                processedEventsCount: this.processedEvents.size,
                correlationId: event.metadata?.correlationId,
                compressed,
                persistent: queueItem.persistent,
                insertIndex: insertIndex === -1 ? 'end' : insertIndex,
                trace: {
                    source: 'event-queue',
                    step: 'event-enqueued',
                    timestamp: Date.now(),
                },
            });
        }

        // Store in Event Store if enabled
        if (this.enableEventStore && this.eventStore) {
            try {
                await this.eventStore.appendEvents([event]);
                if (this.enableObservability) {
                    this.observability.log('info', '📚 EVENT STORED', {
                        eventId: event.id,
                        eventType: event.type,
                    });
                }
            } catch (error) {
                if (this.enableObservability) {
                    this.observability.log('error', '❌ EVENT STORE FAILED', {
                        error: (error as Error).message,
                        eventId: event.id,
                        eventType: event.type,
                    });
                }
            }
        }

        return true;
    }

    /**
     * Remover próximo item da fila (com metadata)
     */
    private dequeueItem(): QueueItem | undefined {
        const item = this.queue.shift();

        if (item && this.enableObservability) {
            this.observability.log('debug', '📤 EVENT DEQUEUED', {
                eventId: item.event.id,
                eventType: item.event.type,
                correlationId: item.event.metadata?.correlationId,
                priority: item.priority,
                remainingInQueue: this.queue.length,
                processedEventsCount: this.processedEvents.size,
                trace: {
                    source: 'event-queue',
                    step: 'event-dequeued',
                    timestamp: Date.now(),
                },
            });
        }

        return item;
    }

    /**
     * Remover próximo evento da fila (compatibilidade)
     * @deprecated Use dequeueItem() para preservar metadata
     */
    dequeue(): AnyEvent | null {
        const item = this.dequeueItem();
        return item ? item.event : null;
    }

    /**
     * Obter próximo evento sem remover
     */
    peek(): AnyEvent | null {
        const item = this.queue[0];
        return item ? item.event : null;
    }

    /**
     * Processar lote de eventos com backpressure
     */
    async processBatch(
        processor: (event: AnyEvent) => Promise<void>,
    ): Promise<number> {
        if (this.processing) {
            return 0;
        }

        this.processing = true;
        const batch: AnyEvent[] = [];

        // Coletar lote - processar todos os eventos disponíveis se for menor que batchSize
        const eventsToProcess = Math.min(
            this.batchSize || 10,
            this.queue.length,
        );
        for (let i = 0; i < eventsToProcess; i++) {
            const item = this.dequeueItem();
            if (item) {
                batch.push(item.event);
            }
        }

        if (batch.length === 0) {
            this.processing = false;
            return Promise.resolve(0);
        }

        // Processar lote com backpressure
        try {
            const count = await this.processBatchWithBackpressure(
                batch,
                processor,
            );
            return count;
        } finally {
            this.processing = false;
        }
    }

    /**
     * Processar lote com controle de concorrência
     */
    private async processBatchWithBackpressure(
        batch: AnyEvent[],
        processor: (event: AnyEvent) => Promise<void>,
    ): Promise<number> {
        let successCount = 0;
        let errorCount = 0;

        // Logged via observability right below

        if (this.enableObservability) {
            this.observability.log(
                'info',
                '🔧 PROCESSING BATCH WITH BACKPRESSURE',
                {
                    batchSize: batch.length,
                    backpressureActive: this.shouldActivateBackpressure(),
                    trace: {
                        source: 'event-queue',
                        step: 'process-batch-with-backpressure-start',
                        timestamp: Date.now(),
                    },
                },
            );
        }

        // Processar eventos em chunks para evitar bloqueio
        const chunkSize = this.shouldActivateBackpressure()
            ? 1
            : Math.min(5, batch.length);

        for (let i = 0; i < batch.length; i += chunkSize) {
            const chunk = batch.slice(i, i + chunkSize);

            // Logged via observability debug below

            if (this.enableObservability) {
                this.observability.log('debug', '📋 PROCESSING CHUNK', {
                    chunkIndex: Math.floor(i / chunkSize),
                    chunkSize: chunk.length,
                    totalChunks: Math.ceil(batch.length / chunkSize),
                    chunkEventTypes: chunk.map((e) => e.type),
                    chunkEventIds: chunk.map((e) => e.id),
                    trace: {
                        source: 'event-queue',
                        step: 'processing-chunk',
                        timestamp: Date.now(),
                    },
                });
            }

            // Preserve priority order within chunk
            const chunkPromises = chunk.map(async (event) => {
                try {
                    // ✅ ADD: Log detalhado para debug de duplicação
                    const isAlreadyProcessed = this.processedEvents.has(
                        event.id,
                    );
                    // Logged via observability debug below

                    if (this.enableObservability) {
                        this.observability.log(
                            'debug',
                            '🎯 PROCESSING INDIVIDUAL EVENT',
                            {
                                eventId: event.id,
                                eventType: event.type,
                                correlationId: event.metadata?.correlationId,
                                isAlreadyProcessed,
                                processedEventsCount: this.processedEvents.size,
                                queueSize: this.queue.length,
                                trace: {
                                    source: 'event-queue',
                                    step: 'processing-individual-event',
                                    timestamp: Date.now(),
                                },
                            },
                        );
                    }

                    if (this.useGlobalConcurrency) {
                        // concurrency control per event (global)
                        await this.semaphore.acquire();
                        try {
                            await processor(event);
                        } finally {
                            this.semaphore.release();
                        }
                    } else {
                        await processor(event);
                    }
                    successCount++;

                    // mark processed only after success (global, after handler)
                    this.processedEvents.add(event.id);
                    if (this.processedEvents.size > this.maxProcessedEvents) {
                        // ✅ MELHORADO: Cleanup mais agressivo - remover 20% dos eventos mais antigos
                        const eventsToRemove = Math.ceil(
                            this.maxProcessedEvents * 0.2,
                        );
                        const eventIds = Array.from(this.processedEvents).slice(
                            0,
                            eventsToRemove,
                        );
                        eventIds.forEach((id) =>
                            this.processedEvents.delete(id),
                        );

                        if (this.enableObservability) {
                            this.observability.log(
                                'debug',
                                '🧹 Cleaned up processed events',
                                {
                                    removedCount: eventsToRemove,
                                    remainingCount: this.processedEvents.size,
                                    maxProcessedEvents: this.maxProcessedEvents,
                                },
                            );
                        }
                    }

                    // Logged via observability debug below

                    if (this.enableObservability) {
                        this.observability.log(
                            'debug',
                            '✅ INDIVIDUAL EVENT PROCESSED SUCCESS',
                            {
                                eventId: event.id,
                                eventType: event.type,
                                correlationId: event.metadata?.correlationId,
                                successCount,
                                errorCount,
                                queueSize: this.queue.length,
                                processedEventsCount: this.processedEvents.size,
                                trace: {
                                    source: 'event-queue',
                                    step: 'individual-event-processed-success',
                                    batchSize: batch.length,
                                    chunkIndex: Math.floor(i / chunkSize),
                                },
                            },
                        );
                    }
                } catch (error) {
                    errorCount++;

                    // Logged via observability error below

                    if (this.enableObservability) {
                        this.observability.log(
                            'error',
                            '❌ INDIVIDUAL EVENT PROCESSED ERROR',
                            {
                                error: (error as Error).message,
                                eventId: event.id,
                                eventType: event.type,
                                successCount,
                                errorCount,
                                queueSize: this.queue.length,
                                processedEventsCount: this.processedEvents.size,
                                trace: {
                                    source: 'event-queue',
                                    step: 'individual-event-processed-error',
                                    batchSize: batch.length,
                                    chunkIndex: Math.floor(i / chunkSize),
                                },
                            },
                        );
                    }
                }
            });

            await Promise.all(chunkPromises);

            // Chunk completion logged at higher level
        }

        if (this.enableObservability) {
            this.observability.log(
                'info',
                '🔧 BATCH WITH BACKPRESSURE COMPLETED',
                {
                    batchSize: batch.length,
                    successCount,
                    errorCount,
                    finalQueueSize: this.queue.length,
                    finalProcessedEventsCount: this.processedEvents.size,
                },
            );
        }

        return successCount;
    }

    /**
     * Processar todos os eventos disponíveis com chunking
     */
    async processAll(
        processor: (event: AnyEvent) => Promise<void>,
    ): Promise<void> {
        if (this.processing) {
            // Already logged via observability warn
            if (this.enableObservability) {
                this.observability.log('warn', '🔄 QUEUE ALREADY PROCESSING', {
                    queueSize: this.queue.length,
                    processedEventsCount: this.processedEvents.size,
                    trace: {
                        source: 'event-queue',
                        step: 'process-all-already-processing',
                        timestamp: Date.now(),
                    },
                });
            }
            return;
        }

        this.processing = true;

        // Logged via observability info below

        if (this.enableObservability) {
            this.observability.log(
                'info',
                '🚀 EVENT QUEUE - Processing started',
                {
                    queueSize: this.queue.length,
                    processedEventsCount: this.processedEvents.size,
                    batchSize: this.batchSize || 10,
                    trace: {
                        source: 'event-queue',
                        step: 'processAll-start',
                        timestamp: Date.now(),
                    },
                },
            );
        }

        try {
            while (this.queue.length > 0) {
                const batch = this.queue.splice(0, this.batchSize || 10);

                // Logged via observability debug below

                if (this.enableObservability) {
                    this.observability.log(
                        'debug',
                        '📦 EVENT QUEUE - Processing batch',
                        {
                            batchSize: batch.length,
                            remainingInQueue: this.queue.length,
                            batchEvents: batch.map((item) => ({
                                id: item.event.id,
                                type: item.event.type,
                            })),
                            processedEventsCount: this.processedEvents.size,
                            batchEventTypes: batch.map(
                                (item) => item.event.type,
                            ),
                            batchEventIds: batch.map((item) => item.event.id),
                            trace: {
                                source: 'event-queue',
                                step: 'process-batch',
                                timestamp: Date.now(),
                            },
                        },
                    );
                }

                const processedCount = await this.processBatchWithBackpressure(
                    batch.map((item) => item.event),
                    processor,
                );

                // Logged via observability info below

                if (this.enableObservability) {
                    this.observability.log('info', '✅ BATCH PROCESSED', {
                        batchSize: batch.length,
                        processedCount,
                        remainingInQueue: this.queue.length,
                        processedEventsCount: this.processedEvents.size,
                        trace: {
                            source: 'event-queue',
                            step: 'batch-processed',
                            timestamp: Date.now(),
                        },
                    });
                }

                // Small delay to prevent blocking
                if (this.queue.length > 0) {
                    await new Promise((resolve) => setTimeout(resolve, 1));
                }
            }

            // Logged via observability info below

            if (this.enableObservability) {
                this.observability.log(
                    'info',
                    '🎉 QUEUE PROCESSING COMPLETED',
                    {
                        finalQueueSize: this.queue.length,
                        totalProcessedEvents: this.processedEvents.size,
                        trace: {
                            source: 'event-queue',
                            step: 'process-all-completed',
                            timestamp: Date.now(),
                        },
                    },
                );
            }
        } catch (error) {
            // Logged via observability error below

            if (this.enableObservability) {
                this.observability.log('error', '❌ QUEUE PROCESSING FAILED', {
                    error: (error as Error).message,
                    queueSize: this.queue.length,
                    processedEventsCount: this.processedEvents.size,
                    trace: {
                        source: 'event-queue',
                        step: 'process-all-failed',
                        timestamp: Date.now(),
                    },
                });
            }
            throw error;
        } finally {
            this.processing = false;
            if (this.enableObservability) {
                this.observability.log('info', '🏁 QUEUE PROCESSING FINISHED', {
                    finalQueueSize: this.queue.length,
                    finalProcessedEventsCount: this.processedEvents.size,
                    processing: this.processing,
                });
            }
        }
    }

    /**
     * Limpar fila
     */
    clear(): void {
        // Logged via observability info below

        this.queue = [];
        this.processedEvents.clear();

        // Logged via observability info below

        if (this.enableObservability) {
            this.observability.log('info', 'Event queue cleared', {
                queueSize: 0,
                processedEventsCount: 0,
                trace: {
                    source: 'event-queue',
                    step: 'clear-queue',
                    timestamp: Date.now(),
                },
            });
        }
    }

    /**
     * Obter estatísticas da fila
     */
    getStats() {
        const totalSize = this.queue.reduce(
            (sum, item) => sum + (item.size || 0),
            0,
        );
        const avgSize =
            this.queue.length > 0 ? totalSize / this.queue.length : 0;

        // Event Size Awareness stats
        const largeEvents = this.queue.filter((item) => item.isLarge).length;
        const hugeEvents = this.queue.filter((item) => item.isHuge).length;
        const compressedEvents = this.queue.filter(
            (item) => item.compressed,
        ).length;
        const totalOriginalSize = this.queue.reduce(
            (sum, item) => sum + (item.originalSize || item.size || 0),
            0,
        );
        const compressionRatio =
            totalOriginalSize > 0
                ? (
                      ((totalOriginalSize - totalSize) / totalOriginalSize) *
                      100
                  ).toFixed(2)
                : '0.00';

        const stats = {
            size: this.queue.length,
            maxQueueDepth: this.maxQueueDepth,
            maxSize: this.maxQueueDepth, // Alias para compatibilidade
            processing: this.processing,
            avgEventSize: avgSize,
            totalEventSize: totalSize,
            backpressureActive: this.lastBackpressureActive,
            availablePermits: this.semaphore['permits'],
            waitQueueSize: this.semaphore['waitQueue'].length,

            // Event Size Awareness
            largeEvents,
            hugeEvents,
            compressedEvents,
            totalOriginalSize,
            compressionRatio: `${compressionRatio}%`,
            largeEventThreshold: this.largeEventThreshold,
            hugeEventThreshold: this.hugeEventThreshold,
            maxEventSize: this.maxEventSize,
            enableCompression: this.enableCompression,
            dropHugeEvents: this.dropHugeEvents,

            // Processed events tracking
            processedEventsCount: this.processedEvents.size,
            maxProcessedEvents: this.maxProcessedEvents,
        };

        // Stats are returned to caller; avoid console output in library

        return stats;
    }

    /**
     * Obter um snapshot dos itens atualmente na fila (ordem de processamento)
     * Retorna apenas metadados seguros para inspeção.
     */
    getQueueSnapshot(limit: number = 50): QueueItemSnapshot[] {
        const sliceEnd = Math.min(limit, this.queue.length);
        const items = this.queue.slice(0, sliceEnd);
        return items.map((qi) => ({
            eventId: qi.event.id,
            eventType: qi.event.type,
            priority: qi.priority,
            retryCount: qi.retryCount,
            timestamp: qi.timestamp,
            correlationId: qi.event.metadata?.correlationId,
            tenantId: qi.event.metadata?.tenantId,
        }));
    }

    /**
     * Verificar se fila está vazia
     */
    isEmpty(): boolean {
        return this.queue.length === 0;
    }

    /**
     * Verificar se fila está cheia (baseado em recursos)
     */
    isFull(): boolean {
        return this.shouldActivateBackpressure();
    }

    /**
     * Get Event Store instance (for replay operations)
     */
    getEventStore(): EventStore | undefined {
        return this.eventStore;
    }

    /**
     * Replay events from Event Store
     */
    async *replayEvents(
        fromTimestamp: number,
        options?: {
            toTimestamp?: number;
            onlyUnprocessed?: boolean;
            batchSize?: number;
        },
    ): AsyncGenerator<AnyEvent[]> {
        if (!this.enableEventStore || !this.eventStore) {
            if (this.enableObservability) {
                this.observability.log(
                    'warn',
                    'Event Store not enabled or configured',
                );
            }
            return;
        }

        yield* this.eventStore.replayFromTimestamp(fromTimestamp, options);
    }

    /**
     * Limpar recursos da fila
     */
    destroy(): void {
        // Logged via observability info below

        // Limpar arrays e sets
        this.queue = [];
        this.processedEvents.clear();

        // Logged via observability info below

        if (this.enableObservability) {
            this.observability.log('info', 'Event queue destroyed', {
                queueSize: 0,
                processedEventsCount: 0,
                trace: {
                    source: 'event-queue',
                    step: 'destroy-queue',
                    timestamp: Date.now(),
                },
            });
        }
    }
}
