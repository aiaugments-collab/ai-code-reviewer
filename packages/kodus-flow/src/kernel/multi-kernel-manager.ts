import { ExecutionKernel, createKernel } from './kernel.js';
import { createPersistor } from '../persistor/factory.js';
import { createLogger } from '../observability/index.js';
import {
    AnyEvent,
    CrossKernelBridge,
    EventHandler,
    EventPayloads,
    EventType,
    KernelConfig,
    KernelSpec,
    ManagedKernel,
    MultiKernelConfig,
    Workflow,
} from '../core/types/allTypes.js';

export class MultiKernelManager {
    private readonly config: MultiKernelConfig;
    private readonly logger: ReturnType<typeof createLogger>;
    private readonly kernels = new Map<string, ManagedKernel>();
    private readonly eventBridges = new Map<string, CrossKernelBridge>();
    private readonly handlers = new Map<
        string,
        Map<EventType, EventHandler<AnyEvent>>
    >();
    private readonly crossKernelEventLog: Array<{
        timestamp: number;
        from: string;
        to: string;
        eventType: string;
        success: boolean;
    }> = [];

    constructor(config: MultiKernelConfig) {
        this.config = config;
        this.logger = createLogger(`multi-kernel:${config.tenantId}`);

        if (config.bridges) {
            for (const bridge of config.bridges) {
                const bridgeKey = `${bridge.fromNamespace}->${bridge.toNamespace}`;
                this.eventBridges.set(bridgeKey, bridge);
            }
        }

        this.logger.info('MultiKernelManager initialized', {
            tenantId: config.tenantId,
            kernelCount: config.kernels.length,
            bridgeCount: config.bridges?.length || 0,
        });
    }

    /**
     * Initialize all kernels
     */
    async initialize(): Promise<void> {
        const initPromises = this.config.kernels.map((spec) =>
            this.initializeKernel(spec),
        );

        await Promise.all(initPromises);

        this.logger.info('All kernels initialized', {
            kernelCount: this.kernels.size,
            runningKernels: Array.from(this.kernels.values()).filter(
                (k) => k.status === 'running',
            ).length,
        });
    }

    /**
     * Initialize a single kernel based on its specification
     */
    private async initializeKernel(spec: KernelSpec): Promise<void> {
        try {
            this.logger.info('Initializing kernel', {
                kernelId: spec.kernelId,
                namespace: spec.namespace,
                needsPersistence: spec.needsPersistence,
                needsSnapshots: spec.needsSnapshots,
            });

            // Create kernel configuration
            const kernelConfig: KernelConfig = {
                tenantId: this.config.tenantId,
                jobId: `${spec.namespace}-${spec.kernelId}`,
                workflow: spec.workflow,

                // Persistence only for kernels that need it (agents=yes, logs=no)
                persistor: spec.needsPersistence
                    ? createPersistor(
                          this.config.global?.persistorType || 'memory',
                          this.config.global?.persistorOptions || {},
                      )
                    : undefined,

                // Runtime configuration with queue settings
                runtimeConfig: {
                    enableAcks: spec.needsPersistence,
                    ...(spec.runtimeConfig || {}),
                },

                // Quotas (null for observability kernels)
                quotas: spec.quotas,

                // Performance configuration
                performance: {
                    enableBatching: true,
                    enableCaching: spec.needsPersistence, // Cache only for persistent kernels
                    enableLazyLoading: !spec.needsPersistence, // Lazy load for logs
                    ...spec.performance,
                },

                // Isolation configuration
                isolation: {
                    enableTenantIsolation: true,
                    enableEventIsolation: true,
                    enableContextIsolation: true,
                },

                // Idempotency (only for persistent kernels)
                idempotency: spec.needsPersistence
                    ? {
                          enableOperationIdempotency: true,
                          enableEventIdempotency: true,
                          // Aumentar timeout de operações longas (ex.: processEvents)
                          operationTimeout: spec.runtimeConfig?.ackTimeout
                              ? Math.max(
                                    (spec.runtimeConfig.ackTimeout as number) *
                                        2,
                                    60000,
                                )
                              : 120000,
                      }
                    : undefined,
            };

            // Create kernel instance
            const kernel = createKernel(kernelConfig);

            // Initialize kernel
            const workflowContext = await kernel.initialize();

            // Register cross-kernel event handlers
            this.setupCrossKernelCommunication(spec, kernel);

            // Store managed kernel
            const managedKernel: ManagedKernel = {
                spec,
                instance: kernel,
                status: 'running',
                startTime: Date.now(),
                lastActivity: Date.now(),
                eventCount: 0,
            };

            this.kernels.set(spec.kernelId, managedKernel);

            this.logger.info('Kernel initialized successfully', {
                kernelId: spec.kernelId,
                namespace: spec.namespace,
                workflowName: workflowContext.workflowName,
            });
        } catch (error) {
            this.logger.error('Failed to initialize kernel', error as Error, {
                kernelId: spec.kernelId,
                namespace: spec.namespace,
            });

            // Store failed kernel for monitoring
            const managedKernel: ManagedKernel = {
                spec,
                instance: null, // Will be null for failed kernels
                status: 'failed',
                startTime: Date.now(),
                lastActivity: Date.now(),
                eventCount: 0,
            };

            this.kernels.set(spec.kernelId, managedKernel);
            throw error;
        }
    }

    /**
     * Setup cross-kernel communication for a kernel
     */
    private setupCrossKernelCommunication(
        spec: KernelSpec,
        kernel: ExecutionKernel,
    ): void {
        // Register handlers for events that should be bridged to other kernels
        kernel.registerHandler('*' as EventType, async (event: AnyEvent) => {
            await this.handleCrossKernelEvent(spec.namespace, event);
        });
    }

    /**
     * Handle cross-kernel event propagation
     */
    private async handleCrossKernelEvent(
        sourceNamespace: string,
        event: AnyEvent,
    ): Promise<void> {
        for (const [, bridge] of this.eventBridges) {
            if (bridge.fromNamespace !== sourceNamespace) continue;

            // Check if event matches the bridge pattern
            if (!this.matchesEventPattern(event.type, bridge.eventPattern))
                continue;

            try {
                // Transform event if needed
                const targetEvent = bridge.transform
                    ? bridge.transform(event)
                    : event;

                // Find target kernel
                const targetKernel = this.findKernelByNamespace(
                    bridge.toNamespace,
                );
                if (!targetKernel) {
                    this.logger.warn('Target kernel not found for bridge', {
                        bridge: `${bridge.fromNamespace}->${bridge.toNamespace}`,
                        eventType: event.type,
                    });
                    continue;
                }

                // Send event to target kernel
                if (targetKernel.instance) {
                    await targetKernel.instance.emitEventAsync(
                        targetEvent.type as EventType,
                        targetEvent.data,
                        {
                            correlationId: event.metadata?.correlationId,
                            tenantId: this.config.tenantId,
                        },
                    );
                }

                // Log cross-kernel communication
                if (
                    bridge.enableLogging ||
                    this.config.global?.enableCrossKernelLogging
                ) {
                    this.crossKernelEventLog.push({
                        timestamp: Date.now(),
                        from: sourceNamespace,
                        to: bridge.toNamespace,
                        eventType: event.type,
                        success: true,
                    });
                }

                this.logger.debug('Cross-kernel event bridged', {
                    from: sourceNamespace,
                    to: bridge.toNamespace,
                    eventType: event.type,
                    eventId: event.id,
                });
            } catch (error) {
                this.logger.error(
                    'Failed to bridge cross-kernel event',
                    error as Error,
                    {
                        from: sourceNamespace,
                        to: bridge.toNamespace,
                        eventType: event.type,
                    },
                );

                // Log failed communication
                this.crossKernelEventLog.push({
                    timestamp: Date.now(),
                    from: sourceNamespace,
                    to: bridge.toNamespace,
                    eventType: event.type,
                    success: false,
                });
            }
        }
    }

    /**
     * Check if event type matches pattern
     */
    private matchesEventPattern(eventType: string, pattern: string): boolean {
        if (pattern === '*') return true;
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            return eventType.startsWith(prefix);
        }
        return eventType === pattern;
    }

    /**
     * Find kernel by namespace
     */
    private findKernelByNamespace(
        namespace: string,
    ): ManagedKernel | undefined {
        for (const kernel of this.kernels.values()) {
            if (
                kernel.spec.namespace === namespace &&
                kernel.status === 'running'
            ) {
                return kernel;
            }
        }
        return undefined;
    }

    /**
     * Get kernel by ID
     */
    getKernel(kernelId: string): ExecutionKernel | null {
        const managedKernel = this.kernels.get(kernelId);
        return managedKernel?.status === 'running'
            ? managedKernel.instance
            : null;
    }

    /**
     * Get kernel by namespace
     */
    getKernelByNamespace(namespace: string): ExecutionKernel | null {
        const managedKernel = this.findKernelByNamespace(namespace);
        return managedKernel?.instance || null;
    }

    /**
     * Emit event to specific kernel
     */
    async emitToKernel<T extends EventType>(
        kernelId: string,
        eventType: T,
        data?: EventPayloads[T],
    ): Promise<void> {
        const kernel = this.getKernel(kernelId);
        if (!kernel) {
            throw new Error(`Kernel not found or not running: ${kernelId}`);
        }

        await kernel.emitEventAsync(eventType, data, {
            tenantId: this.config.tenantId,
        });

        // Update activity
        const managedKernel = this.kernels.get(kernelId);
        if (managedKernel) {
            managedKernel.lastActivity = Date.now();
            managedKernel.eventCount++;
        }
    }

    /**
     * Emit event to kernel by namespace
     */
    async emitToNamespace<T extends EventType>(
        namespace: string,
        eventType: T,
        data?: EventPayloads[T],
    ): Promise<void> {
        const kernel = this.getKernelByNamespace(namespace);
        if (!kernel) {
            throw new Error(`Kernel not found for namespace: ${namespace}`);
        }

        // Check if kernel is in a valid state for emitting events
        if (!kernel.isRuntimeReady()) {
            this.logger.warn('Kernel not ready for event emission', {
                namespace,
                eventType,
                kernelStatus: kernel.getState().status,
            });

            // Try to resume if paused
            if (kernel.getState().status === 'paused') {
                this.logger.info('Attempting to resume paused kernel', {
                    namespace,
                    eventType,
                });
                // Note: This would require the last snapshot ID to resume
                // For now, we'll just log and skip the event
                return;
            }

            throw new Error(
                `Kernel not ready for event emission. Status: ${kernel.getState().status}`,
            );
        }

        // ✅ CORREÇÃO: Preservar correlationId do data se existir
        const dataWithMetadata = data as Record<string, unknown>;
        const correlationId =
            dataWithMetadata?.metadata &&
            typeof dataWithMetadata.metadata === 'object' &&
            dataWithMetadata.metadata !== null &&
            'correlationId' in dataWithMetadata.metadata
                ? ((dataWithMetadata.metadata as Record<string, unknown>)
                      .correlationId as string)
                : undefined;

        await kernel.emitEventAsync(eventType, data, {
            tenantId: this.config.tenantId,
            correlationId, // ✅ Adicionar correlationId preservado
        });
    }

    /**
     * Register handler on specific kernel
     */
    registerHandler(
        kernelId: string,
        eventType: EventType,
        handler: EventHandler<AnyEvent>,
    ): void {
        const managedKernel = this.kernels.get(kernelId);
        if (!managedKernel?.instance) {
            throw new Error(`Kernel not found: ${kernelId}`);
        }

        // ✅ FIX: Actually register handler on the kernel
        managedKernel.instance.registerHandler(eventType, handler);

        // Track internally
        if (!this.handlers.has(kernelId)) {
            this.handlers.set(kernelId, new Map());
        }
        this.handlers.get(kernelId)!.set(eventType, handler);

        this.logger.info('📝 HANDLER REGISTERED', {
            kernelId,
            eventType,
            registeredOnKernel: true,
        });
    }

    /**
     * Process events for all running kernels
     */
    async processAllKernels(): Promise<void> {
        const runningKernels = Array.from(this.kernels.values()).filter(
            (k) => k.status === 'running',
        );

        this.logger.info('🔄 PROCESSING ALL KERNELS', {
            totalKernels: this.kernels.size,
            runningKernels: runningKernels.length,
            kernelIds: runningKernels.map((k) => k.spec.kernelId),
            trace: {
                source: 'multi-kernel-manager',
                step: 'process-all-kernels-start',
                timestamp: Date.now(),
            },
        });

        const processPromises = runningKernels.map(async (managedKernel) => {
            try {
                if (managedKernel.instance) {
                    this.logger.debug('🔄 PROCESSING KERNEL', {
                        kernelId: managedKernel.spec.kernelId,
                        namespace: managedKernel.spec.namespace,
                        trace: {
                            source: 'multi-kernel-manager',
                            step: 'processing-kernel',
                            timestamp: Date.now(),
                        },
                    });

                    await managedKernel.instance.processEvents();
                    managedKernel.lastActivity = Date.now();

                    this.logger.debug('✅ KERNEL PROCESSED', {
                        kernelId: managedKernel.spec.kernelId,
                        namespace: managedKernel.spec.namespace,
                        trace: {
                            source: 'multi-kernel-manager',
                            step: 'kernel-processed',
                            timestamp: Date.now(),
                        },
                    });
                }
            } catch (error) {
                this.logger.error(
                    'Failed to process events for kernel',
                    error as Error,
                    {
                        kernelId: managedKernel.spec.kernelId,
                    },
                );
            }
        });

        await Promise.all(processPromises);

        this.logger.info('✅ ALL KERNELS PROCESSED', {
            totalKernels: this.kernels.size,
            runningKernels: runningKernels.length,
            trace: {
                source: 'multi-kernel-manager',
                step: 'process-all-kernels-complete',
                timestamp: Date.now(),
            },
        });
    }

    /**
     * Get comprehensive status of all kernels
     */
    getStatus(): {
        tenantId: string;
        kernelCount: number;
        runningKernels: number;
        failedKernels: number;
        kernels: Array<{
            kernelId: string;
            namespace: string;
            status: string;
            startTime: number;
            lastActivity: number;
            eventCount: number;
            needsPersistence: boolean;
            needsSnapshots: boolean;
        }>;
        crossKernelEvents: {
            totalEvents: number;
            successfulEvents: number;
            failedEvents: number;
            recentEvents: Array<{
                timestamp: number;
                from: string;
                to: string;
                eventType: string;
                success: boolean;
            }>;
        };
    } {
        const kernels = Array.from(this.kernels.values());
        const runningKernels = kernels.filter(
            (k) => k.status === 'running',
        ).length;
        const failedKernels = kernels.filter(
            (k) => k.status === 'failed',
        ).length;

        const successfulCrossKernelEvents = this.crossKernelEventLog.filter(
            (e) => e.success,
        ).length;
        const failedCrossKernelEvents = this.crossKernelEventLog.filter(
            (e) => !e.success,
        ).length;

        return {
            tenantId: this.config.tenantId,
            kernelCount: kernels.length,
            runningKernels,
            failedKernels,
            kernels: kernels.map((k) => ({
                kernelId: k.spec.kernelId,
                namespace: k.spec.namespace,
                status: k.status,
                startTime: k.startTime,
                lastActivity: k.lastActivity,
                eventCount: k.eventCount,
                needsPersistence: k.spec.needsPersistence,
                needsSnapshots: k.spec.needsSnapshots,
            })),
            crossKernelEvents: {
                totalEvents: this.crossKernelEventLog.length,
                successfulEvents: successfulCrossKernelEvents,
                failedEvents: failedCrossKernelEvents,
                recentEvents: this.crossKernelEventLog.slice(-10), // Last 10 events
            },
        };
    }

    /**
     * Pause all kernels (creates snapshots for persistent kernels)
     */
    async pauseAll(): Promise<Map<string, string | null>> {
        const results = new Map<string, string | null>();

        for (const [kernelId, managedKernel] of this.kernels) {
            if (managedKernel.status !== 'running') continue;

            try {
                // Only create snapshots for kernels that need them
                if (
                    managedKernel.spec.needsSnapshots &&
                    managedKernel.instance
                ) {
                    const snapshotId =
                        await managedKernel.instance.pause(
                            `multi-kernel-pause`,
                        );
                    results.set(kernelId, snapshotId);
                } else {
                    // For non-persistent kernels (like logs), just stop processing
                    results.set(kernelId, null);
                }

                managedKernel.status = 'paused';
            } catch (error) {
                this.logger.error('Failed to pause kernel', error as Error, {
                    kernelId,
                });
                results.set(kernelId, null);
            }
        }

        return results;
    }

    /**
     * Resume all kernels (restores from snapshots for persistent kernels)
     */
    async resumeAll(snapshotIds?: Map<string, string>): Promise<void> {
        for (const [kernelId, managedKernel] of this.kernels) {
            if (managedKernel.status !== 'paused') continue;

            try {
                // Only restore from snapshots for kernels that need them
                if (
                    managedKernel.spec.needsSnapshots &&
                    snapshotIds?.has(kernelId) &&
                    managedKernel.instance
                ) {
                    const snapshotId = snapshotIds.get(kernelId);
                    if (snapshotId) {
                        await managedKernel.instance.resume(snapshotId);
                    }
                }

                managedKernel.status = 'running';
                managedKernel.lastActivity = Date.now();
            } catch (error) {
                this.logger.error('Failed to resume kernel', error as Error, {
                    kernelId,
                });
                managedKernel.status = 'failed';
            }
        }
    }

    /**
     * Cleanup all kernels
     */
    async cleanup(): Promise<void> {
        const cleanupPromises = Array.from(this.kernels.values()).map(
            async (managedKernel) => {
                if (managedKernel.instance) {
                    try {
                        await managedKernel.instance.enhancedCleanup();
                    } catch (error) {
                        this.logger.error(
                            'Failed to cleanup kernel',
                            error as Error,
                            {
                                kernelId: managedKernel.spec.kernelId,
                            },
                        );
                    }
                }
            },
        );

        await Promise.all(cleanupPromises);

        this.kernels.clear();
        this.eventBridges.clear();
        this.crossKernelEventLog.length = 0;

        this.logger.info('MultiKernelManager cleaned up');
    }

    /**
     * Clear events and resources (for testing or reset)
     */
    async clear(): Promise<void> {
        this.logger.info('🔄 CLEARING MULTI-KERNEL MANAGER', {
            kernelCount: this.kernels.size,
            bridgeCount: this.eventBridges.size,
            crossKernelEventCount: this.crossKernelEventLog.length,
            trace: {
                source: 'multi-kernel-manager',
                step: 'clear-start',
                timestamp: Date.now(),
            },
        });

        try {
            // Cleanup all kernels
            const cleanupPromises = Array.from(this.kernels.values()).map(
                async (managedKernel) => {
                    if (managedKernel.instance) {
                        try {
                            await managedKernel.instance.enhancedCleanup();
                        } catch (error) {
                            this.logger.error(
                                'Failed to cleanup kernel during clear',
                                error as Error,
                                {
                                    kernelId: managedKernel.spec.kernelId,
                                },
                            );
                        }
                    }
                },
            );

            await Promise.all(cleanupPromises);

            // Clear all collections
            this.kernels.clear();
            this.eventBridges.clear();
            this.handlers.clear();
            this.crossKernelEventLog.length = 0;

            this.logger.info('✅ MULTI-KERNEL MANAGER CLEARED', {
                trace: {
                    source: 'multi-kernel-manager',
                    step: 'clear-complete',
                    timestamp: Date.now(),
                },
            });
        } catch (error) {
            this.logger.error(
                'Failed to clear MultiKernelManager',
                error as Error,
            );
            throw error;
        }
    }
}

/**
 * Create multi-kernel manager with pre-configured specs
 */
export function createMultiKernelManager(
    config: MultiKernelConfig,
): MultiKernelManager {
    return new MultiKernelManager(config);
}

/**
 * Helper to create observability kernel spec (no persistence/snapshots)
 */
export function createObservabilityKernelSpec(
    kernelId: string,
    workflow: Workflow,
): KernelSpec {
    return {
        kernelId,
        namespace: 'obs',
        workflow,
        needsPersistence: false, // Logs are fire-and-forget
        needsSnapshots: false, // No need to recover logs
        quotas: undefined, // No limits for observability
        performance: {
            enableBatching: true,
            enableCaching: false,
            enableLazyLoading: true, // Lazy load for better performance
        },
    };
}

/**
 * Helper to create agent execution kernel spec (with persistence/snapshots)
 */
export function createAgentKernelSpec(
    kernelId: string,
    workflow: Workflow,
    quotas?: KernelConfig['quotas'],
): KernelSpec {
    return {
        kernelId,
        namespace: 'agent',
        workflow,
        needsPersistence: true, // Agents need state persistence
        needsSnapshots: true, // Agents need recovery from snapshots
        quotas: quotas || {
            maxEvents: 10000, // Increased from 1000 to 10000 events
            maxDuration: 30 * 60 * 1000, // Increased from 5 to 30 minutes
            maxMemory: 1024 * 1024 * 1024, // Increased from 512MB to 1GB
        },
        runtimeConfig: {
            enableAcks: true,
        },
        performance: {
            enableBatching: true,
            enableCaching: true,
            enableLazyLoading: false,
        },
    };
}
