import { describe, it, expect, beforeEach } from 'vitest';
import { EventQueue } from '../../src/runtime/core/event-queue.js';
import { getObservability } from '../../src/observability/index.js';
import { createEvent } from '../../src/core/types/events.js';

describe.sequential('EventQueue V2 - Backpressure', () => {
    let queue: EventQueue;

    beforeEach(() => {
        const observability = getObservability({ environment: 'test' });
        queue = new EventQueue(observability, {
            enableObservability: false,
            maxQueueDepth: 5,
            batchSize: 10,
            enableAutoScaling: false,
        });
    });

    it('activates backpressure when queueDepth > maxQueueDepth', async () => {
        for (let i = 0; i < 6; i++) {
            await queue.enqueue(createEvent('v2.bp', { i }));
        }
        const stats = queue.getStats();
        expect(stats.size).toBe(5);
        // Em getStats, o flag é cacheado no último shouldActivateBackpressure()
        // Chamamos manualmente para definir o cache antes de assert
        queue['shouldActivateBackpressure']?.();
        expect(queue.getStats().backpressureActive).toBe(true);
    });
});
