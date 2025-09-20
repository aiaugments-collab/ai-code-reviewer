/**
 * @file performance.test.ts
 * @description Testes de Performance do Runtime Layer
 */

import { describe, it, expect } from 'vitest';
import { createEvent } from '../../src/core/types/events.js';

describe('Runtime Layer - Performance', () => {
    it('should create events quickly', () => {
        const eventCount = 1000;
        const startTime = performance.now();

        // Create many events
        for (let i = 0; i < eventCount; i++) {
            createEvent(`test.event.${i}`, { index: i });
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        expect(duration).toBeLessThan(200); // Should be very fast
        console.log(`Created ${eventCount} events in ${duration.toFixed(2)}ms`);
    });

    it('should handle high throughput event creation', () => {
        const eventCount = 5000;
        const startTime = performance.now();

        // Create events rapidly
        for (let i = 0; i < eventCount; i++) {
            createEvent('throughput.test', {
                index: i,
                timestamp: Date.now(),
            });
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        expect(duration).toBeLessThan(250); // Should be very fast
        console.log(
            `High throughput: ${eventCount} events in ${duration.toFixed(2)}ms`,
        );
    });

    it('should handle events with large data efficiently', () => {
        const eventCount = 100;
        const largeData = 'x'.repeat(1000); // 1KB per event
        const startTime = performance.now();

        // Create events with large data
        for (let i = 0; i < eventCount; i++) {
            createEvent('large.data.test', {
                index: i,
                data: largeData,
                timestamp: Date.now(),
            });
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        expect(duration).toBeLessThan(20); // Should be fast even with large data
        console.log(
            `Large data: ${eventCount} events in ${duration.toFixed(2)}ms`,
        );
    });

    it('should handle concurrent event creation', async () => {
        const concurrentCount = 10;
        const eventsPerConcurrent = 100;
        const startTime = performance.now();

        // Create concurrent processing promises
        const concurrentPromises = Array.from(
            { length: concurrentCount },
            (_, i) =>
                (async () => {
                    for (let j = 0; j < eventsPerConcurrent; j++) {
                        createEvent('concurrent.test', {
                            concurrentId: i,
                            index: i * eventsPerConcurrent + j,
                        });
                    }
                })(),
        );

        // Wait for all to complete
        await Promise.all(concurrentPromises);

        const endTime = performance.now();
        const duration = endTime - startTime;

        expect(duration).toBeLessThan(50); // Should be fast
        console.log(
            `Concurrent: ${concurrentCount * eventsPerConcurrent} events in ${duration.toFixed(2)}ms`,
        );
    });

    it('should maintain performance with complex data structures', () => {
        const eventCount = 500;
        const startTime = performance.now();

        // Create events with complex nested data
        for (let i = 0; i < eventCount; i++) {
            createEvent('complex.data.test', {
                index: i,
                nested: {
                    level1: {
                        level2: {
                            level3: {
                                value: `nested-value-${i}`,
                                array: new Array(10).fill(i),
                                object: {
                                    nested: true,
                                    index: i,
                                },
                            },
                        },
                    },
                },
                timestamp: Date.now(),
            });
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        expect(duration).toBeLessThan(30); // Should be reasonable
        console.log(
            `Complex data: ${eventCount} events in ${duration.toFixed(2)}ms`,
        );
    });

    it('should handle memory usage efficiently', () => {
        const initialMemory = process.memoryUsage().heapUsed;
        const eventCount = 1000;

        // Create events
        for (let i = 0; i < eventCount; i++) {
            createEvent('memory.test', {
                index: i,
                data: `event-data-${i}`.repeat(10), // Some data to test memory
            });
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

        expect(memoryIncreaseMB).toBeLessThan(10); // Less than 10MB increase
        console.log(
            `Memory usage: ${memoryIncreaseMB.toFixed(2)}MB for ${eventCount} events`,
        );
    });

    it('should handle rapid event creation without blocking', () => {
        const eventCount = 2000;
        const startTime = performance.now();

        // Create events as fast as possible
        for (let i = 0; i < eventCount; i++) {
            createEvent('rapid.test', {
                index: i,
                timestamp: performance.now(),
            });
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        expect(duration).toBeLessThan(200); // Should be very fast
        console.log(
            `Rapid creation: ${eventCount} events in ${duration.toFixed(2)}ms`,
        );
    });
});
