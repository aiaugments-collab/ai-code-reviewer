import {
    ILogService,
    LOG_SERVICE_TOKEN,
} from '@/core/domain/log/contracts/log.service.contracts';
import { trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/node';
import { ILog } from '@/core/domain/log/interfaces/log.interface';
import {
    ExecutionContext,
    Inject,
    Injectable,
    LoggerService,
} from '@nestjs/common';
import pino from 'pino';

type LogLevel = 'info' | 'error' | 'warn' | 'debug' | 'verbose';

interface LogArguments {
    message: string;
    context: ExecutionContext | string;
    serviceName?: string;
    error?: Error;
    metadata?: Record<string, any>;
}

const isProduction =
    (process.env.API_NODE_ENV || 'production') === 'production';
const shouldPrettyPrint = (process.env.API_LOG_PRETTY || 'false') === 'true';

@Injectable()
export class PinoLoggerService implements LoggerService {
    private logBuffer: Array<Omit<ILog, 'uuid'>> = [];
    private readonly MAX_BUFFER_SIZE = 50;
    private readonly FLUSH_INTERVAL_MS = 10000;
    private flushIntervalId: NodeJS.Timeout | null = null;

    private baseLogger = pino({
        level: process.env.API_LOG_LEVEL || 'info',
        transport:
            shouldPrettyPrint && !isProduction
                ? {
                      target: 'pino-pretty',
                      options: {
                          colorize: true,
                          translateTime: 'SYS:standard',
                          ignore: 'pid,hostname',
                          levelFirst: true,
                          errorProps: 'message,stack', // Includes the error stack in the output
                          messageFormat:
                              '{level} - {serviceName} - {context} - {msg}',
                      },
                  }
                : undefined,
        formatters: {
            level(label) {
                return { level: label };
            },
            log(object: any) {
                if (isProduction && !shouldPrettyPrint) {
                    // Cleaner log for production
                    return {
                        message: object.message,
                        serviceName: object.serviceName,
                        environment: object.environment,
                        error: object.error
                            ? { message: object?.error?.message }
                            : undefined,
                    };
                }
                return object;
            },
        },
        redact: [
            'password',
            'user.sensitiveInfo',
            'apiKey',
            'metadata.headers.authorization',
        ],
    });

    private extractContextInfo(context: ExecutionContext | string): string {
        if (typeof context === 'string') {
            return context;
        }
        // Se for ExecutionContext, tenta extrair a URL da requisição
        try {
            const request = context.switchToHttp().getRequest();
            return request.url || 'unknown';
        } catch (error) {
            return 'unknown';
        }
    }

    private createChildLogger(serviceName: string, context: string) {
        return this.baseLogger.child({
            serviceName,
            context,
        });
    }

    constructor(
        @Inject(LOG_SERVICE_TOKEN)
        private readonly logService: ILogService,
    ) {
        this.startFlushInterval();
    }

    private startFlushInterval(): void {
        if (this.flushIntervalId) {
            clearInterval(this.flushIntervalId);
        }
        this.flushIntervalId = setInterval(() => {
            this.flushLogs().catch((err) =>
                this.handleFlushError(err, '[Interval Flush]'),
            );
        }, this.FLUSH_INTERVAL_MS);
    }

    public stopFlushInterval(): void {
        if (this.flushIntervalId) {
            clearInterval(this.flushIntervalId);
            this.flushIntervalId = null;
        }
        this.flushLogs().catch((err) =>
            this.handleFlushError(err, '[Shutdown Flush]'),
        );
        console.log(
            '[PinoLoggerService] Flush interval stopped and final logs flushed.',
        );
    }

    private async flushLogs(): Promise<void> {
        if (this.logBuffer.length === 0) {
            return;
        }

        const logsToInsert = [...this.logBuffer];
        this.logBuffer = [];

        try {
            await this.logService.createMany(logsToInsert);
        } catch (error) {
            this.handleFlushError(error, '[Batch Insert Error]', logsToInsert);
        }
    }

    private handleFlushError(
        error: any,
        contextMessage: string,
        failedLogs?: Array<Omit<ILog, 'uuid'>>,
    ): void {
        console.error(
            `[PinoLoggerService] ${contextMessage}: Error flushing logs to MongoDB:`,
            error,
        );
        if (failedLogs && failedLogs.length > 0) {
            console.error(
                `[PinoLoggerService] ${contextMessage}: ${failedLogs.length} logs failed to insert. First few:`,
                JSON.stringify(failedLogs.slice(0, 3)),
            );
        }
    }

    // Para NestJS, implementar onModuleDestroy ou beforeApplicationShutdown
    async onModuleDestroy(): Promise<void> {
        // Ou beforeApplicationShutdown
        this.stopFlushInterval();
    }

    private async saveLogToDB(log: Omit<ILog, 'uuid'>) {
        const logData: Omit<ILog, 'uuid'> = {
            ...log,
        };

        this.logBuffer.push(logData);

        if (this.logBuffer.length >= this.MAX_BUFFER_SIZE) {
            this.flushLogs().catch((err) =>
                this.handleFlushError(err, '[Buffer Full Flush]'),
            );
        }
    }

    private getTraceContext() {
        const currentSpan = trace.getActiveSpan();

        if (!currentSpan) {
            return {
                traceId: null,
                spanId: null,
            };
        }

        const context = currentSpan.spanContext();

        return {
            traceId: context.traceId,
            spanId: context.spanId,
        };
    }

    public log({
        message,
        context,
        serviceName,
        error,
        metadata,
    }: LogArguments) {
        this.handleLog('info', {
            message,
            context,
            serviceName,
            error,
            metadata,
        });
    }

    public error({
        message,
        context,
        serviceName,
        error,
        metadata,
    }: LogArguments) {
        this.handleLog('error', {
            message,
            context,
            serviceName,
            error,
            metadata,
        });
    }

    public warn({
        message,
        context,
        serviceName,
        error,
        metadata,
    }: LogArguments) {
        this.handleLog('warn', {
            message,
            context,
            serviceName,
            error,
            metadata,
        });
    }

    public debug({
        message,
        context,
        serviceName,
        error,
        metadata,
    }: LogArguments) {
        this.handleLog('debug', {
            message,
            context,
            serviceName,
            error,
            metadata,
        });
    }

    public verbose({
        message,
        context,
        serviceName,
        error,
        metadata,
    }: LogArguments) {
        this.handleLog('verbose', {
            message,
            context,
            serviceName,
            error,
            metadata,
        });
    }

    private handleLog(
        level: LogLevel,
        { message, context, serviceName, error, metadata = {} }: LogArguments,
    ) {
        if (this.shouldSkipLog(context)) {
            return;
        }

        const contextStr = this.extractContextInfo(context);

        // Now we are correctly calling `createChildLogger`
        const childLogger = this.createChildLogger(
            serviceName || 'UnknownService',
            contextStr,
        );

        const logObject = this.buildLogObject(serviceName, metadata, error);

        if (error && level === 'error') {
            this.captureExceptionToSentry(error, message, metadata, logObject);
        }

        // Using the `childLogger` to log the messages
        childLogger[level](logObject, message);

        this.saveLogAsync({
            ...logObject,
            message,
            level,
            stack: logObject.error?.stack,
        });
    }

    private shouldSkipLog(context: ExecutionContext | string) {
        return (
            typeof context === 'undefined' ||
            (typeof context === 'string' &&
                ['RouterExplorer', 'RoutesResolver'].includes(context))
        );
    }

    private buildLogObject(
        serviceName: string,
        metadata: Record<string, any>,
        error?: Error,
    ) {
        const traceContext = this.getTraceContext();

        return {
            environment: process.env.API_NODE_ENV || 'unknown',
            serviceName,
            ...metadata,
            metadata,
            ...traceContext,
            error: error
                ? { message: error.message, stack: error.stack }
                : undefined,
        };
    }

    private captureExceptionToSentry(
        error: Error,
        message: string,
        metadata: Record<string, any>,
        logObject: any,
    ) {
        const safeMetadata = this.safeSerialize({ ...metadata, ...logObject });

        Sentry.withScope((scope) => {
            scope.setTag('environment', process.env.API_NODE_ENV || 'unknown');
            scope.setTag('level', 'error');
            scope.setTag('type', error.name);

            if (logObject?.traceId) {
                scope.setTag('traceId', logObject.traceId);
            }

            if (logObject?.spanId) {
                scope.setTag('spanId', logObject.spanId);
            }

            scope.setExtras({
                ...safeMetadata,
                message,
                stack: error.stack,
                name: error.name,
            });

            Sentry.captureException(error, {
                fingerprint: [error.name, error.message],
            });

            // Log de debug para verificar se o evento foi capturado
            console.log('Sentry event captured:', {
                error: error.message,
                traceId: logObject?.traceId,
                spanId: logObject?.spanId,
            });
        });
    }

    private safeSerialize(obj: Record<string, any>): Record<string, any> {
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch {
            return { error: 'Failed to serialize metadata for Sentry' };
        }
    }

    private saveLogAsync(log: Omit<ILog, 'uuid'>) {
        setImmediate(async () => {
            try {
                await this.saveLogToDB({
                    timestamp: new Date().toISOString(),
                    ...log,
                });
            } catch (error) {
                console.error('Failed to save log to DB:', error);
            }
        });
    }
}
