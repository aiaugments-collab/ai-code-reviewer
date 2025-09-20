import { LoggerService } from '@nestjs/common';
import {
    Observable,
    defer,
    throwError,
    Observer,
    timer,
    MonoTypeOperatorFunction,
} from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { status as Status } from '@grpc/grpc-js';

/**
 * Custom error type to signify that the circuit breaker is open.
 * This allows consumers to differentiate between a failure from the underlying
 * operation and a deliberate rejection by the circuit breaker.
 */
export class CircuitBreakerOpenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = CircuitBreakerOpenError.name;
        // Ensure the prototype chain is correct
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Defines the possible states of the circuit breaker.
 */
export enum CircuitBreakerState {
    CLOSED, // Allows operations and counts failures.
    OPEN, // Rejects operations immediately.
    HALF_OPEN, // Allows a single "trial" operation.
}

/**
 * Configuration options for the circuit breaker operator.
 */
export interface CircuitBreakerOptions {
    /**
     * The percentage of failures (between 1 and 100) that will trip the circuit.
     * This is only considered after the `volumeThreshold` has been met.
     * @default 50
     */
    errorThresholdPercentage?: number;
    /**
     * The minimum number of calls within the rolling window before the
     * error percentage is calculated.
     * @default 50
     */
    volumeThreshold?: number;
    /**
     * The time in milliseconds to wait in the OPEN state
     * before transitioning to HALF_OPEN.
     * @default 60000 (60 seconds)
     */
    resetTimeout?: number;
    /**
     * An optional observer that gets notified when the circuit opens.
     */
    openObserver?: Partial<Observer<void>>;
    /**
     * An optional observer that gets notified when the circuit closes.
     */
    closeObserver?: Partial<Observer<void>>;
    /**
     * An optional observer that gets notified when the circuit becomes half-open.
     */
    halfOpenObserver?: Partial<Observer<void>>;
}

const grpcConnectionErrorCodes = [Status.UNAVAILABLE, Status.UNAUTHENTICATED];

/**
 * Represents a single Circuit Breaker instance with its own state.
 * This class encapsulates all logic for one circuit.
 */
class CircuitBreaker {
    private readonly serviceName: string;
    private state = CircuitBreakerState.CLOSED;
    private readonly options: Required<CircuitBreakerOptions>;
    // Stores the outcomes of the most recent calls (true for success, false for failure).
    private callHistory: boolean[] = [];

    constructor(
        serviceName: string,
        options?: CircuitBreakerOptions & {
            logger?: LoggerService;
        },
    ) {
        const { logger } = options || {};
        const logMethod = (msg: string) => {
            if (logger) {
                logger.error({
                    message: msg,
                    service: serviceName,
                    context: serviceName,
                });
            } else {
                console.error(`[${serviceName}] ${msg}`);
            }
        };

        // Set default options
        this.options = {
            errorThresholdPercentage: options?.errorThresholdPercentage ?? 50,
            volumeThreshold: options?.volumeThreshold ?? 50,
            resetTimeout: options?.resetTimeout ?? 60000,
            openObserver: options?.openObserver ?? {
                next: () => logMethod('Circuit opened'),
            },
            closeObserver: options?.closeObserver ?? {
                next: () => logMethod('Circuit closed'),
            },
            halfOpenObserver: options?.halfOpenObserver ?? {
                next: () => logMethod('Circuit half-open'),
            },
        };

        this.serviceName = serviceName;
    }

    /**
     * Records the outcome of a call and checks if the circuit should trip.
     * @param success The outcome of the call.
     */
    private recordCall(success: boolean): void {
        this.callHistory.push(success);

        // Keep the history window at the specified size.
        if (this.callHistory.length > this.options.volumeThreshold) {
            this.callHistory.shift();
        }

        // Only check for tripping if we have enough data points.
        if (this.callHistory.length < this.options.volumeThreshold) {
            return;
        }

        const failures = this.callHistory.filter((s) => s === false).length;
        const failureRate = (failures / this.callHistory.length) * 100;

        if (failureRate >= this.options.errorThresholdPercentage) {
            this.trip();
        }
    }

    /**
     * Trips the circuit, moving it to the OPEN state.
     */
    private trip(): void {
        if (this.state === CircuitBreakerState.OPEN) return;

        this.state = CircuitBreakerState.OPEN;
        this.options.openObserver?.next?.();

        timer(this.options.resetTimeout).subscribe(() => {
            this.state = CircuitBreakerState.HALF_OPEN;
            this.options.halfOpenObserver?.next?.();
        });
    }

    /**
     * Resets the circuit to the CLOSED state and clears history.
     */
    private reset(): void {
        this.state = CircuitBreakerState.CLOSED;
        this.callHistory = []; // Clear history on reset
        this.options.closeObserver?.next?.();
    }

    /**
     * Returns the RxJS pipeable operator for this circuit breaker instance.
     */
    public getOperator<T>(): MonoTypeOperatorFunction<T> {
        return (source: Observable<T>): Observable<T> => {
            return defer(() => {
                if (this.state === CircuitBreakerState.OPEN) {
                    return throwError(
                        () =>
                            new CircuitBreakerOpenError(
                                `Circuit for ${this.serviceName} is open`,
                            ),
                    );
                }

                return source.pipe(
                    tap({
                        next: () => {
                            if (this.state === CircuitBreakerState.HALF_OPEN)
                                this.reset();
                            else this.recordCall(true);
                        },
                        complete: () => {
                            if (this.state === CircuitBreakerState.HALF_OPEN)
                                this.reset();
                            else this.recordCall(true);
                        },
                    }),
                    catchError((err) => {
                        if (grpcConnectionErrorCodes.includes(err?.code)) {
                            this.recordCall(false); // only record as failure if it's a connection error
                        } else {
                            this.recordCall(true);
                        }

                        return throwError(() => err);
                    }),
                );
            });
        };
    }
}

/** Singleton Registry */
const breakers = new Map<string, CircuitBreaker>();

/**
 * Initializes a new shared circuit breaker for a service.
 * This should be called once per service (e.g., in onModuleInit).
 * @param serviceName The unique name of the service.
 * @param options Configuration options including an optional logger.
 */
export function initCircuitBreaker(
    serviceName: string,
    options?: CircuitBreakerOptions & { logger?: LoggerService },
): void {
    if (breakers.has(serviceName)) {
        // Optionally log a warning if trying to re-initialize
        options?.logger?.warn(
            `Circuit breaker for '${serviceName}' is already initialized.`,
        );
        return;
    }
    breakers.set(serviceName, new CircuitBreaker(serviceName, options));
}

/**
 * Retrieves the pipeable operator for a previously initialized circuit breaker.
 * @param serviceName The unique name of the service.
 * @returns An RxJS pipeable operator.
 */
export function circuitBreaker<T>(
    serviceName: string,
): MonoTypeOperatorFunction<T> {
    if (!breakers.has(serviceName)) {
        throw new Error(
            `Circuit breaker for '${serviceName}' has not been initialized. Call initCircuitBreaker first.`,
        );
    }
    return breakers.get(serviceName)!.getOperator<T>();
}
