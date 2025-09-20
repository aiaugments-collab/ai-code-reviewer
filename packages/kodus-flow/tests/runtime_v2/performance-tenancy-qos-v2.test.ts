import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { getObservability } from '../../src/observability/index.js';
import type { WorkflowContext } from '../../src/core/types/workflow-types.js';

describe.sequential('Runtime V2 - Tenancy baseline fairness', () => {
    it('processa tenants com fairness aproximada sob a mesma config', async () => {
        const observability = getObservability({ environment: 'test' });

        const ctx1 = {
            executionId: 'rt-tenant-1',
            tenantId: 't1',
        } as unknown as WorkflowContext;
        const ctx2 = {
            executionId: 'rt-tenant-2',
            tenantId: 't2',
        } as unknown as WorkflowContext;

        const r1 = createRuntime(ctx1, observability, {
            queueSize: 5000,
            batchSize: 100,
            enableObservability: false,
            enableAcks: false,
            queueConfig: { maxConcurrent: 15 },
        });
        const r2 = createRuntime(ctx2, observability, {
            queueSize: 5000,
            batchSize: 100,
            enableObservability: false,
            enableAcks: false,
            queueConfig: { maxConcurrent: 15 },
        });

        const N = 3000;
        let h1 = 0;
        let h2 = 0;

        r1.on('v2.qos', async () => {
            h1++;
        });
        r2.on('v2.qos', async () => {
            h2++;
        });

        await Promise.all([
            Promise.all(
                Array.from({ length: N }).map((_, i) =>
                    r1.emitAsync('v2.qos', { i }, { priority: i % 3 }),
                ),
            ),
            Promise.all(
                Array.from({ length: N }).map((_, i) =>
                    r2.emitAsync('v2.qos', { i }, { priority: (i + 1) % 3 }),
                ),
            ),
        ]);

        await Promise.all([r1.process(), r2.process()]);

        // Fairness aproximada: diferença <= 10%
        const diff = Math.abs(h1 - h2);
        expect(diff).toBeLessThanOrEqual(N * 0.1);
    }, 30000);
});
