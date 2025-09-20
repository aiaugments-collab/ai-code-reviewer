import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { getObservability } from '../../src/observability/index.js';
import type { WorkflowContext } from '../../src/core/types/workflow-types.js';

describe('Runtime V2 - Basic', () => {
    let runtime: ReturnType<typeof createRuntime>;

    beforeEach(() => {
        const observability = getObservability({ environment: 'test' });
        const context = {
            executionId: 'rt2',
            tenantId: 't1',
        } as unknown as WorkflowContext;
        runtime = createRuntime(context, observability, {
            queueSize: 100,
            batchSize: 10,
            enableObservability: true,
            enableAcks: true,
            maxRetries: 1,
        });
    });

    it('should register, emit and process one event', async () => {
        let processed = 0;
        runtime.on('test.v2', async () => {
            processed++;
        });
        const res = runtime.emit('test.v2', { a: 1 }, { correlationId: 'c1' });
        expect(res.success).toBe(true);
        await runtime.process();
        expect(processed).toBe(1);
    });
});
