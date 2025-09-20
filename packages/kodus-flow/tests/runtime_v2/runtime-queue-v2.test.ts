import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { getObservability } from '../../src/observability/index.js';
import type { WorkflowContext } from '../../src/core/types/workflow-types.js';

describe.sequential('Runtime V2 - Queue behavior via Runtime API', () => {
    let runtime: ReturnType<typeof createRuntime>;
    const processed: Array<{ id: string; type: string }> = [];

    beforeEach(() => {
        processed.length = 0;
        const observability = getObservability({ environment: 'test' });
        const context = {
            executionId: 'rtq',
            tenantId: 't1',
        } as unknown as WorkflowContext;
        runtime = createRuntime(context, observability, {
            queueSize: 100,
            batchSize: 10,
            enableObservability: false,
            enableAcks: true,
            maxRetries: 1,
        });
    });

    it('processes events in priority order (high -> medium -> low)', async () => {
        runtime.on('v2.rtq', async (ev) => {
            processed.push({ id: ev.id, type: ev.type });
        });

        const low = runtime.createEvent('v2.rtq', { p: 'low' });
        const med = runtime.createEvent('v2.rtq', { p: 'med' });
        const high = runtime.createEvent('v2.rtq', { p: 'high' });

        // enqueue with priorities
        await runtime.emitAsync(low.type, low.data, {
            priority: 0,
            correlationId: 'c',
        });
        await runtime.emitAsync(med.type, med.data, {
            priority: 1,
            correlationId: 'c',
        });
        await runtime.emitAsync(high.type, high.data, {
            priority: 2,
            correlationId: 'c',
        });

        await runtime.process();

        // should preserve priority order in processing
        expect(processed).toHaveLength(3);
        // processed[0] should be high, then med, then low
        expect(processed[0].type).toBe(high.type);
        expect(processed[1].type).toBe(med.type);
        expect(processed[2].type).toBe(low.type);
    });

    it('processes all enqueued events and clears the queue', async () => {
        runtime.on('v2.rtq.all', async (ev) => {
            processed.push({ id: ev.id, type: ev.type });
        });

        for (let i = 0; i < 25; i++) {
            await runtime.emitAsync('v2.rtq.all', { i }, { priority: i % 3 });
        }

        const before = runtime.getStats().queue as { size: number };
        expect(before.size).toBeGreaterThan(0);

        await runtime.process();

        expect(processed).toHaveLength(25);
        const after = runtime.getStats().queue as { size: number };
        expect(after.size).toBe(0);
    });
});
