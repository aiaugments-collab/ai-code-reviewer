import { describe, it, expect, beforeEach } from 'vitest';
import { EventQueue } from '../../src/runtime/core/event-queue.js';
import { getObservability } from '../../src/observability/index.js';
import { createEvent } from '../../src/core/types/events.js';

describe.sequential('EventQueue V2 - Basic operations', () => {
    let queue: EventQueue;

    beforeEach(() => {
        const observability = getObservability({ environment: 'test' });
        queue = new EventQueue(observability, {
            enableObservability: true,
            maxQueueDepth: 100,
            batchSize: 10,
            enableAutoScaling: false,
        });
        // cleaned debug
    });

    it('should start empty and track size correctly', async () => {
        // cleaned debug
        expect(queue.getStats().size).toBe(0);

        const e1 = createEvent('v2.queue.1', { a: 1 });
        await queue.enqueue(e1);
        expect(queue.getStats().size).toBe(1);

        const peeked = queue.peek();
        expect(peeked).toEqual(e1);

        const processed: string[] = [];
        const c = await queue.processBatch(async (e) => {
            processed.push(e.id);
        });
        expect(c).toBe(1);
        expect(processed).toEqual([e1.id]);
        expect(queue.getStats().size).toBe(0);
    });

    it('should respect maxQueueDepth = 0 (reject all)', async () => {
        const observability = getObservability({ environment: 'test' });
        const zero = new EventQueue(observability, {
            enableObservability: true,
            maxQueueDepth: 0,
            enableAutoScaling: false,
        });
        const e = createEvent('v2.queue.zero');
        await expect(zero.enqueue(e)).resolves.toBe(false);
        expect(zero.getStats().size).toBe(0);
    });

    it('should process in priority order (highest first)', async () => {
        const low = createEvent('v2.queue.low', { priority: 'low' });
        const med = createEvent('v2.queue.med', { priority: 'medium' });
        const high = createEvent('v2.queue.high', { priority: 'high' });

        await queue.enqueue(low, 0);
        await queue.enqueue(med, 1);
        await queue.enqueue(high, 2);

        const order: ReturnType<typeof createEvent>[] = [];
        const count = await queue.processBatch(async (e) => {
            order.push(e as ReturnType<typeof createEvent>);
        });
        expect(count).toBe(3);
        expect(order).toEqual([high, med, low]);
        expect(queue.getStats().size).toBe(0);
    });

    it('should process events in batches', async () => {
        const processed: string[] = [];
        for (let i = 0; i < 25; i++) {
            await queue.enqueue(createEvent('v2.queue.batch', { i }));
        }

        const c1 = await queue.processBatch(async (e) => {
            processed.push(e.id);
        });
        expect(c1).toBe(10);
        expect(queue.getStats().size).toBe(15);

        const c2 = await queue.processBatch(async (e) => {
            processed.push(e.id);
        });
        expect(c2).toBe(10);
        expect(queue.getStats().size).toBe(5);

        const c3 = await queue.processBatch(async (e) => {
            processed.push(e.id);
        });
        expect(c3).toBe(5);
        expect(queue.getStats().size).toBe(0);
        expect(processed.length).toBe(25);
    });
});
