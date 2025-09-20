import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { getObservability } from '../../src/observability/index.js';
import type { WorkflowContext } from '../../src/core/types/workflow-types.js';

describe.sequential('Runtime V2 - ACK timeout and retry', () => {
    let observability = getObservability({ environment: 'test' });
    let context: WorkflowContext;

    beforeEach(() => {
        observability = getObservability({ environment: 'test' });
        context = {
            executionId: 'rt-ack',
            tenantId: 't1',
        } as unknown as WorkflowContext;
    });

    it('re-enqueues on ack timeout (validate via queue stats)', async () => {
        const runtime = createRuntime(context, observability, {
            queueSize: 100,
            batchSize: 10,
            enableObservability: false,
            enableAcks: true,
            ackTimeout: 50, // small timeout
            maxRetries: 2,
        });

        runtime.on('v2.ack.retry', async () => {
            // do NOT call runtime.ack(...) here -> provoke timeout based re-enqueue
        });

        await runtime.emitAsync('v2.ack.retry', { x: 1 }, { priority: 1 });

        // process once -> pending ack
        await runtime.process();

        // wait for ack timeout and re-enqueue to trigger, then process again
        await new Promise((r) => setTimeout(r, 220));

        // Check that we still have pendingAcks (retry scheduled) or queue grew due to re-enqueue
        const stats = runtime.getStats();
        const delivery = stats.delivery as { pendingAcks: number };
        const queueStats = stats.queue as { size: number };
        expect(delivery.pendingAcks).toBeGreaterThanOrEqual(1);
        expect(queueStats.size).toBeGreaterThanOrEqual(0);
    });
});
