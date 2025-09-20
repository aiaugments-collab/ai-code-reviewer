/**
 * Tests for Circuit Breaker
 */

import {
    describe,
    it,
    expect,
    vi,
    beforeEach,
    beforeAll,
    afterAll,
} from 'vitest';
import {
    CircuitBreaker,
    CircuitState,
} from '../../src/runtime/core/circuit-breaker.js';
import type { ObservabilitySystem } from '../../src/observability/index.js';

// Mock observability system
const mockObservability = {
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    monitoring: {
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        incrementCounter: vi.fn(),
    },
    telemetry: {
        startSpan: vi.fn(() => ({
            end: vi.fn(),
            setAttribute: vi.fn(() => ({ end: vi.fn() })),
            setAttributes: vi.fn(() => ({ end: vi.fn() })),
            setStatus: vi.fn(() => ({ end: vi.fn() })),
            recordException: vi.fn(() => ({ end: vi.fn() })),
            addEvent: vi.fn(() => ({ end: vi.fn() })),
            updateName: vi.fn(() => ({ end: vi.fn() })),
        })),
        recordException: vi.fn(),
    },
    config: {},
    monitor: {},
    debug: {},
    createContext: vi.fn(() => ({})),
    getContext: vi.fn(() => ({})),
    setContext: vi.fn(),
    clearContext: vi.fn(),
    addContext: vi.fn(),
    removeContext: vi.fn(),
    hasContext: vi.fn(() => false),
    getContextKeys: vi.fn(() => []),
    getContextValue: vi.fn(() => undefined),
    setContextValue: vi.fn(),
    clearContextValue: vi.fn(),
    addContextValue: vi.fn(),
    removeContextValue: vi.fn(),
    hasContextValue: vi.fn(() => false),
    getContextValues: vi.fn(() => []),
} as unknown as ObservabilitySystem;

describe('CircuitBreaker', () => {
    beforeAll(() => {
        vi.useFakeTimers();
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    let circuit: CircuitBreaker;

    beforeEach(() => {
        vi.clearAllMocks();
        circuit = new CircuitBreaker(mockObservability, {
            name: 'test-circuit',
            failureThreshold: 3,
            recoveryTimeout: 1000,
            successThreshold: 2,
            operationTimeout: 500,
        });
    });

    describe('Initialization', () => {
        it('should initialize with CLOSED state', () => {
            expect(circuit.getState()).toBe(CircuitState.CLOSED);
        });

        it('should use default configuration when not provided', () => {
            const defaultCircuit = new CircuitBreaker(mockObservability, {
                name: 'default-test',
            });

            expect(defaultCircuit.getState()).toBe(CircuitState.CLOSED);
        });
    });

    describe('State Management', () => {
        it('should transition to OPEN after failure threshold', async () => {
            // Simulate failures
            for (let i = 0; i < 3; i++) {
                try {
                    await circuit.execute(() =>
                        Promise.reject(new Error('Test failure')),
                    );
                } catch {
                    // Expected
                }
            }

            expect(circuit.getState()).toBe(CircuitState.OPEN);
        });

        it('should reject operations when OPEN', async () => {
            // Force open state
            circuit.forceOpen();

            const result = await circuit.execute(() =>
                Promise.resolve('success'),
            );

            expect(result.rejected).toBe(true);
            expect(result.executed).toBe(false);
            expect(result.error?.message).toContain('Circuit breaker is OPEN');
        });

        it('should transition to HALF_OPEN after recovery timeout', async () => {
            // Force open and wait for recovery
            circuit.forceOpen();

            // Fast forward time
            vi.advanceTimersByTime(1100);

            const result = await circuit.execute(() =>
                Promise.resolve('success'),
            );

            expect(circuit.getState()).toBe(CircuitState.HALF_OPEN);
            expect(result.executed).toBe(true);
            expect(result.rejected).toBe(false);
        });

        it('should transition to CLOSED after success threshold in HALF_OPEN', async () => {
            // Force open and wait for recovery
            circuit.forceOpen();
            vi.advanceTimersByTime(1100);

            // Execute successful operations
            for (let i = 0; i < 2; i++) {
                await circuit.execute(() => Promise.resolve('success'));
            }

            expect(circuit.getState()).toBe(CircuitState.CLOSED);
        });

        it('should return to OPEN on failure in HALF_OPEN state', async () => {
            // Force open and wait for recovery
            circuit.forceOpen();
            vi.advanceTimersByTime(1100);

            // Fail once in half-open
            try {
                await circuit.execute(() =>
                    Promise.reject(new Error('Test failure')),
                );
            } catch {
                // Expected
            }

            expect(circuit.getState()).toBe(CircuitState.OPEN);
        });
    });

    describe('Operation Execution', () => {
        it('should execute successful operations', async () => {
            const result = await circuit.execute(() =>
                Promise.resolve('success'),
            );

            expect(result.executed).toBe(true);
            expect(result.rejected).toBe(false);
            expect(result.result).toBe('success');
            expect(result.error).toBeUndefined();
        });

        it('should handle operation failures', async () => {
            const testError = new Error('Test error');
            const result = await circuit.execute(() =>
                Promise.reject(testError),
            );

            expect(result.executed).toBe(true);
            expect(result.rejected).toBe(false);
            expect(result.error).toBe(testError);
            expect(result.result).toBeUndefined();
        });

        it('should handle operation timeouts', async () => {
            const timeoutCircuit = new CircuitBreaker(mockObservability, {
                name: 'timeout-test',
                operationTimeout: 50, // 50ms timeout
            });

            // Start the operation
            const executePromise = timeoutCircuit.execute(
                () =>
                    new Promise(() => {
                        // Never resolve - this will cause timeout
                    }),
            );

            // Advance time to trigger timeout
            vi.advanceTimersByTime(60);

            const result = await executePromise;

            expect(result.executed).toBe(true);
            expect(result.rejected).toBe(false);
            expect(result.error?.message).toContain('Operation timeout');
            expect(result.state).toBe(CircuitState.CLOSED); // Should still be closed for single timeout
        });

        it('should reset failure count on success in CLOSED state', async () => {
            // Fail twice
            for (let i = 0; i < 2; i++) {
                try {
                    await circuit.execute(() =>
                        Promise.reject(new Error('Test failure')),
                    );
                } catch {
                    // Expected
                }
            }

            // Succeed once
            await circuit.execute(() => Promise.resolve('success'));

            // Fail again - should not open circuit yet
            try {
                await circuit.execute(() =>
                    Promise.reject(new Error('Test failure')),
                );
            } catch {
                // Expected
            }

            expect(circuit.getState()).toBe(CircuitState.CLOSED);
        });
    });

    describe('Manual Control', () => {
        it('should force open circuit', () => {
            circuit.forceOpen();
            expect(circuit.getState()).toBe(CircuitState.OPEN);
        });

        it('should force close circuit', () => {
            circuit.forceOpen();
            circuit.forceClose();
            expect(circuit.getState()).toBe(CircuitState.CLOSED);
        });

        it('should reset circuit', () => {
            circuit.forceOpen();
            circuit.reset();
            expect(circuit.getState()).toBe(CircuitState.CLOSED);
        });
    });

    describe('Metrics', () => {
        it('should track basic metrics', async () => {
            // Execute some operations
            await circuit.execute(() => Promise.resolve('success'));

            try {
                await circuit.execute(() =>
                    Promise.reject(new Error('Test failure')),
                );
            } catch {
                // Expected
            }

            const metrics = circuit.getMetrics();

            expect(metrics.totalCalls).toBe(2);
            expect(metrics.successfulCalls).toBe(1);
            expect(metrics.failedCalls).toBe(1);
            expect(metrics.rejectedCalls).toBe(0);
            expect(metrics.successRate).toBe(0.5);
            expect(metrics.failureRate).toBe(0.5);
        });

        it('should track rejected calls', async () => {
            circuit.forceOpen();

            await circuit.execute(() => Promise.resolve('success'));

            const metrics = circuit.getMetrics();

            expect(metrics.rejectedCalls).toBe(1);
            expect(metrics.totalCalls).toBe(1);
        });

        it('should track time in current state', async () => {
            const startTime = Date.now();

            // Force state change
            circuit.forceOpen();

            const metrics = circuit.getMetrics();

            expect(metrics.timeInCurrentState).toBeGreaterThanOrEqual(0);
            expect(metrics.timeInCurrentState).toBeLessThanOrEqual(
                Date.now() - startTime + 100,
            );
        });

        it('should track last failure and success', async () => {
            const testError = new Error('Test error');

            try {
                await circuit.execute(() => Promise.reject(testError));
            } catch {
                // Expected
            }

            await circuit.execute(() => Promise.resolve('success'));

            const metrics = circuit.getMetrics();

            expect(metrics.lastFailure?.error).toBe('Test error');
            expect(metrics.lastSuccess).toBeDefined();
        });
    });

    describe('State Checks', () => {
        it('should check if circuit is open', () => {
            expect(circuit.isOpen()).toBe(false);
            circuit.forceOpen();
            expect(circuit.isOpen()).toBe(true);
        });

        it('should check if circuit is closed', () => {
            expect(circuit.isClosed()).toBe(true);
            circuit.forceOpen();
            expect(circuit.isClosed()).toBe(false);
        });

        it('should check if circuit is half open', async () => {
            expect(circuit.isHalfOpen()).toBe(false);

            circuit.forceOpen();
            vi.advanceTimersByTime(1100);

            // This will trigger half-open state
            await circuit.execute(() => Promise.resolve('success'));

            expect(circuit.isHalfOpen()).toBe(true);
        });
    });

    describe('Callbacks', () => {
        it('should call onStateChange callback', async () => {
            const onStateChange = vi.fn();
            const testCircuit = new CircuitBreaker(mockObservability, {
                name: 'callback-test',
                onStateChange,
            });

            testCircuit.forceOpen();

            expect(onStateChange).toHaveBeenCalledWith(
                CircuitState.OPEN,
                CircuitState.CLOSED,
            );
        });

        it('should call onFailure callback', async () => {
            const onFailure = vi.fn();
            const testCircuit = new CircuitBreaker(mockObservability, {
                name: 'callback-test',
                onFailure,
            });

            try {
                await testCircuit.execute(() =>
                    Promise.reject(new Error('Test error')),
                );
            } catch {
                // Expected
            }

            expect(onFailure).toHaveBeenCalledWith(
                expect.any(Error),
                undefined,
            );
        });

        it('should call onSuccess callback', async () => {
            const onSuccess = vi.fn();
            const testCircuit = new CircuitBreaker(mockObservability, {
                name: 'callback-test',
                onSuccess,
            });

            await testCircuit.execute(() => Promise.resolve('success'));

            expect(onSuccess).toHaveBeenCalledWith('success', undefined);
        });
    });
});
