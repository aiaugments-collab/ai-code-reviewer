import pino from 'pino';
import { LogLevel, LogContext, LogProcessor } from './types.js';

/**
 * Simple and robust logger implementation
 */

let pinoLogger: pino.Logger | null = null;
let globalLogProcessors: LogProcessor[] = [];

/**
 * Get or create Pino logger instance
 */
function getPinoLogger(): pino.Logger {
    if (!pinoLogger) {
        // Determine if we should use pretty printing
        const usePretty =
            process.env.NODE_ENV === 'development' ||
            process.env.LOG_FORMAT === 'pretty';

        const loggerConfig: pino.LoggerOptions = {
            level: process.env.LOG_LEVEL || 'info',
            formatters: {
                level: (label) => ({ level: label }),
            },
            serializers: {
                error: pino.stdSerializers.err,
                err: pino.stdSerializers.err,
                req: pino.stdSerializers.req,
                res: pino.stdSerializers.res,
            },
            redact: {
                paths: [
                    'password',
                    'token',
                    'secret',
                    'apiKey',
                    'authorization',
                    '*.password',
                    '*.token',
                    '*.secret',
                    '*.apiKey',
                    '*.authorization',
                    'req.headers.authorization',
                    'req.headers["x-api-key"]',
                ],
                censor: '[REDACTED]',
            },
            timestamp: pino.stdTimeFunctions.isoTime,
        };

        // Use pretty printing in development
        if (usePretty) {
            pinoLogger = pino({
                ...loggerConfig,
                transport: {
                    target: 'pino-pretty',
                    options: {
                        colorize: true,
                        translateTime: 'SYS:standard',
                        ignore: 'pid,hostname',
                    },
                },
            });
        } else {
            // Production: JSON format with performance optimizations
            pinoLogger = pino({
                ...loggerConfig,
                // Performance optimizations for production
                base: {
                    pid: process.pid,
                    hostname: undefined, // Remove hostname for smaller logs
                },
            });
        }
    }
    return pinoLogger;
}

/**
 * Simple logger class with Pino integration
 */
export class SimpleLogger {
    private logger: pino.Logger;

    constructor(component: string) {
        this.logger = getPinoLogger().child({
            component,
            service: 'kodus-observability',
        });
    }

    debug(message: string, context?: LogContext): void {
        const mergedContext = this.mergeContext(context);
        this.logger.debug(mergedContext, message);
        this.processLog('debug', message, mergedContext);
    }

    info(message: string, context?: LogContext): void {
        const mergedContext = this.mergeContext(context);
        this.logger.info(mergedContext, message);
        this.processLog('info', message, mergedContext);
    }

    warn(message: string, context?: LogContext): void {
        const mergedContext = this.mergeContext(context);
        this.logger.warn(mergedContext, message);
        this.processLog('warn', message, mergedContext);
    }

    error(message: string, error?: Error, context?: LogContext): void {
        const mergedContext = this.mergeContext(context);

        if (error) {
            const errorContext = {
                ...mergedContext,
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                },
            };
            this.logger.error(errorContext, message);
            this.processLog('error', message, errorContext, error);
        } else {
            this.logger.error(mergedContext, message);
            this.processLog('error', message, mergedContext);
        }
    }

    private mergeContext(context?: LogContext): LogContext | undefined {
        if (!context) {
            return undefined;
        }

        // Ensure we don't log huge objects that could impact performance
        const sanitized = this.sanitizeContext(context);

        // Add common fields that might be missing
        return {
            ...sanitized,
            timestamp: context.timestamp || new Date().toISOString(),
        };
    }

    private sanitizeContext(context: LogContext): LogContext {
        const sanitized: any = {};

        for (const [key, value] of Object.entries(context)) {
            if (typeof value === 'object' && value !== null) {
                // Limit object depth and size
                sanitized[key] = this.truncateObject(value);
            } else if (typeof value === 'string' && value.length > 1000) {
                // Truncate long strings
                sanitized[key] = value.substring(0, 1000) + '...';
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    private truncateObject(obj: any, depth = 0): any {
        if (depth > 3) return '[Object too deep]';

        if (Array.isArray(obj)) {
            return obj
                .slice(0, 10)
                .map((item) =>
                    typeof item === 'object'
                        ? this.truncateObject(item, depth + 1)
                        : item,
                );
        }

        if (typeof obj === 'object' && obj !== null) {
            const truncated: any = {};
            let count = 0;
            for (const [key, value] of Object.entries(obj)) {
                if (count >= 20) break; // Limit number of properties
                truncated[key] =
                    typeof value === 'object'
                        ? this.truncateObject(value, depth + 1)
                        : value;
                count++;
            }
            return truncated;
        }

        return obj;
    }

    /**
     * Log with structured performance timing
     */
    performance(
        operation: string,
        duration: number,
        context?: LogContext,
    ): void {
        this.info(`Performance: ${operation}`, {
            ...context,
            performance: {
                operation,
                duration,
                unit: 'ms',
            },
        });
    }

    /**
     * Log security-related events
     */
    security(message: string, context?: LogContext): void {
        this.warn(`SECURITY: ${message}`, {
            ...context,
            security: true,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Log business metrics
     */
    business(event: string, data: Record<string, any>): void {
        this.info(`BUSINESS: ${event}`, {
            business: {
                event,
                ...data,
            },
        });
    }

    private processLog(
        level: LogLevel,
        message: string,
        context?: LogContext,
        error?: Error,
    ): void {
        for (const processor of globalLogProcessors) {
            try {
                processor.process(level, message, context, error);
            } catch (processorError) {
                console.error('Log processor failed:', processorError);
            }
        }
    }
}

/**
 * Create a logger instance
 */
export function createLogger(component: string): SimpleLogger {
    return new SimpleLogger(component);
}

/**
 * Add a log processor
 */
export function addLogProcessor(processor: LogProcessor): void {
    globalLogProcessors.push(processor);
}

/**
 * Remove a log processor
 */
export function removeLogProcessor(processor: LogProcessor): void {
    const index = globalLogProcessors.indexOf(processor);
    if (index > -1) {
        globalLogProcessors.splice(index, 1);
    }
}

/**
 * Clear all log processors
 */
export function clearLogProcessors(): void {
    globalLogProcessors = [];
}
