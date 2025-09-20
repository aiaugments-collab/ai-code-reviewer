import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { getObservability } from '../../src/observability/index.js';
import type { WorkflowContext } from '../../src/core/types/workflow-types.js';

describe.sequential('Runtime V2 - Performance/Throughput', () => {
    it('processa alto volume com throughput adequado e sem perdas', async () => {
        const observability = getObservability({ environment: 'test' });
        const context = {
            executionId: 'rt-perf',
            tenantId: 't1',
        } as unknown as WorkflowContext;

        const runtime = createRuntime(context, observability, {
            queueSize: 20000,
            batchSize: 200,
            enableObservability: false,
            enableAcks: true,
            ackTimeout: 2000,
            maxRetries: 0,
            queueConfig: { maxConcurrent: 25 },
        });

        const TOTAL = 4000;
        let handled = 0;

        runtime.on('v2.perf', async () => {
            handled++;
        });

        // Enfileirar em paralelo
        const enqueueStart = Date.now();
        const results = await Promise.all(
            Array.from({ length: TOTAL }).map((_, i) =>
                runtime.emitAsync('v2.perf', { i }, { priority: i % 3 }),
            ),
        );
        const enqueueMs = Date.now() - enqueueStart;
        expect(results.every((r) => r.success && r.queued)).toBe(true);

        const start = Date.now();
        const stats = await runtime.process(true);
        const elapsedMs = Date.now() - start;

        // Validações de robustez
        expect(handled).toBe(TOTAL);
        expect(stats && stats.processed).toBe(TOTAL);
        expect(stats && stats.acked).toBe(TOTAL);
        expect(stats && stats.failed).toBe(0);

        const final = runtime.getStats();
        const queueStats = final.queue as {
            size: number;
            processedEventsCount: number;
        };
        expect(queueStats.size).toBe(0);

        // Throughput mínimo razoável para ambiente de teste (evita flakiness)
        const throughput = (TOTAL / Math.max(1, elapsedMs)) * 1000; // ev/s
        // Expectativa mais exigente para ambientes CI: >= 1200 ev/s
        expect(throughput).toBeGreaterThanOrEqual(1200);

        // Garantir que enfileiramento foi rápido o suficiente (não bloco)
        expect(enqueueMs).toBeLessThan(5000);
    }, 30000); // timeout de 30s para evitar flakiness em ambientes lentos
});
