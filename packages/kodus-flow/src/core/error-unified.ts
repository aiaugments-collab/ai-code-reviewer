import {
    EnhancedAgentError,
    EnhancedKernelError,
    EnhancedToolError,
} from './enhanced-errors.js';
import { EngineError } from './errors.js';
import {
    EnhancedErrorOptions,
    ErrorDomain,
    ErrorSeverity,
} from './types/allTypes.js';

export class UnifiedErrorFactory {
    static createAgentError(
        message: string,
        options: EnhancedErrorOptions & { cause?: Error } = {},
    ): EnhancedAgentError {
        return new EnhancedAgentError(message, {
            severity: options.severity || 'medium',
            domain: options.domain || 'business',
            userImpact: options.userImpact || 'degraded',
            retryable: options.retryable ?? true,
            recoverable: options.recoverable ?? true,
            ...options,
        });
    }

    /**
     * Create tool error with enhanced features
     */
    static createToolError(
        message: string,
        options: EnhancedErrorOptions & { cause?: Error } = {},
    ): EnhancedToolError {
        return new EnhancedToolError(message, {
            severity: options.severity || 'medium',
            domain: options.domain || 'infrastructure',
            userImpact: options.userImpact || 'degraded',
            retryable: options.retryable ?? true,
            recoverable: options.recoverable ?? true,
            ...options,
        });
    }

    /**
     * Create kernel error with enhanced features
     */
    static createKernelError(
        message: string,
        options: EnhancedErrorOptions & { cause?: Error } = {},
    ): EnhancedKernelError {
        return new EnhancedKernelError(message, {
            severity: options.severity || 'high',
            domain: options.domain || 'infrastructure',
            userImpact: options.userImpact || 'broken',
            retryable: options.retryable ?? false,
            recoverable: options.recoverable ?? true,
            ...options,
        });
    }

    /**
     * Wrap existing Error into enhanced error
     */
    static wrapError(
        error: Error,
        domain: 'agent' | 'tool' | 'kernel' = 'agent',
        options: EnhancedErrorOptions = {},
    ): EnhancedAgentError | EnhancedToolError | EnhancedKernelError {
        const enhancedOptions = {
            cause: error,
            context: { originalError: error.message, stack: error.stack },
            ...options,
        };

        switch (domain) {
            case 'tool':
                return this.createToolError(
                    `Tool error: ${error.message}`,
                    enhancedOptions,
                );
            case 'kernel':
                return this.createKernelError(
                    `Kernel error: ${error.message}`,
                    enhancedOptions,
                );
            default:
                return this.createAgentError(
                    `Agent error: ${error.message}`,
                    enhancedOptions,
                );
        }
    }

    /**
     * Create enhanced error from EngineError (for backwards compatibility)
     */
    static fromEngineError(
        engineError: EngineError,
        options: EnhancedErrorOptions = {},
    ): EnhancedAgentError | EnhancedToolError | EnhancedKernelError {
        const errorType = engineError.code;
        const enhancedOptions = {
            context: {
                originalCode: errorType,
                correlationId: engineError.context?.correlationId as
                    | string
                    | undefined,
                metadata: engineError.context?.metadata as
                    | Record<string, unknown>
                    | undefined,
            },
            ...options,
        };

        if (errorType === 'TOOL_ERROR') {
            return this.createToolError(engineError.message, enhancedOptions);
        } else if (errorType.includes('KERNEL')) {
            return this.createKernelError(engineError.message, enhancedOptions);
        } else {
            return this.createAgentError(engineError.message, enhancedOptions);
        }
    }
}

// ✅ CONVENIENCE FUNCTIONS
export function createAgentError(
    message: string,
    options?: EnhancedErrorOptions,
): EnhancedAgentError {
    return UnifiedErrorFactory.createAgentError(message, options);
}

export function createToolError(
    message: string,
    options?: EnhancedErrorOptions,
): EnhancedToolError {
    return UnifiedErrorFactory.createToolError(message, options);
}

export function createKernelError(
    message: string,
    options?: EnhancedErrorOptions,
): EnhancedKernelError {
    return UnifiedErrorFactory.createKernelError(message, options);
}

export function wrapError(
    error: Error,
    domain: 'agent' | 'tool' | 'kernel' = 'agent',
    options?: EnhancedErrorOptions,
): EnhancedAgentError | EnhancedToolError | EnhancedKernelError {
    return UnifiedErrorFactory.wrapError(error, domain, options);
}

// ✅ ERROR CLASSIFICATION HELPERS
export function classifyErrorSeverity(error: Error): ErrorSeverity {
    if (error.message.includes('CRITICAL') || error.message.includes('FATAL')) {
        return 'critical';
    }
    if (
        error.message.includes('validation') ||
        error.message.includes('input')
    ) {
        return 'low';
    }
    if (error.message.includes('timeout') || error.message.includes('retry')) {
        return 'medium';
    }
    if (error.message.includes('KERNEL') || error.message.includes('SYSTEM')) {
        return 'high';
    }
    return 'medium';
}

export function classifyErrorDomain(error: Error): ErrorDomain {
    if (error.message.includes('security') || error.message.includes('auth')) {
        return 'security';
    }
    if (
        error.message.includes('timeout') ||
        error.message.includes('performance')
    ) {
        return 'performance';
    }
    if (
        error.message.includes('validation') ||
        error.message.includes('business')
    ) {
        return 'business';
    }
    return 'infrastructure';
}

// ✅ ERROR UPGRADE UTILITY
export function upgradeToEnhancedError(
    error: Error | EngineError,
): EnhancedAgentError | EnhancedToolError | EnhancedKernelError {
    if (error instanceof EngineError) {
        return UnifiedErrorFactory.fromEngineError(error);
    }

    const severity = classifyErrorSeverity(error);
    const domain = classifyErrorDomain(error);

    return UnifiedErrorFactory.wrapError(error, 'agent', { severity, domain });
}

// ✅ TYPE GUARDS
export function isEnhancedError(
    error: Error,
): error is EnhancedAgentError | EnhancedToolError | EnhancedKernelError {
    return (
        error instanceof EnhancedAgentError ||
        error instanceof EnhancedToolError ||
        error instanceof EnhancedKernelError
    );
}

export function isRecoverableError(error: Error): boolean {
    if (isEnhancedError(error)) {
        return error.recoverable;
    }
    // Default heuristics for non-enhanced errors
    return (
        !error.message.includes('FATAL') && !error.message.includes('CRITICAL')
    );
}

export function isRetryableError(error: Error): boolean {
    if (isEnhancedError(error)) {
        return error.retryable;
    }
    // Default heuristics for non-enhanced errors
    return (
        error.message.includes('timeout') ||
        error.message.includes('network') ||
        error.message.includes('temporary')
    );
}
