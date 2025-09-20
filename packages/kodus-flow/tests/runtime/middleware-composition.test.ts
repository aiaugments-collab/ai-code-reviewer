import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { createWorkflowContext } from '../../src/core/context/index.js';
import { getObservability } from '../../src/observability/index.js';
import {
    withRetry,
    withTimeout,
    withConcurrency,
    withValidateMiddleware,
} from '../../src/runtime/middleware/index.js';
import { z } from 'zod';
import type { AnyEvent } from '../../src/core/types/events.js';
import type { EventStream } from '../../src/core/types/common-types.js';

describe('Middleware Composition', () => {
    let runtime: ReturnType<typeof createRuntime>;
    let context: ReturnType<typeof createWorkflowContext>;
    let observability: ReturnType<typeof getObservability>;

    beforeEach(() => {
        observability = getObservability({ environment: 'test' });
        context = createWorkflowContext({
            executionId: 'test-execution',
            tenantId: 'test-tenant',
            startTime: Date.now(),
            status: 'RUNNING',
            stream: {
                [Symbol.asyncIterator]: async function* () {},
                filter: () =>
                    ({
                        [Symbol.asyncIterator]: async function* () {},
                    }) as unknown as EventStream<AnyEvent>,
                map: () =>
                    ({
                        [Symbol.asyncIterator]: async function* () {},
                    }) as unknown as EventStream<AnyEvent>,
                until: () =>
                    ({
                        [Symbol.asyncIterator]: async function* () {},
                    }) as unknown as EventStream<AnyEvent>,
                takeUntil: () =>
                    ({
                        [Symbol.asyncIterator]: async function* () {},
                    }) as unknown as EventStream<AnyEvent>,
                toArray: () => Promise.resolve([]),
                withMiddleware: () =>
                    ({
                        [Symbol.asyncIterator]: async function* () {},
                    }) as unknown as EventStream<AnyEvent>,
                debounce: () =>
                    ({
                        [Symbol.asyncIterator]: async function* () {},
                    }) as unknown as EventStream<AnyEvent>,
                throttle: () =>
                    ({
                        [Symbol.asyncIterator]: async function* () {},
                    }) as unknown as EventStream<AnyEvent>,
                batch: () =>
                    ({
                        [Symbol.asyncIterator]: async function* () {},
                    }) as unknown as EventStream<AnyEvent>,
                merge: () =>
                    ({
                        [Symbol.asyncIterator]: async function* () {},
                    }) as unknown as EventStream<AnyEvent>,
                combineLatest: () =>
                    ({
                        [Symbol.asyncIterator]: async function* () {},
                    }) as unknown as EventStream<AnyEvent>,
            } as EventStream<AnyEvent>,
            sendEvent: async () => {},
            emit: () => {},
            resourceManager: {
                addTimer: () => {},
                addInterval: () => {},
                addCleanupCallback: () => {},
                removeTimer: () => false,
                removeInterval: () => false,
                removeCleanupCallback: () => false,
            },
            pause: async () => '',
            resume: async () => {},
        });
    });

    afterEach(() => {
        if (runtime) {
            runtime.clear();
        }
    });

    describe('Basic Middleware Composition', () => {
        it('should compose multiple middlewares in order', async () => {
            const executionOrder: string[] = [];

            runtime = createRuntime(context, observability, {
                middleware: [
                    withRetry({ maxRetries: 2, initialDelayMs: 10 }),
                    withTimeout({ timeoutMs: 1000 }),
                    withConcurrency({ maxConcurrent: 5 }),
                ],
            });

            runtime.on('test.event', async (_event) => {
                executionOrder.push('handler');
            });

            await runtime.emitAsync('test.event', { data: 'test' });
            await runtime.process();

            expect(executionOrder).toContain('handler');
        });

        it('should handle middleware composition with validation', async () => {
            const schema = z.object({
                userId: z.string(),
                name: z.string(),
            });

            runtime = createRuntime(context, observability, {
                middleware: [
                    withValidateMiddleware(schema),
                    withRetry({ maxRetries: 1 }),
                    withTimeout({ timeoutMs: 500 }),
                ],
            });

            let processedEvents = 0;

            runtime.on('user.created', async (_event) => {
                processedEvents++;
            });

            // Valid event
            await runtime.emitAsync('user.created', {
                userId: '123',
                name: 'John',
            });
            await runtime.process();

            expect(processedEvents).toBe(1);
        });

        it('should reject invalid events with validation middleware', async () => {
            const schema = z.object({
                userId: z.string(),
                name: z.string(),
            });

            runtime = createRuntime(context, observability, {
                middleware: [withValidateMiddleware(schema)],
            });

            let processedEvents = 0;

            runtime.on('user.created', async (_event) => {
                processedEvents++;
            });

            // Invalid event (missing required fields)
            await runtime.emitAsync('user.created', { userId: '123' }); // Missing 'name'
            await runtime.process();

            expect(processedEvents).toBe(0);
        });
    });

    describe('Retry Middleware Composition', () => {
        it('should retry failed operations with exponential backoff', async () => {
            let attemptCount = 0;

            runtime = createRuntime(context, observability, {
                middleware: [
                    withRetry({
                        maxRetries: 3,
                        initialDelayMs: 10,
                        retryableErrorCodes: ['NETWORK_ERROR'],
                    }),
                ],
            });

            runtime.on('test.retry', async (_event) => {
                attemptCount++;
                if (attemptCount < 3) {
                    const err = new Error('NETWORK_ERROR');
                    Object.assign(err, { code: 'NETWORK_ERROR' });
                    throw err;
                }
            });

            await runtime.emitAsync('test.retry', { data: 'test' });
            await runtime.process();

            expect(attemptCount).toBe(3);
        });

        it('should not retry non-retryable errors', async () => {
            let attemptCount = 0;

            runtime = createRuntime(context, observability, {
                middleware: [
                    withRetry({
                        maxRetries: 3,
                        initialDelayMs: 10,
                        retryableErrorCodes: ['NETWORK_ERROR'],
                    }),
                ],
            });

            runtime.on('test.nonretry', async (_event) => {
                attemptCount++;
                throw new Error('NON_RETRYABLE_ERROR');
            });

            await runtime.emitAsync('test.nonretry', { data: 'test' });
            await runtime.process();

            expect(attemptCount).toBe(1); // Should not retry
        });

        it('should compose retry with timeout', async () => {
            let attemptCount = 0;

            runtime = createRuntime(context, observability, {
                middleware: [
                    withRetry({ maxRetries: 2, initialDelayMs: 10 }),
                    withTimeout({ timeoutMs: 100 }),
                ],
            });

            runtime.on('test.retrytimeout', async (_event) => {
                attemptCount++;
                await new Promise((resolve) => setTimeout(resolve, 200)); // Longer than timeout
            });

            await runtime.emitAsync('test.retrytimeout', { data: 'test' });
            await runtime.process();

            expect(attemptCount).toBeLessThanOrEqual(2); // Should timeout before max retries
        });
    });

    describe('Timeout Middleware Composition', () => {
        it('should timeout long-running operations', async () => {
            let completed = false;

            runtime = createRuntime(context, observability, {
                middleware: [withTimeout({ timeoutMs: 50 })],
            });

            runtime.on('test.timeout', async (_event) => {
                await new Promise((resolve) => setTimeout(resolve, 200)); // Longer than timeout
                completed = true;
            });

            await runtime.emitAsync('test.timeout', { data: 'test' });
            await runtime.process();

            expect(completed).toBe(false); // Should timeout before completion
        });

        it('should allow fast operations to complete', async () => {
            let completed = false;

            runtime = createRuntime(context, observability, {
                middleware: [withTimeout({ timeoutMs: 1000 })],
            });

            runtime.on('test.fast', async (_event) => {
                await new Promise((resolve) => setTimeout(resolve, 10)); // Faster than timeout
                completed = true;
            });

            await runtime.emitAsync('test.fast', { data: 'test' });
            await runtime.process();

            expect(completed).toBe(true);
        });

        it('should compose timeout with concurrency', async () => {
            let concurrentCount = 0;
            let maxConcurrent = 0;

            runtime = createRuntime(context, observability, {
                middleware: [
                    withTimeout({ timeoutMs: 500 }),
                    withConcurrency({ maxConcurrent: 3 }),
                ],
            });

            runtime.on('test.concurrent', async (_event) => {
                concurrentCount++;
                maxConcurrent = Math.max(maxConcurrent, concurrentCount);
                await new Promise((resolve) => setTimeout(resolve, 100));
                concurrentCount--;
            });

            // Start multiple operations
            for (let i = 0; i < 5; i++) {
                await runtime.emitAsync('test.concurrent', {
                    data: `test-${i}`,
                });
            }
            await runtime.process();

            expect(maxConcurrent).toBeLessThanOrEqual(3);
        });
    });

    describe('Concurrency Middleware Composition', () => {
        it('should limit concurrent operations', async () => {
            let concurrentCount = 0;
            let maxConcurrent = 0;

            runtime = createRuntime(context, observability, {
                middleware: [withConcurrency({ maxConcurrent: 2 })],
            });

            runtime.on('test.concurrent', async (_event) => {
                concurrentCount++;
                maxConcurrent = Math.max(maxConcurrent, concurrentCount);
                await new Promise((resolve) => setTimeout(resolve, 50));
                concurrentCount--;
            });

            // Start multiple operations
            for (let i = 0; i < 4; i++) {
                await runtime.emitAsync('test.concurrent', {
                    data: `test-${i}`,
                });
            }
            await runtime.process();

            expect(maxConcurrent).toBeLessThanOrEqual(2);
        });

        it('should handle concurrency with different keys', async () => {
            let userConcurrent = 0;
            let orderConcurrent = 0;
            let maxUserConcurrent = 0;
            let maxOrderConcurrent = 0;

            runtime = createRuntime(context, observability, {
                middleware: [
                    withConcurrency({
                        maxConcurrent: 2,
                        getKey: (event) =>
                            event.type.split('.')[0] || 'default', // 'user' or 'order'
                    }),
                ],
            });

            runtime.on('user.created', async (_event) => {
                userConcurrent++;
                maxUserConcurrent = Math.max(maxUserConcurrent, userConcurrent);
                await new Promise((resolve) => setTimeout(resolve, 50));
                userConcurrent--;
            });

            runtime.on('order.placed', async (_event) => {
                orderConcurrent++;
                maxOrderConcurrent = Math.max(
                    maxOrderConcurrent,
                    orderConcurrent,
                );
                await new Promise((resolve) => setTimeout(resolve, 50));
                orderConcurrent--;
            });

            // Start operations for both types
            for (let i = 0; i < 3; i++) {
                await runtime.emitAsync('user.created', {
                    userId: `user-${i}`,
                });
                await runtime.emitAsync('order.placed', {
                    orderId: `order-${i}`,
                });
            }
            await runtime.process();

            expect(maxUserConcurrent).toBeLessThanOrEqual(2);
            expect(maxOrderConcurrent).toBeLessThanOrEqual(2);
        });
    });

    describe('Validation Middleware Composition', () => {
        it('should validate event data with Zod schema', async () => {
            const userSchema = z.object({
                userId: z.string().min(1),
                email: z.string().email(),
                age: z.number().min(18),
            });

            runtime = createRuntime(context, observability, {
                middleware: [withValidateMiddleware(userSchema)],
            });

            let validEvents = 0;

            runtime.on('user.created', async (_event) => {
                validEvents++;
            });

            // Valid event
            await runtime.emitAsync('user.created', {
                userId: '123',
                email: 'test@example.com',
                age: 25,
            });

            // Invalid event
            await runtime.emitAsync('user.created', {
                userId: '',
                email: 'invalid-email',
                age: 15,
            });

            await runtime.process();

            expect(validEvents).toBe(1);
        });

        it('should compose validation with other middlewares', async () => {
            const schema = z.object({
                value: z.number().positive(),
            });

            runtime = createRuntime(context, observability, {
                middleware: [
                    withValidateMiddleware(schema),
                    withRetry({ maxRetries: 1 }),
                    withTimeout({ timeoutMs: 100 }),
                ],
            });

            let processedEvents = 0;

            runtime.on('test.validated', async (_event) => {
                processedEvents++;
            });

            // Valid event
            await runtime.emitAsync('test.validated', { value: 42 });
            await runtime.process();

            expect(processedEvents).toBe(1);
        });
    });

    describe('Complex Middleware Pipelines', () => {
        it('should handle complex middleware composition', async () => {
            const userSchema = z.object({
                userId: z.string(),
                email: z.string().email(),
            });

            let processedEvents = 0;
            let maxConcurrent = 0;
            let concurrentCount = 0;

            runtime = createRuntime(context, observability, {
                middleware: [
                    withValidateMiddleware(userSchema),
                    withRetry({ maxRetries: 2, initialDelayMs: 10 }),
                    withTimeout({ timeoutMs: 500 }),
                    withConcurrency({
                        maxConcurrent: 3,
                        getKey: (event) => event.type,
                        queueTimeoutMs: 1000,
                    }),
                ],
            });

            runtime.on('user.created', async (_event) => {
                concurrentCount++;
                maxConcurrent = Math.max(maxConcurrent, concurrentCount);
                await new Promise((resolve) => setTimeout(resolve, 50));
                concurrentCount--;
                processedEvents++;
            });

            // Start multiple operations
            for (let i = 0; i < 5; i++) {
                await runtime.emitAsync('user.created', {
                    userId: `user-${i}`,
                    email: `user${i}@example.com`,
                });
            }
            await runtime.process();

            expect(processedEvents).toBe(5);
            expect(maxConcurrent).toBeLessThanOrEqual(3);
        });

        it('should handle middleware errors gracefully', async () => {
            let errorCount = 0;
            let successCount = 0;

            runtime = createRuntime(context, observability, {
                middleware: [
                    withRetry({ maxRetries: 1 }),
                    withTimeout({ timeoutMs: 100 }),
                ],
            });

            runtime.on('test.error', async (event) => {
                const data = event.data as { shouldFail?: boolean };
                if (data.shouldFail) {
                    errorCount++;
                    throw new Error('Simulated error');
                } else {
                    successCount++;
                }
            });

            // Mix of successful and failing events
            await runtime.emitAsync('test.error', { shouldFail: false });
            await runtime.emitAsync('test.error', { shouldFail: true });
            await runtime.emitAsync('test.error', { shouldFail: false });

            await runtime.process();

            expect(successCount).toBe(2);
            expect(errorCount).toBe(1);
        });
    });

    describe('Middleware Performance', () => {
        it('should handle high-throughput with middleware', async () => {
            const startTime = performance.now();

            runtime = createRuntime(context, observability, {
                middleware: [
                    withRetry({ maxRetries: 1, initialDelayMs: 1 }),
                    withTimeout({ timeoutMs: 1000 }),
                    withConcurrency({
                        maxConcurrent: 10,
                        queueTimeoutMs: 30000,
                    }),
                ],
                maxEventDepth: 2000, // Aumentar limite de profundidade para 1000 eventos
            });

            let processedCount = 0;

            runtime.on('test.performance', async (_event) => {
                processedCount++;
            });

            // Process 1000 events
            for (let i = 0; i < 1000; i++) {
                await runtime.emitAsync('test.performance', { index: i });
            }
            await runtime.process();

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(processedCount).toBe(1000);
            expect(duration).toBeLessThan(2000); // Should complete in reasonable time
        });

        it('should handle memory efficiently with middleware', async () => {
            const initialMemory = process.memoryUsage().heapUsed;

            runtime = createRuntime(context, observability, {
                middleware: [
                    withRetry({ maxRetries: 1 }),
                    withTimeout({ timeoutMs: 1000 }),
                    withConcurrency({ maxConcurrent: 5 }),
                ],
            });

            runtime.on('test.memory', async (_event) => {
                // Empty handler
            });

            // Process many events
            for (let i = 0; i < 1000; i++) {
                await runtime.emitAsync('test.memory', { index: i });
            }
            await runtime.process();

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
        });
    });

    describe('Middleware Configuration', () => {
        it('should handle different middleware configurations', async () => {
            let retryCount = 0;
            let timeoutCount = 0;

            runtime = createRuntime(context, observability, {
                middleware: [
                    withRetry({
                        maxRetries: 5,
                        initialDelayMs: 5,
                        retryableErrorCodes: ['NETWORK_ERROR'],
                    }),
                    withTimeout({ timeoutMs: 500 }),
                ],
            });

            runtime.on('test.config', async (event) => {
                const data = event.data as { type?: string };
                if (data.type === 'retry') {
                    retryCount++;
                    const error = new Error('NETWORK_ERROR');
                    Object.assign(error, { code: 'NETWORK_ERROR' });
                    throw error;
                } else if (data.type === 'timeout') {
                    timeoutCount++;
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
            });

            await runtime.emitAsync('test.config', { type: 'retry' });
            await runtime.emitAsync('test.config', { type: 'timeout' });

            await runtime.process();

            expect(retryCount).toBe(6); // Initial + 5 retries
            expect(timeoutCount).toBe(1); // Should timeout
        });
    });
});
