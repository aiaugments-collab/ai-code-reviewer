import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { getObservability } from '../../src/observability/index.js';
import type { WorkflowContext } from '../../src/core/types/workflow-types.js';

// Validates that global semaphore limits concurrent handler executions

describe.sequential('Runtime V2 - Global concurrency (semaphore)', () => {
    let observability = getObservability({ environment: 'test' });
    let context: WorkflowContext;

    beforeEach(() => {
        observability = getObservability({ environment: 'test' });
        context = {
            executionId: 'rt-conc',
            tenantId: 't1',
        } as unknown as WorkflowContext;
    });

    it('limits in-flight handlers to ~maxConcurrent', async () => {
        const runtime = createRuntime(context, observability, {
            queueSize: 100,
            batchSize: 50,
            enableObservability: false,
            enableAcks: false,
            // use EventQueue default maxConcurrent (25) but we'll simulate contention
            queueConfig: { maxConcurrent: 3 },
        });

        let inFlight = 0;
        let peak = 0;

        runtime.on('v2.conc', async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 40));
            inFlight--;
        });

        for (let i = 0; i < 10; i++) {
            await runtime.emitAsync('v2.conc', { i }, { priority: 1 });
        }

        await runtime.process();

        expect(peak).toBeLessThanOrEqual(4); // tolerate small jitter
    });
});
