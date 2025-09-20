import {
    AnyEvent,
    EventMetadata,
    EventStoreConfig,
    Persistor,
} from '../../core/types/allTypes.js';
import type { ObservabilitySystem } from '../../observability/index.js';
import { createPersistorFromConfig } from '../../persistor/factory.js';

export class EventStore {
    private readonly config: Required<
        Omit<EventStoreConfig, 'persistor' | 'persistorOptions'>
    >;
    private readonly persistor: Persistor;
    private readonly observability: ObservabilitySystem;

    // Event metadata cache (para performance) with LRU eviction
    private metadataCache = new Map<string, EventMetadata>();
    private readonly maxCacheSize: number;
    private sequenceNumber = 0;

    constructor(observability: ObservabilitySystem, config: EventStoreConfig) {
        this.observability = observability;
        this.config = {
            enableReplay: true,
            replayBatchSize: 100,
            maxStoredEvents: 10000,
            persistorType: 'memory',
            enableObservability: true,
            ...config,
        };

        // Cache size should be reasonable fraction of max events
        this.maxCacheSize = Math.min(this.config.maxStoredEvents * 0.1, 5000);

        // Initialize persistor usando factory existente
        this.persistor =
            config.persistor ||
            createPersistorFromConfig({
                type: this.config.persistorType,
                maxSnapshots: this.config.maxStoredEvents,
                enableCompression: true,
                enableDeltaCompression: true,
                cleanupInterval: 300000, // 5min
                maxMemoryUsage: 100 * 1024 * 1024, // 100MB
                ...config.persistorOptions,
            } as any);

        if (this.config.enableObservability) {
            this.observability.log('info', 'EventStore initialized', {
                executionId: this.config.executionId,
                persistorType: this.config.persistorType,
                enableReplay: this.config.enableReplay,
                maxStoredEvents: this.config.maxStoredEvents,
            });
        }
    }

    /**
     * Append events to store (chamado pelo EventQueue)
     */
    async appendEvents(events: AnyEvent[]): Promise<void> {
        if (!this.config.enableReplay || events.length === 0) return;

        try {
            // Criar metadata para cada evento
            const eventMetadata = events.map((event) => {
                const metadata: EventMetadata = {
                    eventId: event.id,
                    eventType: event.type,
                    timestamp: event.ts || Date.now(),
                    processed: false,
                    processingAttempts: 0,
                };

                // Cache metadata com LRU eviction
                this.setCacheWithEviction(event.id, metadata);
                return metadata;
            });

            // Store events usando formato snapshot existente
            const snapshot = {
                xcId: `events_${this.config.executionId}`,
                ts: Date.now(),
                events: events, // ✅ USA FORMATO EXISTENTE
                state: {
                    eventMetadata,
                    sequenceNumber: this.sequenceNumber + events.length,
                },
                hash: this.generateBatchHash(events),
            };

            try {
                await this.persistor.append(snapshot);
                this.sequenceNumber += events.length;
            } catch (persistorError) {
                // Clear cache for failed events to allow retry
                for (const event of events) {
                    this.metadataCache.delete(event.id);
                }

                if (this.config.enableObservability) {
                    this.observability.log('error', 'Persistor append failed', {
                        error: (persistorError as Error).message,
                        eventCount: events.length,
                        executionId: this.config.executionId,
                    });
                }
                throw persistorError;
            }

            if (this.config.enableObservability) {
                this.observability.log('debug', 'Events appended to store', {
                    eventCount: events.length,
                    sequenceNumber: this.sequenceNumber,
                });
            }
        } catch (error) {
            if (this.config.enableObservability) {
                this.observability.log(
                    'error',
                    'Failed to append events to store',
                    {
                        error: (error as Error).message,
                        eventCount: events.length,
                        executionId: this.config.executionId,
                    },
                );
            }
            throw error;
        }
    }

    /**
     * Mark events as processed (para evitar replay duplicado)
     */
    async markEventsProcessed(eventIds: string[]): Promise<void> {
        if (!this.config.enableReplay) return;

        const now = Date.now();
        let updatedCount = 0;

        for (const eventId of eventIds) {
            const metadata = this.getCacheWithLRU(eventId);
            if (metadata && !metadata.processed) {
                metadata.processed = true;
                metadata.lastProcessedAt = now;
                updatedCount++;
                // Update cache with new processed status
                this.setCacheWithEviction(eventId, metadata);
            }
        }

        if (this.config.enableObservability && updatedCount > 0) {
            this.observability.log('debug', 'Events marked as processed', {
                processedCount: updatedCount,
                totalRequested: eventIds.length,
            });
        }
    }

    /**
     * Replay events from timestamp
     */
    async *replayFromTimestamp(
        fromTimestamp: number,
        options: {
            toTimestamp?: number;
            onlyUnprocessed?: boolean;
            batchSize?: number;
        } = {},
    ): AsyncGenerator<AnyEvent[]> {
        if (!this.config.enableReplay) {
            if (this.config.enableObservability) {
                this.observability.log(
                    'warn',
                    'Replay disabled in configuration',
                );
            }
            return;
        }

        const {
            toTimestamp = Date.now(),
            onlyUnprocessed = true,
            batchSize = this.config.replayBatchSize,
        } = options;

        if (this.config.enableObservability) {
            this.observability.log('info', 'Starting event replay', {
                fromTimestamp,
                toTimestamp,
                onlyUnprocessed,
                batchSize,
                executionId: this.config.executionId,
            });
        }

        try {
            const xcId = `events_${this.config.executionId}`;
            let totalReplayed = 0;
            let currentBatch: AnyEvent[] = [];

            // ✅ USA LOAD SYSTEM EXISTENTE com early exit
            for await (const snapshot of this.persistor.load(xcId)) {
                if (totalReplayed >= this.config.maxStoredEvents) break;

                // Early exit se snapshot é muito antigo
                if (snapshot.ts < fromTimestamp) continue;
                if (toTimestamp && snapshot.ts > toTimestamp) continue;

                // Filter events by timestamp and processed status
                const eventsToReplay: AnyEvent[] = [];

                for (const event of snapshot.events || []) {
                    const eventTs = event.ts || snapshot.ts;

                    // Time range check (mais eficiente)
                    if (eventTs < fromTimestamp || eventTs > toTimestamp)
                        continue;

                    // Processed status check (com cache LRU)
                    if (onlyUnprocessed) {
                        const metadata = this.getCacheWithLRU(event.id);
                        if (metadata?.processed) continue;
                    }

                    eventsToReplay.push(event);

                    // Early exit se atingir limite
                    if (
                        totalReplayed + eventsToReplay.length >=
                        this.config.maxStoredEvents
                    ) {
                        break;
                    }
                }

                for (const event of eventsToReplay) {
                    currentBatch.push(event);

                    if (currentBatch.length >= batchSize) {
                        yield [...currentBatch];
                        totalReplayed += currentBatch.length;
                        currentBatch = [];
                    }
                }
            }

            // Yield remaining events
            if (currentBatch.length > 0) {
                yield currentBatch;
                totalReplayed += currentBatch.length;
            }

            if (this.config.enableObservability) {
                this.observability.log('info', 'Event replay completed', {
                    totalReplayed,
                    fromTimestamp,
                    toTimestamp,
                    executionId: this.config.executionId,
                });
            }
        } catch (error) {
            if (this.config.enableObservability) {
                this.observability.log('error', 'Event replay failed', {
                    error: (error as Error).message,
                    fromTimestamp,
                    toTimestamp,
                    executionId: this.config.executionId,
                });
            }
            throw error;
        }
    }

    /**
     * Replay all unprocessed events
     */
    async *replayUnprocessed(batchSize?: number): AsyncGenerator<AnyEvent[]> {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        yield* this.replayFromTimestamp(oneHourAgo, {
            onlyUnprocessed: true,
            batchSize,
        });
    }

    /**
     * Get replay statistics
     */
    async getStats(): Promise<{
        totalStoredEvents: number;
        unprocessedEvents: number;
        oldestEventTimestamp?: number;
        newestEventTimestamp?: number;
    }> {
        const allMetadata = Array.from(this.metadataCache.values());
        const unprocessedCount = allMetadata.filter((m) => !m.processed).length;

        const timestamps = allMetadata.map((m) => m.timestamp);
        const oldestEventTimestamp =
            timestamps.length > 0 ? Math.min(...timestamps) : undefined;
        const newestEventTimestamp =
            timestamps.length > 0 ? Math.max(...timestamps) : undefined;

        return {
            totalStoredEvents: this.sequenceNumber,
            unprocessedEvents: unprocessedCount,
            oldestEventTimestamp,
            newestEventTimestamp,
        };
    }

    /**
     * Clear old processed events (cleanup)
     */
    async cleanup(
        olderThanMs: number = 7 * 24 * 60 * 60 * 1000,
    ): Promise<number> {
        const cutoff = Date.now() - olderThanMs;
        let cleanedCount = 0;

        for (const [eventId, metadata] of this.metadataCache.entries()) {
            if (metadata.processed && metadata.timestamp < cutoff) {
                this.metadataCache.delete(eventId);
                cleanedCount++;
            }
        }

        if (this.config.enableObservability) {
            this.observability.log('info', 'EventStore cleanup completed', {
                cleanedCount,
                olderThanMs,
                remainingEvents: this.metadataCache.size,
            });
        }

        return cleanedCount;
    }

    /**
     * Set cache with LRU eviction policy
     */
    private setCacheWithEviction(key: string, value: EventMetadata): void {
        // If key already exists, delete it to update position
        if (this.metadataCache.has(key)) {
            this.metadataCache.delete(key);
        }

        // Evict oldest entries if at capacity
        while (this.metadataCache.size >= this.maxCacheSize) {
            const firstKey = this.metadataCache.keys().next().value;
            if (firstKey) {
                this.metadataCache.delete(firstKey);
            }
        }

        // Add to end (most recently used)
        this.metadataCache.set(key, value);
    }

    /**
     * Get from cache with LRU update
     */
    private getCacheWithLRU(key: string): EventMetadata | undefined {
        const value = this.metadataCache.get(key);
        if (value) {
            // Move to end (mark as recently used)
            this.metadataCache.delete(key);
            this.metadataCache.set(key, value);
        }
        return value;
    }

    /**
     * Generate hash for events batch
     */
    private generateBatchHash(events: AnyEvent[]): string {
        const content = events.map((e) => `${e.id}:${e.type}`).join(',');
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    }
}

/**
 * Create EventStore instance
 */
export function createEventStore(
    observability: ObservabilitySystem,
    config: EventStoreConfig,
): EventStore {
    return new EventStore(observability, config);
}
