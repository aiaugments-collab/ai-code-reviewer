import { describe, it, expect } from 'vitest';
import { EventQueue } from '../../src/runtime/core/event-queue.js';
import { getObservability } from '../../src/observability/index.js';
import { createEvent } from '../../src/core/types/events.js';

describe.sequential('EventQueue V2 - Large payloads compression', () => {
    it('marca metadata.compressed e mantém throughput razoável', async () => {
        const observability = getObservability({ environment: 'test' });
        const queue = new EventQueue(observability, {
            enableObservability: false,
            maxQueueDepth: 5000,
            batchSize: 100,
            enableAutoScaling: false,
            largeEventThreshold: 10 * 1024, // 10KB
            enableCompression: true,
        });

        // Construir payload grande (~20KB)
        const big = 'x'.repeat(20 * 1024);
        for (let i = 0; i < 200; i++) {
            await queue.enqueue(createEvent('v2.large', { big, i }));
        }

        const start = Date.now();
        let compressedCount = 0;
        await queue.processAll(async (ev) => {
            if (ev.metadata?.compressed) compressedCount++;
        });
        const ms = Date.now() - start;

        expect(compressedCount).toBeGreaterThan(0);
        expect(queue.getStats().size).toBe(0);
        // Throughput mínimo (200 eventos em < 3s) para ambiente de teste
        expect(ms).toBeLessThan(3000);
    }, 20000);
});
