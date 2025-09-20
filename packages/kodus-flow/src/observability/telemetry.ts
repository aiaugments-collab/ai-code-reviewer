import {
    TelemetryConfig,
    Span,
    SpanOptions,
    TraceItem,
    SpanProcessor,
} from './types.js';
import { SimpleTracer } from './core/tracer.js';
import { createLogger } from './logger.js';

/**
 * Simple and robust telemetry system
 */
export class TelemetrySystem {
    private config: TelemetryConfig;
    private tracer: SimpleTracer;
    private logger = createLogger('telemetry');
    private processors: SpanProcessor[] = [];
    private currentSpan?: Span;

    constructor(config: Partial<TelemetryConfig> = {}) {
        this.config = {
            enabled: true,
            serviceName: 'kodus-flow',
            sampling: {
                rate: 1.0,
                strategy: 'probabilistic',
                ...config.sampling,
            },
            features: {
                traceSpans: true,
                traceEvents: true,
                metricsEnabled: false, // Not implemented yet
                ...config.features,
            },
            globalAttributes: config.globalAttributes || {},
            ...config,
        };

        this.tracer = new SimpleTracer();

        this.logger.info('Telemetry system initialized', {
            enabled: this.config.enabled,
            serviceName: this.config.serviceName,
            samplingRate: this.config.sampling?.rate ?? 1.0,
        });
    }

    /**
     * Check if telemetry is enabled and should sample
     */
    isEnabled(): boolean {
        if (!this.config.enabled) {
            return false;
        }

        if (!this.config.features?.traceSpans) {
            return false;
        }

        if (this.config.sampling?.strategy === 'never') {
            return false;
        }

        if (this.config.sampling?.strategy === 'always') {
            return true;
        }

        // Probabilistic sampling
        return Math.random() < (this.config.sampling?.rate ?? 1.0);
    }

    /**
     * Start a new span
     */
    startSpan(name: string, options: SpanOptions = {}): Span {
        if (!this.isEnabled()) {
            return this.createNoOpSpan();
        }

        const finalAttributes: Record<string, string | number | boolean> = {
            serviceName: this.config.serviceName ?? 'unknown-service',
            ...this.config.globalAttributes,
            ...options.attributes,
        };

        // Auto-parent to current span when available and no parent provided
        const parentContext =
            options.parent || this.currentSpan?.getSpanContext();

        const span = this.tracer.startSpan(name, {
            ...options,
            parent: parentContext,
            attributes: finalAttributes,
        });

        this.currentSpan = span;

        return span;
    }

    /**
     * Execute a function within a span context
     */
    async withSpan<T>(span: Span, fn: () => T | Promise<T>): Promise<T> {
        const previousSpan = this.currentSpan;
        this.currentSpan = span;

        try {
            const result = await fn();
            span.setStatus({ code: 'ok' });
            return result;
        } catch (error) {
            span.recordException(error as Error);
            throw error;
        } finally {
            span.end();
            this.currentSpan = previousSpan;

            // Process the completed span
            const traceItem = span.toTraceItem();
            void this.processTraceItem(traceItem);
        }
    }

    /**
     * Get the current active span
     */
    getCurrentSpan(): Span | undefined {
        return this.currentSpan;
    }

    /**
     * Add a trace processor
     */
    addTraceProcessor(processor: SpanProcessor): void {
        this.processors.push(processor);
    }

    /**
     * Remove a trace processor
     */
    removeTraceProcessor(processor: SpanProcessor): void {
        const index = this.processors.indexOf(processor);
        if (index > -1) {
            this.processors.splice(index, 1);
        }
    }

    /**
     * Process a trace item through all processors
     */
    private async processTraceItem(item: TraceItem): Promise<void> {
        for (const processor of this.processors) {
            try {
                await processor.process(item);
            } catch (error) {
                this.logger.error('Trace processor failed', error as Error, {
                    processor: processor.constructor.name,
                    traceId: item.context.traceId,
                    spanId: item.context.spanId,
                });
            }
        }
    }

    /**
     * Flush all processors
     */
    async flush(): Promise<void> {
        for (const processor of this.processors) {
            try {
                if (processor.flush) {
                    await processor.flush();
                }
            } catch (error) {
                this.logger.error('Failed to flush processor', error as Error, {
                    processor: processor.constructor.name,
                });
            }
        }
    }

    /**
     * Get telemetry configuration
     */
    getConfig(): TelemetryConfig {
        return { ...this.config };
    }

    /**
     * Update telemetry configuration
     */
    updateConfig(config: Partial<TelemetryConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get telemetry statistics
     */
    getStats(): {
        activeSpans: number;
        processors: number;
        enabled: boolean;
        samplingRate: number;
    } {
        return {
            activeSpans: this.tracer.getActiveSpanCount(),
            processors: this.processors.length,
            enabled: this.config.enabled,
            samplingRate: this.config.sampling?.rate ?? 1.0,
        };
    }

    /**
     * Create a no-op span for when telemetry is disabled
     */
    private createNoOpSpan(): Span {
        return {
            setAttribute: () => this.createNoOpSpan(),
            setAttributes: () => this.createNoOpSpan(),
            setStatus: () => this.createNoOpSpan(),
            recordException: () => this.createNoOpSpan(),
            addEvent: () => this.createNoOpSpan(),
            end: () => {},
            getSpanContext: () => ({
                traceId: 'noop',
                spanId: 'noop',
                traceFlags: 0,
            }),
            isRecording: () => false,
            getName: () => 'noop',
            getKind: () => 'internal',
            getDuration: () => undefined,
            getAttributes: () => ({}),
            getEvents: () => [],
            getStatus: () => ({ code: 'ok' }),
            toTraceItem: () => ({
                name: 'noop',
                context: { traceId: 'noop', spanId: 'noop', traceFlags: 0 },
                attributes: {},
                startTime: Date.now(),
                endTime: Date.now(),
                duration: 0,
                status: { code: 'ok' },
            }),
        };
    }
}
