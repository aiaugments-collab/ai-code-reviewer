import {
    AnyEvent,
    CircularBuffer,
    DEFAULT_TIMEOUT_MS,
    EventHandler,
    EventProcessingContext,
    HandlerReturn,
    Middleware,
    OptimizedEventProcessorConfig,
    OptimizedHandlerMap,
    TrackedEventHandler,
    WorkflowContext,
} from '../../core/types/allTypes.js';
import type { ObservabilitySystem } from '../../observability/index.js';
import { WORKFLOW } from '../../observability/types.js';
import { SPAN_NAMES } from '../../observability/semantic-conventions.js';

export class EventChainTracker {
    private events: string[] = [];
    private head = 0;
    private size = 0;

    constructor(private readonly capacity: number = 1000) {}

    push(eventKey: string): void {
        if (this.size < this.capacity) {
            this.events[this.size] = eventKey;
            this.size++;
        } else {
            // Circular buffer: overwrite oldest
            this.events[this.head] = eventKey;
            this.head = (this.head + 1) % this.capacity;
        }
    }

    pop(): void {
        if (this.size > 0) {
            if (this.size < this.capacity) {
                this.size--;
            } else {
                this.head = (this.head - 1 + this.capacity) % this.capacity;
            }
        }
    }

    includes(eventKey: string): boolean {
        for (let i = 0; i < this.size; i++) {
            const index =
                this.size < this.capacity ? i : (this.head + i) % this.capacity;
            if (this.events[index] === eventKey) {
                return true;
            }
        }
        return false;
    }

    get length(): number {
        return this.size;
    }

    clear(): void {
        this.events = [];
        this.head = 0;
        this.size = 0;
    }
}

function createCircularBuffer<T>(capacity: number = 10000): CircularBuffer<T> {
    return {
        items: new Array(capacity),
        head: 0,
        tail: 0,
        size: 0,
        capacity,
    };
}

function pushToBuffer<T>(buffer: CircularBuffer<T>, item: T): void {
    if (buffer.size === buffer.capacity) {
        buffer.head = (buffer.head + 1) % buffer.capacity;
    } else {
        buffer.size++;
    }
    buffer.items[buffer.tail] = item;
    buffer.tail = (buffer.tail + 1) % buffer.capacity;
}

/**
 * Separar middlewares em pipeline e handler
 */
function separateMiddlewares(middlewares: Middleware[]): {
    pipelineMiddlewares: Middleware[];
    handlerMiddlewares: Middleware[];
} {
    const pipelineMiddlewares: Middleware[] = [];
    const handlerMiddlewares: Middleware[] = [];

    for (const middleware of middlewares) {
        const kind = middleware.kind;
        if (kind === 'pipeline') {
            pipelineMiddlewares.push(middleware);
        } else {
            // Default para 'handler' quando não especificado
            handlerMiddlewares.push(middleware);
        }
    }

    return { pipelineMiddlewares, handlerMiddlewares };
}

/**
 * Processador de eventos otimizado
 */
export class OptimizedEventProcessor {
    private handlerMap: OptimizedHandlerMap;
    private processingDepth = 0;
    private readonly maxDepth: number;
    private readonly maxChainLength: number;
    private readonly enableObservability: boolean;
    private readonly pipelineMiddlewares: Middleware[];
    private readonly handlerMiddlewares: Middleware[];
    private readonly batchSize: number;
    private readonly cleanupInterval: number;
    private readonly staleThreshold: number;
    private readonly operationTimeoutMs: number;
    private eventBuffer: CircularBuffer<AnyEvent>;

    constructor(
        private context: WorkflowContext,
        private observability: ObservabilitySystem,
        config: OptimizedEventProcessorConfig = {},
    ) {
        this.maxDepth = config.maxEventDepth ?? 100;
        this.maxChainLength = config.maxEventChainLength ?? 1000;
        this.enableObservability = config.enableObservability ?? true;

        // Separar middlewares em pipeline e handler
        const { pipelineMiddlewares, handlerMiddlewares } = separateMiddlewares(
            config.middleware ?? [],
        );
        this.pipelineMiddlewares = pipelineMiddlewares;
        this.handlerMiddlewares = handlerMiddlewares;

        this.batchSize = config.batchSize ?? 100;
        this.cleanupInterval = config.cleanupInterval ?? 2 * 60 * 1000; // 2 minutos
        this.staleThreshold = config.staleThreshold ?? 10 * 60 * 1000; // 10 minutos
        this.operationTimeoutMs =
            config.operationTimeoutMs ?? DEFAULT_TIMEOUT_MS;

        this.handlerMap = this.createOptimizedHandlerMap();
        this.eventBuffer = createCircularBuffer<AnyEvent>(10000);
    }

    /**
     * Registrar handler com tracking
     */
    registerHandler(
        eventType: string,
        handler: EventHandler<AnyEvent, HandlerReturn>,
    ): void {
        const trackedHandler: TrackedEventHandler =
            handler as TrackedEventHandler;
        trackedHandler._handlerId = `${eventType}-${Date.now()}-${Math.random()}`;
        trackedHandler._isActive = true;

        // NÃO aplicar middlewares de handler aqui!
        // Apenas armazene o handler puro
        const enhancedHandler = trackedHandler;
        // (não aplicar middlewares de handler aqui)

        if (!this.handlerMap.exact.has(eventType)) {
            this.handlerMap.exact.set(eventType, []);
        }
        this.handlerMap.exact.get(eventType)!.push(enhancedHandler);
    }

    /**
     * Registrar handler wildcard
     */
    registerWildcardHandler(
        handler: EventHandler<AnyEvent, HandlerReturn>,
    ): void {
        const trackedHandler: TrackedEventHandler =
            handler as TrackedEventHandler;
        trackedHandler._handlerId = `wildcard-${Date.now()}-${Math.random()}`;
        trackedHandler._isActive = true;

        // NÃO aplicar middlewares de handler aqui!
        const enhancedHandler = trackedHandler;
        // (não aplicar middlewares de handler aqui)

        this.handlerMap.wildcard.push(enhancedHandler);
    }

    /**
     * Processar evento com todas as otimizações
     */
    async processEvent(event: AnyEvent): Promise<void> {
        this.observability.log(
            'debug',
            '🔍 EVENT PROCESSOR - Processing event',
            {
                eventId: event.id,
                eventType: event.type,
                processingDepth: this.processingDepth,
                correlationId: this.extractCorrelationId(event),
                trace: {
                    source: 'event-processor',
                    step: 'processEvent-start',
                    timestamp: Date.now(),
                },
            },
        );

        // Adicionar ao buffer circular
        pushToBuffer(this.eventBuffer, event);

        const processingContext: EventProcessingContext = {
            depth: this.processingDepth,
            eventChain: new EventChainTracker(this.maxChainLength),
            startTime: Date.now(),
            correlationId: this.extractCorrelationId(event),
        };

        try {
            if (this.processingDepth >= this.maxDepth) {
                throw new Error(`Max event depth exceeded: ${this.maxDepth}`);
            }

            // Observabilidade com trace
            if (this.enableObservability) {
                await this.observability.trace(
                    SPAN_NAMES.WORKFLOW_STEP,
                    async () => {
                        await this.processEventInternal(
                            event,
                            processingContext,
                        );
                    },
                    {
                        correlationId: processingContext.correlationId,
                        tenantId: this.context.tenantId,
                        attributes: {
                            [WORKFLOW.NAME]: 'event-processing',
                            [WORKFLOW.STEP]: event.type,
                            [WORKFLOW.EXECUTION_ID]: this.context.executionId,
                            eventType: event.type,
                            eventSize: (() => {
                                try {
                                    const str = JSON.stringify(event);
                                    return str ? str.length : 0;
                                } catch {
                                    return 0;
                                }
                            })(),
                        },
                    },
                );
            } else {
                await this.processEventInternal(event, processingContext);
            }
        } catch (error) {
            if (this.enableObservability) {
                this.observability.log('error', 'Event processing failed', {
                    error: (error as Error).message,
                    eventType: event.type,
                    depth: processingContext.depth,
                    chainLength: processingContext.eventChain.length,
                });
            }
            throw error;
        }
    }

    /**
     * Processamento interno otimizado
     */
    private async processEventInternal(
        event: AnyEvent,
        context: EventProcessingContext,
    ): Promise<void> {
        this.processingDepth++;
        context.eventChain.push(event.type);

        this.observability.log(
            'debug',
            '⚡ EVENT PROCESSOR - Internal processing',
            {
                eventId: event.id,
                eventType: event.type,
                processingDepth: this.processingDepth,
                chainLength: context.eventChain.length,
                correlationId: context.correlationId,
                trace: {
                    source: 'event-processor',
                    step: 'processEventInternal-start',
                    timestamp: Date.now(),
                },
            },
        );

        try {
            // Verificar loop infinito
            if (
                context.eventChain.includes(event.type) &&
                context.eventChain.length > 1
            ) {
                this.observability.log(
                    'error',
                    '❌ EVENT PROCESSOR - Event loop detected',
                    {
                        error: `Event loop detected: ${event.type}`,
                        eventId: event.id,
                        eventType: event.type,
                        eventChain: Array.from(
                            context.eventChain as unknown as Iterable<string>,
                        ),
                        trace: {
                            source: 'event-processor',
                            step: 'event-loop-detected',
                            timestamp: Date.now(),
                        },
                    },
                );
                throw new Error(`Event loop detected: ${event.type}`);
            }

            // Obter handlers otimizados (middleware de handler já aplicado no registro)
            const handlers = this.getHandlersOptimized(event.type);

            this.observability.log(
                'debug',
                '🔍 EVENT PROCESSOR - Handlers found',
                {
                    eventId: event.id,
                    eventType: event.type,
                    handlerCount: handlers.length,
                    batchSize: this.batchSize,
                    willUseBatch: handlers.length > this.batchSize,
                    trace: {
                        source: 'event-processor',
                        step: 'handlers-found',
                        timestamp: Date.now(),
                    },
                },
            );

            // Criar função de processamento dos handlers
            const processHandlers = async () => {
                // Processar handlers em batch se possível
                if (handlers.length > this.batchSize) {
                    await this.processHandlersBatch(handlers, event, context);
                } else {
                    await this.processHandlersSequential(
                        handlers,
                        event,
                        context,
                    );
                }
            };

            // Executar o processamento diretamente (middlewares aplicados individualmente)
            await processHandlers();
        } finally {
            this.processingDepth--;
            context.eventChain.pop();
        }
    }

    /**
     * Processar handlers em batch para performance
     */
    private async processHandlersBatch(
        handlers: TrackedEventHandler[],
        event: AnyEvent,
        context: EventProcessingContext,
    ): Promise<void> {
        const batches = this.chunkArray(handlers, this.batchSize);

        for (const batch of batches) {
            const results = await Promise.allSettled(
                batch.map((handler) =>
                    this.processHandlerWithMiddlewares(handler, event, context),
                ),
            );

            // Log de resultados para debug
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length > 0) {
                this.observability.log(
                    'warn',
                    `❌ EVENT PROCESSOR - ${failed.length}/${results.length} handlers failed`,
                    {
                        eventType: event.type,
                        failedCount: failed.length,
                        totalCount: results.length,
                        trace: {
                            source: 'event-processor',
                            step: 'handlers-failed',
                            timestamp: Date.now(),
                        },
                    },
                );
            }
        }
    }

    /**
     * Processar handlers sequencialmente
     */
    private async processHandlersSequential(
        handlers: TrackedEventHandler[],
        event: AnyEvent,
        _context: EventProcessingContext,
    ): Promise<void> {
        for (const handler of handlers) {
            await this.processHandlerWithMiddlewares(handler, event, _context);
        }
    }

    /**
     * Processar handler individual com middlewares aplicados
     */
    private async processHandlerWithMiddlewares(
        handler: TrackedEventHandler,
        event: AnyEvent,
        context: EventProcessingContext,
    ): Promise<void> {
        // Aplicar middlewares de handler primeiro
        let wrappedHandler: EventHandler<AnyEvent> = handler;
        for (const middleware of this.handlerMiddlewares) {
            wrappedHandler = middleware(wrappedHandler);
        }

        // Adaptador: handler sempre recebe (event, _signal?), mas chama só com (event)
        const adaptedHandler = (ev: AnyEvent, _signal?: AbortSignal) =>
            wrappedHandler(ev);

        // Aplicar middlewares de pipeline individualmente
        let pipeline = adaptedHandler;
        for (const middleware of this.pipelineMiddlewares) {
            pipeline = middleware(pipeline);
        }

        // Executar pipeline
        const result = await pipeline(event);

        // Atualizar timestamp de uso
        handler._lastUsed = Date.now();

        // Processar resultado se for evento
        if (this.isEvent(result)) {
            context.eventChain.push(result.type);
            await this.processEventInternal(result, context);
        }
    }

    /**
     * Verificar se o resultado é um evento
     */
    private isEvent(result: unknown): result is AnyEvent {
        return (
            result !== null &&
            result !== undefined &&
            typeof result === 'object' &&
            'type' in result &&
            typeof (result as AnyEvent).type === 'string'
        );
    }

    /**
     * Obter handlers otimizados
     */
    private getHandlersOptimized(eventType: string): TrackedEventHandler[] {
        const exact = this.handlerMap.exact.get(eventType) ?? [];
        const wildcard = this.handlerMap.wildcard;
        const patterns: TrackedEventHandler[] = [];

        // Pattern matching (futuro)
        for (const [pattern, handlers] of this.handlerMap.patterns) {
            if (pattern.test(eventType)) {
                patterns.push(...handlers);
            }
        }

        const allHandlers = [...exact, ...wildcard, ...patterns];

        // Atualizar timestamps
        const now = Date.now();
        allHandlers.forEach((handler) => {
            handler._lastUsed = now;
        });

        return allHandlers;
    }

    /**
     * Criar mapa otimizado de handlers
     */
    private createOptimizedHandlerMap(): OptimizedHandlerMap {
        const handlerMap: OptimizedHandlerMap = {
            exact: new Map(),
            wildcard: [],
            patterns: new Map(),
        };

        // Cleanup automático de handlers inativos
        handlerMap._cleanupTimer = setInterval(() => {
            this.cleanupStaleHandlers(handlerMap);
        }, this.cleanupInterval);

        return handlerMap;
    }

    /**
     * Limpar handlers inativos
     */
    private cleanupStaleHandlers(handlerMap: OptimizedHandlerMap): void {
        const now = Date.now();

        // Cleanup exact handlers
        for (const [eventType, handlers] of handlerMap.exact) {
            const activeHandlers = handlers.filter((handler) => {
                const isActive = handler._isActive !== false;
                const isRecent =
                    !handler._lastUsed ||
                    now - handler._lastUsed < this.staleThreshold;
                return isActive && isRecent;
            });

            if (activeHandlers.length === 0) {
                handlerMap.exact.delete(eventType);
            } else if (activeHandlers.length < handlers.length) {
                handlerMap.exact.set(eventType, activeHandlers);
            }
        }

        // Cleanup wildcard handlers
        handlerMap.wildcard = handlerMap.wildcard.filter((handler) => {
            const isActive = handler._isActive !== false;
            const isRecent =
                !handler._lastUsed ||
                now - handler._lastUsed < this.staleThreshold;
            return isActive && isRecent;
        });

        // Cleanup pattern handlers
        for (const [pattern, handlers] of handlerMap.patterns) {
            const activeHandlers = handlers.filter((handler) => {
                const isActive = handler._isActive !== false;
                const isRecent =
                    !handler._lastUsed ||
                    now - handler._lastUsed < this.staleThreshold;
                return isActive && isRecent;
            });

            if (activeHandlers.length === 0) {
                handlerMap.patterns.delete(pattern);
            } else if (activeHandlers.length < handlers.length) {
                handlerMap.patterns.set(pattern, activeHandlers);
            }
        }
    }

    /**
     * Dividir array em chunks
     */
    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Extrair correlation ID
     */
    private extractCorrelationId(event: AnyEvent): string | undefined {
        // ✅ CORREÇÃO: Procurar correlationId apenas em metadata (padrão Runtime)
        return event.metadata?.correlationId;
    }

    /**
     * Limpar recursos
     */
    clearHandlers(): void {
        this.handlerMap.exact.clear();
        this.handlerMap.wildcard = [];
        this.handlerMap.patterns.clear();

        if (this.handlerMap._cleanupTimer) {
            clearInterval(this.handlerMap._cleanupTimer);
        }
    }

    /**
     * Obter estatísticas detalhadas
     */
    getStats() {
        return {
            registeredHandlers: this.handlerMap.exact.size,
            wildcardHandlers: this.handlerMap.wildcard.length,
            patternHandlers: this.handlerMap.patterns.size,
            currentDepth: this.processingDepth,
            bufferSize: this.eventBuffer.size,
            bufferCapacity: this.eventBuffer.capacity,
            operationTimeoutMs: this.operationTimeoutMs,
        };
    }

    /**
     * Cleanup completo
     */
    async cleanup(): Promise<void> {
        this.clearHandlers();
        this.eventBuffer = createCircularBuffer<AnyEvent>(10000);
        this.processingDepth = 0;
    }

    /**
     * Get a snapshot of the most recently processed events (for observability)
     */
    getRecentEvents(limit: number = 50): Array<{
        eventId: string;
        eventType: string;
        timestamp: number;
        correlationId?: string;
    }> {
        const result: Array<{
            eventId: string;
            eventType: string;
            timestamp: number;
            correlationId?: string;
        }> = [];

        const count = Math.min(limit, this.eventBuffer.size);
        for (let i = 0; i < count; i++) {
            const index =
                (this.eventBuffer.tail - 1 - i + this.eventBuffer.capacity) %
                this.eventBuffer.capacity;
            const ev = this.eventBuffer.items[index];
            if (!ev) continue;
            result.push({
                eventId: ev.id,
                eventType: ev.type,
                timestamp: ev.ts,
                correlationId: ev.metadata?.correlationId,
            });
        }

        return result;
    }
}
