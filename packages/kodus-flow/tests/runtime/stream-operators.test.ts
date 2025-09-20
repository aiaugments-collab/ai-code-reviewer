import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { createWorkflowContext } from '../../src/core/context/index.js';
import { getObservability } from '../../src/observability/index.js';
import { createEvent } from '../../src/core/types/events.js';
import type { AnyEvent } from '../../src/core/types/events.js';
import type { EventStream } from '../../src/core/types/common-types.js';

describe('Stream Operators', () => {
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
        runtime = createRuntime(context, observability);
    });

    afterEach(() => {
        runtime.clear();
    });

    describe('Fan-out (Parallel Processing)', () => {
        it('should process multiple streams in parallel', async () => {
            const results: string[] = [];

            // Create multiple streams
            const stream1 = runtime.createStream(async function* () {
                for (let i = 0; i < 5; i++) {
                    yield createEvent('stream1.event', {
                        index: i,
                        source: 'stream1',
                    });
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
            });

            const stream2 = runtime.createStream(async function* () {
                for (let i = 0; i < 5; i++) {
                    yield createEvent('stream2.event', {
                        index: i,
                        source: 'stream2',
                    });
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
            });

            const stream3 = runtime.createStream(async function* () {
                for (let i = 0; i < 5; i++) {
                    yield createEvent('stream3.event', {
                        index: i,
                        source: 'stream3',
                    });
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
            });

            // Process all streams in parallel
            const startTime = Date.now();

            await Promise.all([
                stream1.toArray().then((events) => {
                    events.forEach((event) =>
                        results.push(
                            `stream1-${(event.data as { index: number }).index}`,
                        ),
                    );
                }),
                stream2.toArray().then((events) => {
                    events.forEach((event) =>
                        results.push(
                            `stream2-${(event.data as { index: number }).index}`,
                        ),
                    );
                }),
                stream3.toArray().then((events) => {
                    events.forEach((event) =>
                        results.push(
                            `stream3-${(event.data as { index: number }).index}`,
                        ),
                    );
                }),
            ]);

            const endTime = Date.now();
            const duration = endTime - startTime;

            // Should have 15 total results
            expect(results).toHaveLength(15);

            // Should complete faster than sequential processing (3 * 5 * 10ms = 150ms)
            expect(duration).toBeLessThan(200);

            // Verify all events were processed
            const stream1Events = results.filter((r) =>
                r.startsWith('stream1'),
            );
            const stream2Events = results.filter((r) =>
                r.startsWith('stream2'),
            );
            const stream3Events = results.filter((r) =>
                r.startsWith('stream3'),
            );

            expect(stream1Events).toHaveLength(5);
            expect(stream2Events).toHaveLength(5);
            expect(stream3Events).toHaveLength(5);
        });

        it('should handle fan-out with different stream sizes', async () => {
            const results: string[] = [];

            const stream1 = runtime.createStream(async function* () {
                for (let i = 0; i < 3; i++) {
                    yield createEvent('stream1.event', { index: i });
                }
            });

            const stream2 = runtime.createStream(async function* () {
                for (let i = 0; i < 7; i++) {
                    yield createEvent('stream2.event', { index: i });
                }
            });

            await Promise.all([
                stream1.toArray().then((events) => {
                    events.forEach((event) =>
                        results.push(
                            `stream1-${(event.data as { index: number }).index}`,
                        ),
                    );
                }),
                stream2.toArray().then((events) => {
                    events.forEach((event) =>
                        results.push(
                            `stream2-${(event.data as { index: number }).index}`,
                        ),
                    );
                }),
            ]);

            expect(results).toHaveLength(10);

            const stream1Events = results.filter((r) =>
                r.startsWith('stream1'),
            );
            const stream2Events = results.filter((r) =>
                r.startsWith('stream2'),
            );

            expect(stream1Events).toHaveLength(3);
            expect(stream2Events).toHaveLength(7);
        });
    });

    describe('Fan-in (Stream Aggregation)', () => {
        it('should merge multiple streams into one', async () => {
            const stream1 = runtime.createStream(
                async function* (): AsyncGenerator<AnyEvent> {
                    for (let i = 0; i < 3; i++) {
                        yield createEvent('stream1.event', {
                            index: i,
                            source: 'stream1',
                        });
                    }
                },
            );

            const stream2 = runtime.createStream(
                async function* (): AsyncGenerator<AnyEvent> {
                    for (let i = 0; i < 3; i++) {
                        yield createEvent('stream2.event', {
                            index: i,
                            source: 'stream2',
                        });
                    }
                },
            );

            const stream3 = runtime.createStream(
                async function* (): AsyncGenerator<AnyEvent> {
                    for (let i = 0; i < 3; i++) {
                        yield createEvent('stream3.event', {
                            index: i,
                            source: 'stream3',
                        });
                    }
                },
            );

            // Merge all streams
            const mergedStream = stream1.merge(stream2, stream3);
            const mergedEvents = await mergedStream.toArray();

            expect(mergedEvents).toHaveLength(9);

            // Verify all sources are present
            const sources = mergedEvents.map(
                (event) => (event.data as { source: string }).source,
            );
            expect(sources.filter((s) => s === 'stream1')).toHaveLength(3);
            expect(sources.filter((s) => s === 'stream2')).toHaveLength(3);
            expect(sources.filter((s) => s === 'stream3')).toHaveLength(3);
        });

        it('should combine latest values from multiple streams', async () => {
            const stream1 = runtime.createStream(
                async function* (): AsyncGenerator<AnyEvent> {
                    for (let i = 0; i < 3; i++) {
                        yield createEvent('stream1.event', { value: `a${i}` });
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }
                },
            );

            const stream2 = runtime.createStream(
                async function* (): AsyncGenerator<AnyEvent> {
                    for (let i = 0; i < 3; i++) {
                        yield createEvent('stream2.event', { value: `b${i}` });
                        await new Promise((resolve) => setTimeout(resolve, 30));
                    }
                },
            );

            const stream3 = runtime.createStream(
                async function* (): AsyncGenerator<AnyEvent> {
                    for (let i = 0; i < 3; i++) {
                        yield createEvent('stream3.event', { value: `c${i}` });
                        await new Promise((resolve) => setTimeout(resolve, 40));
                    }
                },
            );

            // Combine latest values
            const combinedStream = stream1.combineLatest(stream2, stream3);
            const combinedEvents = await combinedStream.toArray();

            expect(combinedEvents.length).toBeGreaterThan(0);

            // Each combined event should have values from all streams
            combinedEvents.forEach((event) => {
                expect(event.data).toBeDefined();
            });
        });
    });

    describe('Stream Filtering', () => {
        it('should filter events based on predicate', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 10; i++) {
                    yield createEvent('test.event', {
                        value: i,
                        even: i % 2 === 0,
                    });
                }
            });

            // Filter even numbers
            const evenStream = stream.filter(
                (event) => (event.data as { even: boolean }).even === true,
            );
            const evenEvents = await evenStream.toArray();

            expect(evenEvents).toHaveLength(5);
            evenEvents.forEach((event) => {
                expect((event.data as { value: number }).value % 2).toBe(0);
            });
        });

        it('should filter events by type', async () => {
            const stream = runtime.createStream(async function* () {
                yield createEvent('user.created', { userId: '1' });
                yield createEvent('order.placed', { orderId: '1' });
                yield createEvent('user.updated', { userId: '1' });
                yield createEvent('order.cancelled', { orderId: '1' });
                yield createEvent('user.deleted', { userId: '1' });
            });

            // Filter only user events
            const userStream = stream.filter((event) =>
                event.type.startsWith('user.'),
            );
            const userEvents = await userStream.toArray();

            expect(userEvents).toHaveLength(3);
            userEvents.forEach((event) => {
                expect(event.type).toMatch(/^user\./);
            });
        });

        it('should handle empty filter results', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 5; i++) {
                    yield createEvent('test.event', { value: i });
                }
            });

            // Filter that matches nothing
            const filteredStream = stream.filter(
                (event) => (event.data as { value: number }).value > 100,
            );
            const filteredEvents = await filteredStream.toArray();

            expect(filteredEvents).toHaveLength(0);
        });
    });

    describe('Stream Mapping', () => {
        it('should transform events using mapper function', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 5; i++) {
                    yield createEvent('test.event', { value: i });
                }
            });

            // Transform events
            const mappedStream = stream.map((event) => ({
                ...event,
                data: {
                    ...(event.data as { value: number }),
                    doubled: (event.data as { value: number }).value * 2,
                },
            }));

            const mappedEvents = await mappedStream.toArray();

            expect(mappedEvents).toHaveLength(5);
            mappedEvents.forEach((event, index) => {
                expect((event.data as { value: number }).value).toBe(index);
                expect((event.data as { doubled: number }).doubled).toBe(
                    index * 2,
                );
            });
        });

        it('should change event types in mapping', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 3; i++) {
                    yield createEvent('input.event', { value: i });
                }
            });

            // Transform to different event type
            const transformedStream = stream.map((event) =>
                createEvent('output.event', {
                    originalValue: (event.data as { value: number }).value,
                    processed: (event.data as { value: number }).value * 10,
                }),
            );

            const transformedEvents = await transformedStream.toArray();

            expect(transformedEvents).toHaveLength(3);
            transformedEvents.forEach((event, index) => {
                expect(event.type).toBe('output.event');
                expect(
                    (event.data as { originalValue: number }).originalValue,
                ).toBe(index);
                expect((event.data as { processed: number }).processed).toBe(
                    index * 10,
                );
            });
        });
    });

    describe('Stream Debouncing', () => {
        it('should debounce events with delay', async () => {
            const stream = runtime.createStream(async function* () {
                // Emit events rapidly
                for (let i = 0; i < 10; i++) {
                    yield createEvent('test.event', { value: i });
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
            });

            // Debounce with 50ms delay
            const debouncedStream = stream.debounce(50);
            const debouncedEvents = await debouncedStream.toArray();

            // Should have fewer events due to debouncing
            expect(debouncedEvents.length).toBeLessThan(10);
            expect(debouncedEvents.length).toBeGreaterThan(0);
        });

        it('should handle debounce with no events', async () => {
            const stream = runtime.createStream(async function* () {
                // No events
            });

            const debouncedStream = stream.debounce(100);
            const debouncedEvents = await debouncedStream.toArray();

            expect(debouncedEvents).toHaveLength(0);
        });
    });

    describe('Stream Throttling', () => {
        it('should throttle events to limit rate', async () => {
            const stream = runtime.createStream(async function* () {
                // Emit events rapidly
                for (let i = 0; i < 20; i++) {
                    yield createEvent('test.event', { value: i });
                    await new Promise((resolve) => setTimeout(resolve, 5));
                }
            });

            // Throttle to max 1 event per 50ms
            const throttledStream = stream.throttle(50);
            const startTime = Date.now();
            const throttledEvents = await throttledStream.toArray();
            const endTime = Date.now();

            expect(throttledEvents.length).toBeLessThan(20); // Throttling should reduce events
            expect(endTime - startTime).toBeGreaterThan(100); // Should take at least 100ms due to throttling
        });
    });

    describe('Stream Batching', () => {
        it('should batch events into groups', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 10; i++) {
                    yield createEvent('test.event', { value: i });
                }
            });

            // Batch events into groups of 3
            const batchedStream = stream.batch(3);
            const batchedEvents = await batchedStream.toArray();

            expect(batchedEvents).toHaveLength(4); // 3 full batches + 1 partial batch
            expect(
                (batchedEvents[0]?.data as { events: AnyEvent[] }).events,
            ).toHaveLength(3);
            expect(
                (batchedEvents[1]?.data as { events: AnyEvent[] }).events,
            ).toHaveLength(3);
            expect(
                (batchedEvents[2]?.data as { events: AnyEvent[] }).events,
            ).toHaveLength(3);
            expect(
                (batchedEvents[3]?.data as { events: AnyEvent[] }).events,
            ).toHaveLength(1);
        });

        it('should handle batch timeout', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 5; i++) {
                    yield createEvent('test.event', { value: i });
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
            });

            // Batch with 200ms timeout
            const batchedStream = stream.batch(10, 200);
            const batchedEvents = await batchedStream.toArray();

            expect(batchedEvents.length).toBeGreaterThan(0);
        });
    });

    describe('Stream Error Handling', () => {
        it('should handle errors in stream generation', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 5; i++) {
                    if (i === 3) {
                        throw new Error('Stream error');
                    }
                    yield createEvent('test.event', { value: i });
                }
            });

            const events: AnyEvent[] = [];
            let error: Error | null = null;

            try {
                for await (const event of stream) {
                    events.push(event);
                }
            } catch (err) {
                error = err as Error;
            }

            expect(events).toHaveLength(3);
            expect(error).toBeDefined();
            expect(error?.message).toBe('Stream error');
        });

        it('should handle errors in stream operators', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 5; i++) {
                    yield createEvent('test.event', { value: i });
                }
            });

            // Map with error
            const mappedStream = stream.map((event) => {
                if ((event.data as { value: number }).value === 3) {
                    throw new Error('Mapping error');
                }
                return event;
            });

            const events: AnyEvent[] = [];
            let error: Error | null = null;

            try {
                for await (const event of mappedStream) {
                    events.push(event);
                }
            } catch (err) {
                error = err as Error;
            }

            expect(events).toHaveLength(3);
            expect(error).toBeDefined();
            expect(error?.message).toBe('Mapping error');
        });
    });

    describe('Stream Backpressure', () => {
        it('should handle backpressure with slow consumer', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 100; i++) {
                    yield createEvent('test.event', { value: i });
                }
            });

            const events: AnyEvent[] = [];
            let processedCount = 0;

            // Slow consumer
            for await (const event of stream) {
                events.push(event);
                processedCount++;

                // Simulate slow processing
                if (processedCount % 10 === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
            }

            expect(events).toHaveLength(100);
            expect(processedCount).toBe(100);
        });

        it('should handle backpressure with filter', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 1000; i++) {
                    yield createEvent('test.event', {
                        value: i,
                        even: i % 2 === 0,
                    });
                }
            });

            // Filter with backpressure
            const filteredStream = stream.filter(
                (event) => (event.data as { even: boolean }).even,
            );
            const filteredEvents = await filteredStream.toArray();

            expect(filteredEvents).toHaveLength(500);
            filteredEvents.forEach((event) => {
                expect((event.data as { value: number }).value % 2).toBe(0);
            });
        });
    });

    describe('Stream Composition', () => {
        it('should compose multiple operators', async () => {
            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 20; i++) {
                    yield createEvent('test.event', { value: i });
                }
            });

            // Compose filter, map, and batch
            const composedStream = stream
                .filter(
                    (event) =>
                        (event.data as { value: number }).value % 2 === 0,
                ) // Keep even numbers
                .map((event) => ({
                    ...event,
                    data: {
                        ...(event.data as { value: number }),
                        doubled: (event.data as { value: number }).value * 2,
                    },
                }))
                .batch(3);

            const composedEvents = await composedStream.toArray();

            expect(composedEvents.length).toBeGreaterThan(0);
            composedEvents.forEach((batch) => {
                const events = (batch.data as { events: AnyEvent[] }).events;
                expect(events.length).toBeGreaterThan(0);
                expect(events.length).toBeLessThanOrEqual(3);
                (batch.data as { events: AnyEvent[] }).events.forEach(
                    (event) => {
                        expect(
                            (event.data as { value: number }).value % 2,
                        ).toBe(0);
                        expect(
                            (event.data as { doubled: number }).doubled,
                        ).toBe((event.data as { value: number }).value * 2);
                    },
                );
            });
        });

        it('should handle complex stream pipelines', async () => {
            const stream1 = runtime.createStream(
                async function* (): AsyncGenerator<AnyEvent> {
                    for (let i = 0; i < 5; i++) {
                        yield createEvent('stream1.event', { value: i });
                    }
                },
            );

            const stream2 = runtime.createStream(
                async function* (): AsyncGenerator<AnyEvent> {
                    for (let i = 0; i < 5; i++) {
                        yield createEvent('stream2.event', { value: i + 10 });
                    }
                },
            );

            // Complex pipeline: merge, filter, map, batch
            const pipeline = stream1
                .merge(stream2)
                .filter(
                    (event) =>
                        (event.data as { value: number }).value < 8 ||
                        (event.data as { value: number }).value > 12,
                )
                .map((event) => ({
                    ...event,
                    data: {
                        ...(event.data as { value: number }),
                        processed: true,
                    },
                }))
                .batch(2);

            const pipelineEvents = await pipeline.toArray();

            expect(pipelineEvents.length).toBeGreaterThan(0);
        });
    });

    describe('Stream Performance', () => {
        it('should handle high-throughput streams efficiently', async () => {
            const startTime = performance.now();

            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 10000; i++) {
                    yield createEvent('test.event', { value: i });
                }
            });

            const events = await stream.toArray();

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(events).toHaveLength(10000);
            expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
        });

        it('should handle memory efficiently with large streams', async () => {
            const initialMemory = process.memoryUsage().heapUsed;

            const stream = runtime.createStream(async function* () {
                for (let i = 0; i < 10000; i++) {
                    const largeData = {
                        id: i,
                        data: Array.from({ length: 100 }, (_, j) => ({
                            index: j,
                            value: `item-${j}`,
                        })),
                    };
                    yield createEvent('test.large', largeData);
                }
            });

            const events = await stream.toArray();

            // Clear references
            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            expect(events).toHaveLength(10000);
            expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024); // Less than 100MB increase
        });
    });
});
