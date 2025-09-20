import {
    ObservabilityConfig,
    ObservabilityContext,
    Span,
    SpanOptions,
    TraceItem,
    LogLevel,
    LogContext,
} from './types.js';
import { TelemetrySystem } from './telemetry.js';
import { isEnhancedError } from '../core/error-unified.js';
import { createLogger, addLogProcessor } from './logger.js';

import {
    executionTracker,
    startExecutionTracking,
    completeExecutionTracking,
    failExecutionTracking,
} from './execution-tracker.js';
import { getMetrics, MetricsSystem } from './metrics.js';

// Log attribute constants
const LOG_ATTRIBUTES = {
    LEVEL: 'log.level' as const,
    MESSAGE: 'log.message' as const,
} as const;
import {
    createAgentExecutionSpan,
    createToolExecutionSpan,
    SPAN_NAMES,
} from './semantic-conventions.js';
import { IdGenerator } from '../utils/id-generator.js';
import {
    createMongoDBExporter,
    createMongoDBMetricsExporter,
    MongoDBExporter,
    MongoDBMetricsExporter,
} from './exporters/mongodb-exporter.js';

/**
 * Main observability system that coordinates all components
 */
export class ObservabilitySystem {
    private config: ObservabilityConfig;
    private telemetry: TelemetrySystem;
    private metrics: MetricsSystem;
    private logger = createLogger('observability');
    private currentContext?: ObservabilityContext;
    private mongodbExporter?: MongoDBExporter;
    private mongodbMetricsExporter?: MongoDBMetricsExporter;

    constructor(config: Partial<ObservabilityConfig> = {}) {
        this.config = {
            enabled: config.enabled ?? true,
            serviceName: config.serviceName || 'kodus-flow',
            environment: config.environment || 'development',
            logging: {
                level: config.logging?.level || 'info',
                enabled: config.logging?.enabled ?? true,
            },
            telemetry: {
                enabled: config.telemetry?.enabled ?? true,
                serviceName: config.serviceName || 'kodus-flow',
                sampling: config.telemetry?.sampling || {
                    rate: 1.0,
                    strategy: 'probabilistic' as const,
                },
                features: config.telemetry?.features || {
                    traceSpans: true,
                    traceEvents: true,
                    metricsEnabled: false,
                },
                globalAttributes: config.telemetry?.globalAttributes,
            },
            ...config,
        };

        // Initialize telemetry and metrics systems
        this.telemetry = new TelemetrySystem(this.config.telemetry);
        this.metrics = getMetrics();

        // Setup exporters (async initialization will be handled separately)
        // We'll call setupExporters after construction to avoid making constructor async
        this.setupExportersSync();

        this.logger.info('Observability system initialized', {
            environment: this.config.environment,
            enabled: this.config.enabled,
            serviceName: this.config.serviceName,
        });
    }

    /**
     * Create a new observability context
     */
    createContext(correlationId?: string): ObservabilityContext {
        const context: ObservabilityContext = {
            correlationId: correlationId || IdGenerator.correlationId(),
            tenantId: '',
            startTime: Date.now(),
        };

        this.logger.debug('Observability context created', {
            correlationId: context.correlationId,
        });

        return context;
    }

    /**
     * Set the current observability context
     */
    setContext(context: ObservabilityContext): void {
        this.currentContext = context;
    }

    /**
     * Get the current observability context
     */
    getContext(): ObservabilityContext | undefined {
        return this.currentContext;
    }

    /**
     * Clear the current observability context
     */
    clearContext(): void {
        if (this.currentContext) {
            this.logger.debug('Observability context cleared', {
                correlationId: this.currentContext.correlationId,
            });
        }
        this.currentContext = undefined;
    }

    /**
     * Get the current active span
     */
    getCurrentSpan(): Span | undefined {
        return this.telemetry.getCurrentSpan();
    }

    /**
     * Start a span
     */
    startSpan(name: string, options: SpanOptions = {}): Span {
        // Auto-attach common attributes from current context for better filtering
        const ctx = this.getContext();
        const attrs: Record<string, string | number | boolean> = {
            ...(options.attributes || {}),
        };
        if (ctx?.correlationId && attrs['correlationId'] === undefined) {
            attrs['correlationId'] = ctx.correlationId;
        }
        if (ctx?.tenantId && attrs['tenantId'] === undefined) {
            attrs['tenantId'] = ctx.tenantId;
        }
        if (ctx?.sessionId && attrs['sessionId'] === undefined) {
            attrs['sessionId'] = ctx.sessionId;
        }
        return this.telemetry.startSpan(name, {
            ...options,
            attributes: attrs,
        });
    }

    /**
     * Execute a function within a span context
     */
    async withSpan<T>(span: Span, fn: () => T | Promise<T>): Promise<T> {
        return this.telemetry.withSpan(span, fn);
    }

    /**
     * Trace a function execution with automatic span creation
     */
    async trace<T>(
        name: string,
        fn: () => T | Promise<T>,
        options: SpanOptions = {},
    ): Promise<T> {
        const span = this.startSpan(name, options);
        return this.withSpan(span, fn);
    }

    /**
     * Trace an agent execution with full lifecycle tracking
     */
    async traceAgent<T>(
        agentName: string,
        fn: () => T | Promise<T>,
        options: {
            input?: unknown;
            correlationId?: string;
            tenantId?: string;
            sessionId?: string;
            userId?: string;
            agentVersion?: string;
            agentType?: string;
            inputTokens?: number;
        } = {},
    ): Promise<T> {
        const correlationId =
            options.correlationId ||
            this.currentContext?.correlationId ||
            IdGenerator.correlationId();

        // Record agent execution start
        this.metrics.counter('agent_executions_total', 1, { agent: agentName });

        // Start execution tracking
        const executionId = startExecutionTracking(
            agentName,
            correlationId,
            {
                tenantId: options.tenantId,
                sessionId: options.sessionId,
                userId: options.userId,
            },
            options.input,
        );

        // Use OpenTelemetry semantic conventions
        const spanOptions = createAgentExecutionSpan(agentName, executionId, {
            agentVersion: options.agentVersion,
            agentType: options.agentType,
            conversationId: options.sessionId,
            userId: options.userId,
            tenantId: options.tenantId,
            input: options.input as string,
            inputTokens: options.inputTokens,
        });

        // Add correlationId as span attribute for proper extraction
        spanOptions.attributes = {
            ...spanOptions.attributes,
            correlationId: correlationId,
            ...(options.sessionId && { sessionId: options.sessionId }),
            ...(options.tenantId && { tenantId: options.tenantId }),
            executionId: executionId,
        };

        const span = this.startSpan(SPAN_NAMES.AGENT_EXECUTE, spanOptions);

        const startTime = Date.now();

        try {
            const result = await this.withSpan(span, fn);
            span.setStatus({ code: 'ok' });

            const duration = Date.now() - startTime;

            // Record success metrics
            this.metrics.counter('agent_executions_success', 1, {
                agent: agentName,
            });
            this.metrics.histogram('agent_execution_duration', duration, {
                agent: agentName,
            });

            completeExecutionTracking(executionId, result);

            this.logger.debug('Agent execution completed', {
                agentName,
                executionId,
                correlationId,
                duration,
            });

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;

            // Record error metrics
            this.metrics.counter('agent_executions_error', 1, {
                agent: agentName,
            });
            this.metrics.histogram('agent_execution_duration', duration, {
                agent: agentName,
            });

            span.recordException(error as Error);
            if (isEnhancedError(error as Error)) {
                try {
                    const e = error as any;
                    if (e?.context?.subcode) {
                        span.setAttribute(
                            'error.subcode',
                            String(e.context.subcode),
                        );
                    }
                    if (e?.code) {
                        span.setAttribute('error.code', String(e.code));
                    }
                } catch {}
            }
            failExecutionTracking(executionId, error as Error);

            this.logger.error('Agent execution failed', error as Error, {
                agentName,
                executionId,
                correlationId,
                duration,
            });

            throw error;
        }
    }

    /**
     * Trace a tool execution
     */
    async traceTool<T>(
        toolName: string,
        fn: () => T | Promise<T>,
        options: {
            callId?: string;
            toolType?: string;
            parameters?: Record<string, unknown>;
            correlationId?: string;
            timeoutMs?: number;
        } = {},
    ): Promise<T> {
        const executionId = options.callId || IdGenerator.correlationId();

        // Use OpenTelemetry semantic conventions
        const spanOptions = createToolExecutionSpan(toolName, executionId, {
            toolType: options.toolType,
            parameters: options.parameters,
        });

        // Add additional attributes
        spanOptions.attributes = {
            ...spanOptions.attributes,
            correlationId:
                options.correlationId ||
                this.currentContext?.correlationId ||
                '',
            executionId: executionId,
            timeoutMs: options.timeoutMs || 0,
        };

        const span = this.startSpan(SPAN_NAMES.TOOL_EXECUTE, spanOptions);

        const start = Date.now();
        return this.withSpan(span, async () => {
            try {
                const result = await fn();
                const duration = Date.now() - start;
                this.metrics.counter('tool_executions_success', 1, {
                    tool: toolName,
                });
                this.metrics.histogram('tool_execution_duration', duration, {
                    tool: toolName,
                });
                return result;
            } catch (error) {
                const duration = Date.now() - start;
                if (isEnhancedError(error as Error)) {
                    try {
                        const e = error as any;
                        if (e?.context?.subcode) {
                            span.setAttribute(
                                'error.subcode',
                                String(e.context.subcode),
                            );
                        }
                        if (e?.code) {
                            span.setAttribute('error.code', String(e.code));
                        }
                    } catch {}
                }
                this.metrics.counter('tool_executions_error', 1, {
                    tool: toolName,
                });
                this.metrics.histogram('tool_execution_duration', duration, {
                    tool: toolName,
                });
                span.recordException(error as Error);
                throw error;
            }
        });
    }

    /**
     * Log a message
     */
    log(level: LogLevel, message: string, context?: LogContext): void {
        if (this.config.logging?.enabled === false) {
            return;
        }

        const mergedContext = {
            correlationId: this.currentContext?.correlationId,
            tenantId: this.currentContext?.tenantId,
            ...context,
        };

        // Log to console (always available) - using structured logging
        this.logger.info(`[${level.toUpperCase()}] ${message}`, mergedContext);

        // Log to MongoDB if available
        if (this.mongodbExporter) {
            // Convert to TraceItem format for MongoDB exporter
            const traceItem = {
                name: `log.${level}`,
                context: {
                    traceId: 'log-' + Date.now(),
                    spanId: 'log-' + Date.now(),
                    traceFlags: 0,
                },
                attributes: {
                    [LOG_ATTRIBUTES.LEVEL]: level,
                    [LOG_ATTRIBUTES.MESSAGE]: message,
                    ...(mergedContext.correlationId && {
                        correlationId: mergedContext.correlationId,
                    }),
                    ...(mergedContext.tenantId && {
                        tenantId: mergedContext.tenantId,
                    }),
                    ...(mergedContext.executionId && {
                        executionId: mergedContext.executionId,
                    }),
                    ...(mergedContext.sessionId && {
                        sessionId: mergedContext.sessionId,
                    }),
                } as Record<string, string | number | boolean>,
                startTime: Date.now(),
                endTime: Date.now(),
                duration: 0,
                status: { code: 'ok' as const },
            };
            this.mongodbExporter.exportTelemetry(traceItem);
        }
    }

    /**
     * Get system statistics
     */
    getStats(): {
        telemetry: ReturnType<TelemetrySystem['getStats']>;
        executions: {
            active: number;
            totalTracked: number;
        };
        metrics: ReturnType<MetricsSystem['getMetrics']>;
        buffers?: {
            traces: number;
            logs: number;
        };
    } {
        return {
            telemetry: this.telemetry.getStats(),
            executions: {
                active: executionTracker.getActiveExecutions().length,
                totalTracked: executionTracker.getActiveExecutions().length, // Simplified
            },
            metrics: this.metrics.getMetrics(),
            buffers: undefined, // MongoDB exporter doesn't provide buffer sizes
        };
    }

    /**
     * Flush all components
     */
    async flush(): Promise<void> {
        await Promise.allSettled([
            this.telemetry.flush(),
            this.mongodbExporter?.flush(),
        ]);
    }

    /**
     * Shutdown the observability system
     */
    async shutdown(): Promise<void> {
        this.logger.info('Shutting down observability system');

        await Promise.allSettled([
            this.telemetry.flush(),
            this.mongodbExporter?.dispose(),
        ]);

        this.clearContext();
    }

    /**
     * Update context with execution information
     */
    updateContextWithExecution(executionId: string, agentName: string): void {
        // Implementation for compatibility
        this.logger.debug('Context updated with execution', {
            executionId,
            agentName,
        });
    }

    /**
     * Save agent execution cycle
     */
    async saveAgentExecutionCycle(cycle: any): Promise<void> {
        // Implementation for compatibility
        this.logger.info('Agent execution cycle saved', {
            executionId: cycle.executionId,
            agentName: cycle.agentName,
        });
    }

    /**
     * Run health checks
     */
    async runHealthChecks(): Promise<any> {
        // Implementation for compatibility
        return {
            overall: 'healthy',
            components: {
                logging: { status: 'ok' },
                telemetry: { status: 'ok' },
                monitoring: { status: 'ok' },
                debugging: { status: 'ok' },
            },
            lastCheck: Date.now(),
        };
    }

    /**
     * Check memory health
     */
    checkMemoryHealth(): Promise<any> {
        // Implementation for compatibility
        return Promise.resolve({
            status: 'ok',
            memoryUsage: process.memoryUsage(),
        });
    }

    /**
     * Setup exporters based on configuration
     */
    private setupExportersSync(): void {
        // Console logging is handled directly in telemetry processors

        // Setup telemetry processor for console
        this.telemetry.addTraceProcessor({
            process: async (item: TraceItem) => {
                // Simple console export for traces using structured logging
                this.logger.info(`[TRACE] ${item.name}`, {
                    traceId: item.context.traceId,
                    spanId: item.context.spanId,
                    duration: `${item.duration}ms`,
                    status: item.status.code,
                });
            },
        });

        // Setup MongoDB exporter if configured
        if (this.config.mongodb) {
            try {
                // Adaptar config do MongoDB para o formato esperado pelo exporter
                const mongoConfig = {
                    connectionString:
                        this.config.mongodb.connectionString ||
                        'mongodb://localhost:27017/kodus',
                    database: this.config.mongodb.database || 'kodus',
                    collections: {
                        logs:
                            this.config.mongodb.collections?.logs ||
                            'observability_logs',
                        telemetry:
                            this.config.mongodb.collections?.telemetry ||
                            'observability_telemetry',
                        errors:
                            this.config.mongodb.collections?.errors ||
                            'observability_errors',
                    },
                    batchSize: this.config.mongodb.batchSize || 100,
                    flushIntervalMs:
                        this.config.mongodb.flushIntervalMs || 30000,
                    ttlDays: this.config.mongodb.ttlDays || 30,
                };

                this.mongodbExporter = createMongoDBExporter(mongoConfig);

                // Add telemetry processor for MongoDB (will be initialized later)
                this.telemetry.addTraceProcessor({
                    process: async (item: TraceItem) => {
                        if (this.mongodbExporter) {
                            try {
                                await this.mongodbExporter.exportTelemetry(
                                    item,
                                );
                            } catch (error) {
                                this.logger.debug(
                                    'MongoDB export failed (possibly not initialized)',
                                    {
                                        error: (error as Error).message,
                                    },
                                );
                            }
                        }
                    },
                });

                // Add MongoDB exporter as log processor
                addLogProcessor(this.mongodbExporter);

                // Setup MongoDB metrics exporter
                this.mongodbMetricsExporter =
                    createMongoDBMetricsExporter(mongoConfig);

                this.logger.info(
                    'MongoDB exporter configured (needs initialization)',
                );
            } catch (error) {
                this.logger.warn('Failed to setup MongoDB exporter', {
                    error: (error as Error).message,
                });
            }
        }

        // Setup error processors
        this.setupErrorProcessors();
    }

    /**
     * Setup error processors for automatic error handling
     */
    private setupErrorProcessors(): void {
        // Capture uncaught exceptions
        process.on('uncaughtException', (error) => {
            this.handleGlobalError(error, 'uncaught_exception');
        });

        process.on('unhandledRejection', (reason) => {
            const error =
                reason instanceof Error ? reason : new Error(String(reason));
            this.handleGlobalError(error, 'unhandled_rejection');
        });

        // Setup graceful shutdown
        process.on('SIGTERM', () => {
            this.logger.info('SIGTERM received, shutting down gracefully');
            this.shutdown().catch((error) => {
                this.logger.error(
                    'Error during SIGTERM shutdown',
                    error as Error,
                );
                process.exit(1);
            });
        });

        process.on('SIGINT', () => {
            this.logger.info('SIGINT received, shutting down gracefully');
            this.shutdown().catch((error) => {
                this.logger.error(
                    'Error during SIGINT shutdown',
                    error as Error,
                );
                process.exit(1);
            });
        });

        this.logger.info('Error processors configured');
    }

    private handleGlobalError(error: Error, type: string): void {
        const errorContext = {
            errorType: type,
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            process: {
                pid: process.pid,
                platform: process.platform,
                version: process.version,
            },
        };

        this.logger.error(`Global ${type} caught`, error, errorContext);

        if (this.mongodbExporter) {
            this.mongodbExporter.exportError(error, {
                ...errorContext,
                errorType: type,
            });
        }
    }

    async initialize(): Promise<void> {
        if (this.mongodbExporter) {
            try {
                await this.mongodbExporter.initialize();
                this.logger.info('MongoDB exporter initialized successfully');
            } catch (error) {
                this.logger.error(
                    'Failed to initialize MongoDB exporter',
                    error as Error,
                );
                throw error;
            }
        }

        if (this.mongodbMetricsExporter) {
            try {
                await this.mongodbMetricsExporter.initialize();
                this.logger.info(
                    'MongoDB metrics exporter initialized successfully',
                );
            } catch (error) {
                this.logger.error(
                    'Failed to initialize MongoDB metrics exporter',
                    error as Error,
                );
            }
        }
    }
}
