import { EventEmitter } from 'node:events';
import { createLogger } from '../observability/index.js';
import { IdGenerator } from '../utils/id-generator.js';
import {
    EventPayloads,
    EventResult,
    EventType,
    UnifiedEventConfig,
    UnifiedEventContext,
} from './types/allTypes.js';

// ✅ UNIFIED EVENT MANAGER
export class UnifiedEventManager extends EventEmitter {
    private logger = createLogger('unified-events');
    private observabilityBus?: EventEmitter;
    private config: Required<UnifiedEventConfig>;

    // Request-response tracking
    private pendingRequests = new Map<
        string,
        {
            resolve: (value: unknown) => void;
            reject: (error: Error) => void;
            timeout: NodeJS.Timeout;
            timestamp: number;
        }
    >();

    constructor(config: UnifiedEventConfig = {}) {
        super();

        this.config = {
            enableObservability: true,
            enablePersistence: false,
            enableRequestResponse: true,
            maxListeners: 100,
            bufferSize: 1000,
            flushInterval: 1000,
            eventFilters: [],
            componentFilters: [],
            enableErrorHandling: true,
            maxRetries: 3,
            ...config,
        };

        this.setMaxListeners(this.config.maxListeners);
        this.setupEventHandling();
    }

    /**
     * ✅ Unified emit - routes to appropriate subsystems
     */
    emit(eventType: string | symbol, ...args: unknown[]): boolean {
        const success = super.emit(eventType, ...args);

        // Route to observability if enabled
        if (this.config.enableObservability && this.observabilityBus) {
            this.observabilityBus.emit(eventType, ...args);
        }

        return success;
    }

    /**
     * ✅ Emit event with context and error handling
     */
    emitEvent<T extends EventType>(
        eventType: T,
        payload: EventPayloads[T],
        context: UnifiedEventContext = {},
    ): Promise<EventResult> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const eventId = IdGenerator.correlationId();

            const eventData = {
                id: eventId,
                type: eventType,
                payload,
                metadata: {
                    timestamp: Date.now(),
                    correlationId: context.correlationId || eventId,
                    ...context,
                },
            };

            try {
                // Emit to all listeners
                const success = this.emit(eventType, eventData);

                resolve({
                    success,
                    data: eventData,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                });
            } catch (error) {
                this.logger.error('Event emission failed', error as Error, {
                    eventType,
                    eventId,
                });

                resolve({
                    success: false,
                    error: error as Error,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                });
            }
        });
    }

    /**
     * ✅ Request-response pattern for events
     */
    async request<TRequest = unknown, TResponse = unknown>(
        requestEventType: string,
        responseEventType: string,
        data: TRequest,
        options: { timeout?: number; correlationId?: string } = {},
    ): Promise<TResponse> {
        const correlationId =
            options.correlationId || IdGenerator.correlationId();
        const timeout = options.timeout || 60000; // ✅ UNIFIED: 60s timeout

        return new Promise<TResponse>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                this.pendingRequests.delete(correlationId);
                reject(new Error(`Request timeout after ${timeout}ms`));
            }, timeout);

            // Store pending request
            this.pendingRequests.set(correlationId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timeout: timeoutHandle,
                timestamp: Date.now(),
            });

            // Set up response listener
            const responseHandler = (response: {
                correlationId: string;
                data?: unknown;
                error?: string;
            }) => {
                if (response.correlationId === correlationId) {
                    const pending = this.pendingRequests.get(correlationId);
                    if (pending) {
                        clearTimeout(pending.timeout);
                        this.pendingRequests.delete(correlationId);
                        this.off(responseEventType, responseHandler);

                        if (response.error) {
                            reject(new Error(response.error));
                        } else {
                            (pending.resolve as (value: TResponse) => void)(
                                response.data as TResponse,
                            );
                        }
                    }
                }
            };

            this.on(responseEventType, responseHandler);

            // Emit request
            void this.emitEvent(
                requestEventType as EventType,
                {
                    data,
                    timestamp: Date.now(),
                } as EventPayloads[EventType],
                {
                    correlationId,
                },
            );
        });
    }

    /**
     * ✅ Respond to a request
     */
    respond<T = unknown>(
        responseEventType: string,
        correlationId: string,
        data?: T,
        error?: string,
    ): void {
        void this.emitEvent(
            responseEventType as EventType,
            {
                data,
                error,
                timestamp: Date.now(),
            } as EventPayloads[EventType],
            {
                correlationId,
            },
        );
    }

    /**
     * ✅ Setup integrations with other event systems
     */
    setObservabilityBus(bus: EventEmitter): void {
        this.observabilityBus = bus;
        this.logger.debug('Observability bus connected');
    }

    setKernelHandler(handler: {
        requestToolExecution?: (
            toolName: string,
            input: unknown,
            options?: { correlationId?: string },
        ) => Promise<unknown>;
        requestLLMPlanning?: (
            goal: string,
            context: unknown,
            options?: { correlationId?: string },
        ) => Promise<unknown>;
    }): void {
        this.logger.debug('Kernel handler connected');

        // Bridge kernel handler with unified events
        if (handler.requestToolExecution && this.config.enableRequestResponse) {
            this.bridgeKernelHandler(handler);
        }
    }

    /**
     * ✅ Bridge with existing kernel handler
     */
    private bridgeKernelHandler(handler: {
        requestToolExecution?: (
            toolName: string,
            input: unknown,
            options?: { correlationId?: string },
        ) => Promise<unknown>;
        requestLLMPlanning?: (
            goal: string,
            context: unknown,
            options?: { correlationId?: string },
        ) => Promise<unknown>;
    }): void {
        // Forward requests to kernel handler when appropriate
        this.on('tool:execute:request', async (event) => {
            try {
                if (!handler.requestToolExecution) {
                    throw new Error('requestToolExecution not available');
                }
                const result = await handler.requestToolExecution(
                    event.payload.toolName,
                    event.payload.input,
                    { correlationId: event.context.correlationId },
                );

                this.respond(
                    'tool:execute:response',
                    event.context.correlationId,
                    result,
                );
            } catch (error) {
                this.respond(
                    'tool:execute:response',
                    event.context.correlationId,
                    undefined,
                    (error as Error).message,
                );
            }
        });

        this.on('llm:planning:request', async (event) => {
            try {
                if (!handler.requestLLMPlanning) {
                    throw new Error('requestLLMPlanning not available');
                }
                const result = await handler.requestLLMPlanning(
                    event.payload.goal,
                    event.payload.context,
                    { correlationId: event.context.correlationId },
                );

                this.respond(
                    'llm:planning:response',
                    event.context.correlationId,
                    result,
                );
            } catch (error) {
                this.respond(
                    'llm:planning:response',
                    event.context.correlationId,
                    undefined,
                    (error as Error).message,
                );
            }
        });
    }

    /**
     * ✅ Setup error handling and recovery
     */
    private setupEventHandling(): void {
        // Global error handler
        this.on('error', (error) => {
            this.logger.error('Unified event system error', error);
        });

        // Cleanup expired requests periodically
        setInterval(() => {
            this.cleanupExpiredRequests();
        }, 60000); // Every minute
    }

    /**
     * ✅ Cleanup expired requests
     */
    private cleanupExpiredRequests(): void {
        const now = Date.now();
        const maxAge = 5 * 60 * 1000; // 5 minutes
        let cleanedCount = 0;

        for (const [requestId, request] of this.pendingRequests) {
            if (now - request.timestamp > maxAge) {
                clearTimeout(request.timeout);
                request.reject(new Error('Request expired'));
                this.pendingRequests.delete(requestId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.logger.debug('Cleaned up expired requests', { cleanedCount });
        }
    }

    /**
     * ✅ Get system statistics
     */
    getStats() {
        return {
            pendingRequests: this.pendingRequests.size,
            maxListeners: this.getMaxListeners(),
            eventNames: this.eventNames(),
            listenerCount: this.eventNames().reduce(
                (total, event) => total + this.listenerCount(event),
                0,
            ),
            config: this.config,
        };
    }

    /**
     * ✅ Cleanup
     */
    async cleanup(): Promise<void> {
        // Clear all pending requests
        for (const [, request] of this.pendingRequests) {
            clearTimeout(request.timeout);
            request.reject(new Error('System shutdown'));
        }
        this.pendingRequests.clear();

        // Remove all listeners
        this.removeAllListeners();

        this.logger.info('Unified event manager cleaned up');
    }
}

// ✅ SINGLETON INSTANCE
let globalEventManager: UnifiedEventManager | null = null;

export function getUnifiedEventManager(
    config?: UnifiedEventConfig,
): UnifiedEventManager {
    if (!globalEventManager) {
        globalEventManager = new UnifiedEventManager(config);
    }
    return globalEventManager;
}

export async function resetUnifiedEventManager(): Promise<void> {
    if (globalEventManager) {
        await globalEventManager.cleanup();
        globalEventManager = null;
    }
}

// ✅ CONVENIENCE FUNCTIONS
export function emitUnifiedEvent<T extends EventType>(
    eventType: T,
    payload: EventPayloads[T],
    context?: UnifiedEventContext,
): Promise<EventResult> {
    return getUnifiedEventManager().emitEvent(eventType, payload, context);
}

export function requestUnified<TRequest = unknown, TResponse = unknown>(
    requestEventType: string,
    responseEventType: string,
    data: TRequest,
    options?: { timeout?: number; correlationId?: string },
): Promise<TResponse> {
    return getUnifiedEventManager().request(
        requestEventType,
        responseEventType,
        data,
        options,
    );
}

export function respondUnified<T = unknown>(
    responseEventType: string,
    correlationId: string,
    data?: T,
    error?: string,
): void {
    getUnifiedEventManager().respond(
        responseEventType,
        correlationId,
        data,
        error,
    );
}
