import { BaseSDKError } from './errors.js';
import {
    EnhancedErrorOptions,
    ErrorCode,
    ErrorDomain,
    ErrorSeverity,
    StructuredErrorResponse,
    UserImpact,
} from './types/allTypes.js';

// ✅ ENHANCED BASE ERROR
export abstract class EnhancedSDKError<
    T extends ErrorCode = ErrorCode,
> extends BaseSDKError<T> {
    public readonly severity: ErrorSeverity;
    public readonly domain: ErrorDomain;
    public readonly userImpact: UserImpact;
    public readonly userMessage?: string;
    public readonly recoveryHints: string[];
    public readonly tags: string[];
    public readonly id: string;
    public readonly timestamp: number;

    constructor(message: string, code: T, options: EnhancedErrorOptions = {}) {
        super({
            code,
            message,
            context: options.context,
            retryable: options.retryable,
            recoverable: options.recoverable,
        });

        this.severity = options.severity ?? 'medium';
        this.domain = options.domain ?? 'business';
        this.userImpact = options.userImpact ?? 'degraded';
        this.userMessage = options.userMessage;
        this.recoveryHints = options.recoveryHints ?? [];
        this.tags = options.tags ?? [];
        this.id = this.generateErrorId();
        this.timestamp = Date.now();
    }

    private generateErrorId(): string {
        return `${this.code}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // ✅ STRUCTURED RESPONSE
    toStructuredResponse(metadata: {
        component: string;
        tenantId: string;
        correlationId: string;
        version?: string;
        requestId?: string;
    }): StructuredErrorResponse {
        return {
            error: {
                id: this.id,
                code: this.code,
                message: this.message,
                severity: this.severity,
                domain: this.domain,
                userImpact: this.userImpact,
                correlationId: metadata.correlationId,
                timestamp: this.timestamp,
                userMessage: this.userMessage,
                retryable: this.retryable,
                recoverable: this.recoverable,
                recoveryHints: this.recoveryHints,
                tags: this.tags,
            },
            metadata: {
                component: metadata.component,
                tenantId: metadata.tenantId,
                version: metadata.version ?? '1.0.0',
                requestId: metadata.requestId,
            },
            context: this.context,
        };
    }

    // ✅ ENHANCED JSON
    toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            id: this.id,
            severity: this.severity,
            domain: this.domain,
            userImpact: this.userImpact,
            userMessage: this.userMessage,
            recoveryHints: this.recoveryHints,
            tags: this.tags,
            timestamp: this.timestamp,
        };
    }
}

// ✅ ENHANCED AGENT ERROR
export class EnhancedAgentError extends EnhancedSDKError<'AGENT_ERROR'> {
    constructor(message: string, options: EnhancedErrorOptions = {}) {
        super(message, 'AGENT_ERROR', {
            severity: 'high',
            domain: 'business',
            userImpact: 'degraded',
            retryable: true,
            recoverable: true,
            recoveryHints: [
                'Check agent configuration',
                'Verify input data',
                'Review tool availability',
            ],
            ...options,
        });
    }
}

// ✅ ENHANCED TOOL ERROR
export class EnhancedToolError extends EnhancedSDKError<'TOOL_ERROR'> {
    constructor(message: string, options: EnhancedErrorOptions = {}) {
        super(message, 'TOOL_ERROR', {
            severity: 'medium',
            domain: 'business',
            userImpact: 'degraded',
            retryable: true,
            recoverable: true,
            recoveryHints: [
                'Verify tool parameters',
                'Check tool availability',
                'Review permissions',
            ],
            ...options,
        });
    }
}

// ✅ ENHANCED KERNEL ERROR
export class EnhancedKernelError extends EnhancedSDKError<'KERNEL_INITIALIZATION_FAILED'> {
    constructor(message: string, options: EnhancedErrorOptions = {}) {
        super(message, 'KERNEL_INITIALIZATION_FAILED', {
            severity: 'critical',
            domain: 'infrastructure',
            userImpact: 'broken',
            retryable: false,
            recoverable: false,
            recoveryHints: [
                'Check system resources',
                'Verify configuration',
                'Contact support',
            ],
            ...options,
        });
    }
}

// ✅ ERROR FACTORY HELPERS
export class ErrorFactory {
    static agentExecutionFailed(
        agentName: string,
        reason: string,
        options?: Partial<EnhancedErrorOptions>,
    ): EnhancedAgentError {
        return new EnhancedAgentError(
            `Agent '${agentName}' execution failed: ${reason}`,
            {
                userMessage: `The ${agentName} agent encountered an issue and couldn't complete the task.`,
                tags: ['agent-execution', agentName],
                context: { agentName, reason },
                ...options,
            },
        );
    }

    static toolExecutionFailed(
        toolName: string,
        reason: string,
        options?: Partial<EnhancedErrorOptions>,
    ): EnhancedToolError {
        return new EnhancedToolError(
            `Tool '${toolName}' execution failed: ${reason}`,
            {
                userMessage: `The ${toolName} tool is temporarily unavailable.`,
                tags: ['tool-execution', toolName],
                context: { toolName, reason },
                ...options,
            },
        );
    }

    static systemOverloaded(
        component: string,
        options?: Partial<EnhancedErrorOptions>,
    ): EnhancedKernelError {
        return new EnhancedKernelError(
            `System component '${component}' is overloaded`,
            {
                severity: 'critical',
                userMessage:
                    'The system is currently experiencing high load. Please try again in a few moments.',
                recoveryHints: [
                    'Wait for system load to decrease',
                    'Reduce request frequency',
                    'Contact support if issue persists',
                ],
                tags: ['system-overload', component],
                context: { component },
                ...options,
            },
        );
    }
}
