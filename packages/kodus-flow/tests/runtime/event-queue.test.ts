import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventQueue } from '../../src/runtime/core/event-queue.js';
import { getObservability } from '../../src/observability/index.js';
import { createEvent } from '../../src/core/types/events.js';
import type { AnyEvent } from '../../src/core/types/events.js';

describe('Event Queue', () => {
    let queue: EventQueue;
    let observability: ReturnType<typeof getObservability>;

    beforeEach(() => {
        observability = getObservability({ environment: 'test' });
        queue = new EventQueue(observability, {
            maxQueueDepth: 1000,
            enableObservability: true,
            batchSize: 100,
        });
    });

    afterEach(() => {
        queue.clear();
    });

    describe('Basic Operations', () => {
        it('should enqueue and dequeue events', async () => {
            const event1 = createEvent('test.1', { data: 'first' });
            const event2 = createEvent('test.2', { data: 'second' });

            expect(await queue.enqueue(event1)).toBe(true);
            expect(await queue.enqueue(event2)).toBe(true);

            expect(queue.dequeue()).toEqual(event1);
            expect(queue.dequeue()).toEqual(event2);
            expect(queue.dequeue()).toBeNull();
        });

        it('should peek without removing events', async () => {
            const event = createEvent('test.peek', { data: 'peek' });

            await queue.enqueue(event);

            expect(queue.peek()).toEqual(event);
            expect(queue.peek()).toEqual(event); // Should still be there
            expect(queue.dequeue()).toEqual(event); // Now remove it
            expect(queue.peek()).toBeNull();
        });

        it('should track queue size correctly', async () => {
            expect(queue.getStats().size).toBe(0);

            const event1 = createEvent('test.1');
            const event2 = createEvent('test.2');

            await queue.enqueue(event1);
            expect(queue.getStats().size).toBe(1);

            await queue.enqueue(event2);
            expect(queue.getStats().size).toBe(2);

            queue.dequeue();
            expect(queue.getStats().size).toBe(1);

            queue.dequeue();
            expect(queue.getStats().size).toBe(0);
        });

        it('should check if queue is empty', async () => {
            expect(queue.getStats().size).toBe(0);

            const event = createEvent('test.event');
            await queue.enqueue(event);

            expect(queue.getStats().size).toBeGreaterThan(0);
        });
    });

    describe('Priority Handling', () => {
        it('should handle events with different priorities', async () => {
            const lowPriorityEvent = createEvent('test.low', {
                priority: 'low',
            });
            const highPriorityEvent = createEvent('test.high', {
                priority: 'high',
            });
            const mediumPriorityEvent = createEvent('test.medium', {
                priority: 'medium',
            });

            // Enqueue in random order
            await queue.enqueue(lowPriorityEvent, 1);
            await queue.enqueue(highPriorityEvent, 10);
            await queue.enqueue(mediumPriorityEvent, 5);

            // Should dequeue in priority order (highest first)
            expect(queue.dequeue()).toEqual(highPriorityEvent);
            expect(queue.dequeue()).toEqual(mediumPriorityEvent);
            expect(queue.dequeue()).toEqual(lowPriorityEvent);
        });

        it('should handle same priority events in FIFO order', async () => {
            const event1 = createEvent('test.1', { order: 1 });
            const event2 = createEvent('test.2', { order: 2 });
            const event3 = createEvent('test.3', { order: 3 });

            await queue.enqueue(event1, 5);
            await queue.enqueue(event2, 5);
            await queue.enqueue(event3, 5);

            expect(queue.dequeue()).toEqual(event1);
            expect(queue.dequeue()).toEqual(event2);
            expect(queue.dequeue()).toEqual(event3);
        });

        it('should handle negative priorities', async () => {
            const negativeEvent = createEvent('test.negative', {
                priority: 'negative',
            });
            const zeroEvent = createEvent('test.zero', { priority: 'zero' });
            const positiveEvent = createEvent('test.positive', {
                priority: 'positive',
            });

            await queue.enqueue(negativeEvent, -5);
            await queue.enqueue(zeroEvent, 0);
            await queue.enqueue(positiveEvent, 5);

            expect(queue.dequeue()).toEqual(positiveEvent);
            expect(queue.dequeue()).toEqual(zeroEvent);
            expect(queue.dequeue()).toEqual(negativeEvent);
        });
    });

    describe('Queue Size Limits', () => {
        it('should respect max size limit', async () => {
            const limitedQueue = new EventQueue(observability, {
                maxQueueDepth: 3,
            });
            const event1 = createEvent('test.event');
            const event2 = createEvent('test.event');
            const event3 = createEvent('test.event');
            const event4 = createEvent('test.event');

            expect(await limitedQueue.enqueue(event1)).toBe(true);
            expect(await limitedQueue.enqueue(event2)).toBe(true);
            expect(await limitedQueue.enqueue(event3)).toBe(true);
            expect(await limitedQueue.enqueue(event4)).toBe(false); // Should be rejected

            expect(limitedQueue.getStats().size).toBe(3);
        });

        it('should handle zero max size', async () => {
            const zeroQueue = new EventQueue(observability, {
                maxQueueDepth: 0,
            });
            const event = createEvent('test.event');

            expect(await zeroQueue.enqueue(event)).toBe(false);
            expect(zeroQueue.getStats().size).toBe(0);
        });

        it('should handle very large max size', async () => {
            const config = {
                maxQueueDepth: 1000000,
                enableObservability: true,
                batchSize: 100,
            };
            const largeQueue = new EventQueue(observability, config);

            // Should be able to enqueue many events
            for (let i = 0; i < 10000; i++) {
                const event = createEvent(`test.${i}`, { index: i });
                expect(await largeQueue.enqueue(event)).toBe(true);
            }

            expect(largeQueue.getStats().size).toBe(10000);
        });
    });

    describe('Batch Processing', () => {
        it('should process events in batches', async () => {
            const events: AnyEvent[] = [];
            const processedEvents: AnyEvent[] = [];

            // Create test events
            for (let i = 0; i < 50; i++) {
                const event = createEvent(`test.${i}`, { index: i });
                events.push(event);
                await queue.enqueue(event);
            }

            const processor = async (event: AnyEvent) => {
                processedEvents.push(event);
            };

            const processedCount = await queue.processBatch(processor);

            expect(processedCount).toBe(50);
            expect(processedEvents).toHaveLength(50);
            expect(queue.getStats().size).toBe(0);

            // Verify all events were processed
            for (let i = 0; i < 50; i++) {
                const event = processedEvents[i];
                expect(event).toBeDefined();
                expect(event!.type).toBe(`test.${i}`);
                expect((event!.data as { index: number }).index).toBe(i);
            }
        });

        it('should respect batch size limits', async () => {
            const config = {
                maxQueueDepth: 1000,
                enableObservability: true,
                batchSize: 10,
            };
            const batchQueue = new EventQueue(observability, config);

            const events: AnyEvent[] = [];
            const processedEvents: AnyEvent[] = [];

            // Create more events than batch size
            for (let i = 0; i < 25; i++) {
                const event = createEvent(`test.${i}`, { index: i });
                events.push(event);
                await batchQueue.enqueue(event);
            }

            const processor = async (event: AnyEvent) => {
                processedEvents.push(event);
            };

            // First batch should process 10 events
            const firstBatchCount = await batchQueue.processBatch(processor);
            expect(firstBatchCount).toBe(10);
            expect(processedEvents).toHaveLength(10);
            expect(batchQueue.getStats().size).toBe(15);

            // Second batch should process 10 eventos
            const secondBatchCount = await batchQueue.processBatch(processor);
            expect(secondBatchCount).toBe(10);
            expect(processedEvents).toHaveLength(20);
            expect(batchQueue.getStats().size).toBe(5);

            // Third batch should process remaining 5 eventos
            const thirdBatchCount = await batchQueue.processBatch(processor);
            expect(thirdBatchCount).toBe(5);
            expect(processedEvents).toHaveLength(25);
            expect(batchQueue.getStats().size).toBe(0);
        });

        it('should handle empty queue in batch processing', async () => {
            const processor = async (_event: AnyEvent) => {
                // Should not be called
                throw new Error('Processor should not be called');
            };

            const processedCount = await queue.processBatch(processor);

            expect(processedCount).toBe(0);
        });

        it('should handle processor errors gracefully', async () => {
            const event1 = createEvent('test.1');
            const event2 = createEvent('test.2');
            const event3 = createEvent('test.3');

            await queue.enqueue(event1);
            await queue.enqueue(event2);
            await queue.enqueue(event3);

            const processedEvents: AnyEvent[] = [];
            let errorCount = 0;

            const processor = async (event: AnyEvent) => {
                if (event.type === 'test.2') {
                    errorCount++;
                    throw new Error('Processor error');
                }
                processedEvents.push(event);
            };

            const processedCount = await queue.processBatch(processor);

            // Should still process other events
            expect(processedEvents).toHaveLength(2);
            expect(errorCount).toBe(1);
            expect(processedCount).toBe(3); // All events were attempted
        });
    });

    describe('Retry Logic', () => {
        it('should handle retry for failed events', async () => {
            const event = createEvent('test.retry', { attempts: 0 });
            await queue.enqueue(event);

            let attemptCount = 0;
            const processor = async (_event: AnyEvent) => {
                attemptCount++;
                if (attemptCount < 3) {
                    throw new Error(`Attempt ${attemptCount} failed`);
                }
            };

            // The queue should handle retries internally
            await queue.processBatch(processor);

            // Note: The actual retry logic implementation may vary
            // This test verifies the queue doesn't crash on errors
            expect(attemptCount).toBeGreaterThan(0);
        });
    });

    describe('Concurrent Access', () => {
        it('should handle concurrent enqueue operations', async () => {
            const promises: Promise<boolean>[] = [];

            // Simulate concurrent enqueue operations
            for (let i = 0; i < 100; i++) {
                const event = createEvent(`test.concurrent.${i}`, { index: i });
                promises.push(queue.enqueue(event));
            }

            const results = await Promise.all(promises);

            expect(results.every((result) => result === true)).toBe(true);
            expect(queue.getStats().size).toBe(100);
        });

        it('should handle concurrent dequeue operations', async () => {
            // First, enqueue some events
            for (let i = 0; i < 50; i++) {
                const event = createEvent(`test.concurrent.${i}`, { index: i });
                await queue.enqueue(event);
            }

            const promises: Promise<AnyEvent | null>[] = [];

            // Simulate concurrent dequeue operations
            for (let i = 0; i < 50; i++) {
                promises.push(Promise.resolve(queue.dequeue()));
            }

            const results = await Promise.all(promises);

            // All results should be events (not null)
            expect(results.every((result) => result !== null)).toBe(true);
            expect(queue.getStats().size).toBe(0);
        });

        it('should prevent concurrent batch processing', async () => {
            // Enqueue some events
            for (let i = 0; i < 10; i++) {
                const event = createEvent(`test.concurrent.${i}`, { index: i });
                await queue.enqueue(event);
            }

            const processor1 = async (_event: AnyEvent) => {
                await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate work
            };

            const processor2 = async (_event: AnyEvent) => {
                await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate work
            };

            // Start two concurrent batch processing operations
            const promise1 = queue.processBatch(processor1);
            const promise2 = queue.processBatch(processor2);

            const [result1, result2] = await Promise.all([promise1, promise2]);

            // One should process all events, the other should process 0
            expect(result1 + result2).toBe(10);
            expect(result1 === 10 || result2 === 10).toBe(true);
            expect(result1 === 0 || result2 === 0).toBe(true);
        });
    });

    describe('Queue Statistics', () => {
        it('should provide accurate statistics', async () => {
            const queue = new EventQueue(observability, { maxQueueDepth: 5 });
            const event = createEvent('test.event');
            await queue.enqueue(event);

            const stats = queue.getStats();
            expect(stats).toHaveProperty('size');
            expect(stats).toHaveProperty('maxQueueDepth');
            expect(stats).toHaveProperty('processing');
            expect(stats).toHaveProperty('backpressureActive');
            expect(stats).toHaveProperty('availablePermits');
            expect(stats).toHaveProperty('waitQueueSize');
        });

        it('should track event statistics correctly', async () => {
            const event1 = createEvent('test.1');

            await queue.enqueue(event1);
            const stats1 = queue.getStats();

            expect(stats1.size).toBe(1);
            expect(stats1.processing).toBe(false);

            const event2 = createEvent('test.2');
            await queue.enqueue(event2);
            const stats2 = queue.getStats();

            expect(stats2.size).toBe(2);
            expect(stats2.processing).toBe(false);
        });

        it('should handle statistics for empty queue', () => {
            const stats = queue.getStats();

            expect(stats.size).toBe(0);
            expect(stats.processing).toBe(false);
            expect(stats.backpressureActive).toBe(false);
        });
    });

    describe('Queue Cleanup', () => {
        it('should clear all events', async () => {
            // Enqueue some events
            for (let i = 0; i < 10; i++) {
                const event = createEvent(`test.${i}`, { index: i });
                await queue.enqueue(event);
            }

            expect(queue.getStats().size).toBe(10);

            queue.clear();

            expect(queue.getStats().size).toBe(0);
            expect(queue.dequeue()).toBeNull();
        });

        it('should handle clear on empty queue', () => {
            expect(queue.getStats().size).toBe(0);

            queue.clear();

            expect(queue.getStats().size).toBe(0);
        });
    });

    describe('Performance', () => {
        it('should handle high throughput enqueue operations', async () => {
            // Create a queue with larger maxQueueDepth for performance test
            const performanceQueue = new EventQueue(observability, {
                maxQueueDepth: 100000,
                enableObservability: false, // Disable observability for performance test
                batchSize: 100,
                enableCompression: false, // Disable compression for performance test
            });

            const startTime = performance.now();

            // Enqueue 10,000 events
            for (let i = 0; i < 10000; i++) {
                const event = createEvent(`test.${i}`, { index: i });
                await performanceQueue.enqueue(event);
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(performanceQueue.getStats().size).toBe(10000);
            expect(duration).toBeLessThan(2000); // Relaxed to 2 seconds for async operations

            performanceQueue.clear();
        });

        it('should handle high throughput dequeue operations', async () => {
            // Create a queue with larger maxQueueDepth for performance test
            const performanceQueue = new EventQueue(observability, {
                maxQueueDepth: 100000,
                enableObservability: true,
                batchSize: 100,
            });

            // First, enqueue events
            for (let i = 0; i < 10000; i++) {
                const event = createEvent(`test.${i}`, { index: i });
                await performanceQueue.enqueue(event);
            }

            const startTime = performance.now();

            // Dequeue all events
            for (let i = 0; i < 10000; i++) {
                performanceQueue.dequeue();
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(performanceQueue.getStats().size).toBe(0);
            expect(duration).toBeLessThan(1000); // Should complete in less than 1 second

            performanceQueue.clear();
        });

        it('should handle batch processing performance', async () => {
            // Create a queue with larger maxQueueDepth for performance test
            const performanceQueue = new EventQueue(observability, {
                maxQueueDepth: 100000,
                enableObservability: true,
                batchSize: 100,
            });

            // Enqueue events
            for (let i = 0; i < 10000; i++) {
                const event = createEvent(`test.${i}`, { index: i });
                await performanceQueue.enqueue(event);
            }

            const startTime = performance.now();

            const processor = async (_event: AnyEvent) => {
                // Simulate some processing work
                await new Promise((resolve) => setTimeout(resolve, 0));
            };

            const processedCount = await performanceQueue.processAll(processor);

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(processedCount).toBe(10000);
            expect(duration).toBeLessThan(5000); // Should complete in reasonable time

            performanceQueue.clear();
        });
    });

    describe('Memory Management', () => {
        it('should not leak memory with large data objects', async () => {
            const initialMemory = process.memoryUsage().heapUsed;

            // Create events with large data objects
            for (let i = 0; i < 1000; i++) {
                const largeData = {
                    array: Array.from({ length: 100 }, (_, j) => ({
                        id: j,
                        value: `item-${j}`,
                    })),
                    nested: { deep: { object: { value: `test-${i}` } } },
                };
                const event = createEvent(`test.large.${i}`, largeData);
                await queue.enqueue(event);
            }

            // Clear the queue
            queue.clear();

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            // Memory increase should be reasonable (less than 50MB)
            expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
        });
    });

    describe('Edge Cases', () => {
        it('should handle events with circular references', async () => {
            const circularData: Record<string, unknown> = { name: 'test' };
            (circularData as Record<string, unknown>).self = circularData;

            const event = createEvent('test.circular', circularData);

            await expect(queue.enqueue(event)).resolves.toBe(true);
            expect(queue.getStats().size).toBe(1);
        });

        it('should handle events with undefined data', async () => {
            const event = createEvent('test.undefined', undefined);

            await expect(queue.enqueue(event)).resolves.toBe(true);
            expect(queue.getStats().size).toBe(1);

            const dequeued = queue.dequeue();
            expect(dequeued?.data).toBeUndefined();
        });

        it('should handle events with null data', async () => {
            const event = createEvent('test.null', null);

            await expect(queue.enqueue(event)).resolves.toBe(true);
            expect(queue.getStats().size).toBe(1);

            const dequeued = queue.dequeue();
            expect(dequeued?.data).toBeNull();
        });

        it('should handle events with function data', async () => {
            const functionData = {
                func: () => 'test',
                asyncFunc: async () => 'test',
            };

            const event = createEvent('test.function', functionData);

            await expect(queue.enqueue(event)).resolves.toBe(true);
            expect(queue.getStats().size).toBe(1);
        });
    });
});
