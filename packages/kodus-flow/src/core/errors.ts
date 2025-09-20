import {
    EngineErrorCode,
    ErrorCode,
    KernelErrorCode,
    MiddlewareErrorCode,
    OrchestrationErrorCode,
    RuntimeErrorCode,
    SDKErrorOptions,
} from './types/allTypes.js';

export abstract class BaseSDKError<
    T extends ErrorCode = ErrorCode,
> extends Error {
    public readonly code: T;
    public readonly cause?: Error | unknown;
    public readonly context?: Record<string, unknown>;
    public readonly recoverable: boolean;
    public readonly retryable: boolean;
    public readonly timestamp: number;

    constructor(options: SDKErrorOptions<T>) {
        super(options.message || `${options.code}`);
        this.code = options.code;
        this.cause = options.cause;
        this.context = options.context;
        this.recoverable = options.recoverable ?? false;
        this.retryable = options.retryable ?? false;
        this.timestamp = Date.now();

        // Capture stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /**
     * Convert error to JSON-serializable object
     */
    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            recoverable: this.recoverable,
            retryable: this.retryable,
            timestamp: this.timestamp,
            context: this.context,
            cause:
                this.cause instanceof Error
                    ? {
                          name: this.cause.name,
                          message: this.cause.message,
                          stack: this.cause.stack,
                      }
                    : this.cause,
            stack: this.stack,
        };
    }
}

/**
 * Kernel-specific errors
 */
export class KernelError extends BaseSDKError<KernelErrorCode> {
    constructor(
        code: KernelErrorCode,
        message?: string,
        options?: Omit<SDKErrorOptions<KernelErrorCode>, 'code' | 'message'>,
    ) {
        super({
            code,
            message: message || `Kernel error: ${code}`,
            ...options,
        });
        this.name = 'KernelError';
    }
}

/**
 * Runtime-specific errors
 */
export class RuntimeError extends BaseSDKError<RuntimeErrorCode> {
    constructor(
        code: RuntimeErrorCode,
        message?: string,
        options?: Omit<SDKErrorOptions<RuntimeErrorCode>, 'code' | 'message'>,
    ) {
        super({
            code,
            message: message || `Runtime error: ${code}`,
            ...options,
        });
        this.name = 'RuntimeError';
    }
}

/**
 * Engine-specific errors
 */
export class EngineError extends BaseSDKError<EngineErrorCode> {
    constructor(
        code: EngineErrorCode,
        message?: string,
        options?: Omit<SDKErrorOptions<EngineErrorCode>, 'code' | 'message'>,
    ) {
        super({
            code,
            message: message || `Engine error: ${code}`,
            ...options,
        });
        this.name = 'EngineError';
    }
}

/**
 * Middleware-specific errors
 */
export class MiddlewareError extends BaseSDKError<MiddlewareErrorCode> {
    constructor(
        code: MiddlewareErrorCode,
        message?: string,
        options?: Omit<
            SDKErrorOptions<MiddlewareErrorCode>,
            'code' | 'message'
        >,
    ) {
        super({
            code,
            message: message || `Middleware error: ${code}`,
            ...options,
        });
        this.name = 'MiddlewareError';
    }
}

/**
 * Orchestration-specific errors
 */
export class OrchestrationError extends BaseSDKError<OrchestrationErrorCode> {
    constructor(
        code: OrchestrationErrorCode,
        message?: string,
        options?: Omit<
            SDKErrorOptions<OrchestrationErrorCode>,
            'code' | 'message'
        >,
    ) {
        super({
            code,
            message: message || `Orchestration error: ${code}`,
            ...options,
        });
        this.name = 'OrchestrationError';
    }
}

/**
 * Error utility functions namespace
 */

/**
 * Check if an error is recoverable
 */
export function isErrorRecoverable(error: unknown): boolean {
    if (error instanceof BaseSDKError) {
        return error.recoverable;
    }
    // Network errors are usually recoverable
    if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code?: string }).code;
        return [
            'NETWORK_ERROR',
            'TIMEOUT_ERROR',
            'ECONNRESET',
            'ENOTFOUND',
        ].includes(code || '');
    }
    return false;
}

/**
 * Check if an error is retryable
 */
export function isErrorRetryable(error: unknown): boolean {
    if (error instanceof BaseSDKError) {
        return error.retryable;
    }
    // HTTP status codes that are retryable
    if (error && typeof error === 'object' && 'status' in error) {
        const status = (error as { status?: number }).status;
        return [408, 429, 500, 502, 503, 504].includes(status || 0);
    }
    return false;
}

/**
 * Wrap an unknown error into a SDK error
 */
export function wrapError(
    error: unknown,
    code: ErrorCode = 'UNKNOWN',
    context?: Record<string, unknown>,
): BaseSDKError {
    if (error instanceof BaseSDKError) {
        return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;

    // Determine error category and create appropriate error
    if (
        code.startsWith('KERNEL_') ||
        code.startsWith('RETRY_') ||
        code.startsWith('TIMEOUT_') ||
        ['ABORTED', 'VALIDATION_ERROR', 'UNKNOWN', 'INTERNAL_ERROR'].includes(
            code,
        )
    ) {
        return new KernelError(code as KernelErrorCode, message, {
            cause,
            context,
        });
    } else if (
        code.startsWith('RUNTIME_') ||
        code.startsWith('EVENT_') ||
        code.startsWith('CONTEXT_') ||
        [
            'WORKFLOW_ABORTED',
            'BUFFER_OVERFLOW',
            'HANDLER_NOT_FOUND',
            'STREAM_ERROR',
        ].includes(code)
    ) {
        return new RuntimeError(code as RuntimeErrorCode, message, {
            cause,
            context,
        });
    } else if (
        code.startsWith('ENGINE_') ||
        code.startsWith('AGENT_') ||
        code.startsWith('TOOL_') ||
        code.startsWith('WORKFLOW_') ||
        code === 'STEP_FAILED'
    ) {
        return new EngineError(code as EngineErrorCode, message, {
            cause,
            context,
        });
    } else if (
        code.startsWith('MIDDLEWARE_') ||
        code.startsWith('CONCURRENCY_') ||
        code.startsWith('SCHEDULE_') ||
        code.startsWith('STATE_')
    ) {
        return new MiddlewareError(code as MiddlewareErrorCode, message, {
            cause,
            context,
        });
    } else if (code.startsWith('ORCHESTRATION_')) {
        return new OrchestrationError(code as OrchestrationErrorCode, message, {
            cause,
            context,
        });
    }

    // Default to KernelError
    return new KernelError('UNKNOWN', message, { cause, context });
}

/**
 * Error utilities namespace for backward compatibility
 */
const errorUtils = {
    isRecoverable: isErrorRecoverable,
    isRetryable: isErrorRetryable,
    wrap: wrapError,
};

// Re-export with PascalCase for backward compatibility during transition
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ErrorUtils = errorUtils;
