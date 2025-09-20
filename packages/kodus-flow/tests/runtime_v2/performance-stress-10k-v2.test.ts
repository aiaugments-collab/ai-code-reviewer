import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { getObservability } from '../../src/observability/index.js';
import type { WorkflowContext } from '../../src/core/types/workflow-types.js';

describe.sequential('Runtime V2 - Stress 10k events', () => {
    it('processa 10k eventos com estabilidade e sem perdas', async () => {
        const observability = getObservability({ environment: 'test' });
        const context = {
            executionId: 'rt-10k',
            tenantId: 't1',
        } as unknown as WorkflowContext;

        const runtime = createRuntime(context, observability, {
            queueSize: 15000,
            batchSize: 300,
            enableObservability: false,
            enableAcks: true,
            ackTimeout: 5000,
            maxRetries: 0,
            queueConfig: { maxConcurrent: 30 },
        });

        const TOTAL = 10000;
        let handled = 0;
        runtime.on('v2.stress', async () => {
            handled++;
        });

        // Enfileirar em blocos para reduzir memória
        for (let i = 0; i < TOTAL; i += 1000) {
            await Promise.all(
                Array.from({ length: Math.min(1000, TOTAL - i) }).map((_, j) =>
                    runtime.emitAsync(
                        'v2.stress',
                        { k: i + j },
                        { priority: (i + j) % 3 },
                    ),
                ),
            );
        }

        const start = Date.now();
        const stats = await runtime.process(true);
        const elapsedMs = Date.now() - start;

        expect(handled).toBe(TOTAL);
        expect(stats && stats.processed).toBe(TOTAL);
        expect(stats && stats.acked).toBe(TOTAL);
        expect(stats && stats.failed).toBe(0);

        const queueStats = runtime.getStats().queue as { size: number };
        expect(queueStats.size).toBe(0);

        // Throughput mínimo conservador p/ 10k em ambientes de teste
        const throughput = (TOTAL / Math.max(1, elapsedMs)) * 1000;
        expect(throughput).toBeGreaterThanOrEqual(1000);
    }, 60000);
});
