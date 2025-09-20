import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { getObservability } from '../../src/observability/index.js';
import type { WorkflowContext } from '../../src/core/types/workflow-types.js';

describe.sequential('Runtime V2 - Performance Burst with Backpressure', () => {
    it('ativa backpressure sob burst e processa sem travar', async () => {
        const observability = getObservability({ environment: 'test' });
        const context = {
            executionId: 'rt-burst',
            tenantId: 't1',
        } as unknown as WorkflowContext;

        const queueSize = 500;
        const runtime = createRuntime(context, observability, {
            queueSize,
            batchSize: 100,
            enableObservability: false,
            enableAcks: false,
            queueConfig: { maxConcurrent: 10 },
        });

        const TOTAL = 700;
        const results = await Promise.all(
            Array.from({ length: TOTAL }).map((_, i) =>
                runtime.emitAsync('v2.burst', { i }, { priority: i % 3 }),
            ),
        );

        const successes = results.filter((r) => r.success).length;
        expect(successes).toBeLessThanOrEqual(queueSize);
        expect(successes).toBeGreaterThan(queueSize * 0.8);

        // Ler backpressure antes de drenar (forçar atualização do cache)
        const q = runtime.getEnhancedQueue?.();
        q?.['shouldActivateBackpressure']?.();
        const stats = q?.getStats() as { backpressureActive: boolean };
        expect(stats.backpressureActive).toBe(true);

        // Agora processar remanescente
        await runtime.process();
        const final = runtime.getStats().queue as { size: number };
        expect(final.size).toBe(0);
    }, 20000);
});
