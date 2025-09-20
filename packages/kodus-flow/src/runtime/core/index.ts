export { EventQueue } from './event-queue.js';

export { OptimizedEventProcessor } from './event-processor-optimized.js';

export { StreamManager } from './stream-manager.js';
export { MemoryMonitor } from './memory-monitor.js';

export const DEFAULT_ENHANCED_CONFIG = {
    // Durability settings
    persistCriticalEvents: true,
    enableAutoRecovery: true,
    maxPersistedEvents: 1000,
    criticalEventPrefixes: ['agent.', 'workflow.', 'kernel.'],

    // Retry settings
    maxRetries: 3,
    baseRetryDelay: 1000,
    maxRetryDelay: 180000,
    enableJitter: true,
    jitterRatio: 0.1,

    // Queue settings
    maxQueueDepth: 10000,
    enableObservability: true,
    batchSize: 100,
    chunkSize: 50,
    maxConcurrent: 10,
    enableAutoScaling: false, // Disable a      uto-scaling to prevent memory loops
} as const;

/**
 * Runtime Core version and feature flags
 */
export const RUNTIME_CORE_VERSION = '1.1.0';
export const RUNTIME_FEATURES = {
    DURABILITY: true,
    ENHANCED_RETRY: true,
    CIRCUIT_BREAKER: false,
    PARTITIONING: false,
    TRACING: false,
} as const;
