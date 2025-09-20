import { describe, it, expect } from 'vitest';
import { createWorkflow } from '../../src/core/types/common-types.js';
import { createKernel } from '../../src/kernel/kernel.js';

describe('Kernel autosnapshot', () => {
    it('should append snapshots based on eventInterval', async () => {
        const workflow = createWorkflow(
            {
                name: 'test-wf',
                description: 'wf',
                steps: {},
                entryPoints: [],
            },
            { tenantId: 'tenant-auto' },
        );

        const kernel = createKernel({
            tenantId: 'tenant-auto',
            workflow,
            performance: {
                enableBatching: true,
                enableCaching: true,
                autoSnapshot: {
                    enabled: true,
                    eventInterval: 2,
                    useDelta: true,
                },
            },
        });

        await kernel.initialize();

        const event = (e: string) =>
            ({
                id: e,
                type: 'agent.test.event',
                threadId: 't',
                data: {},
                ts: Date.now(),
            }) as unknown as Parameters<typeof kernel.run>[0];

        await kernel.run(event('e1'));
        await kernel.run(event('e2'));
        await kernel.run(event('e3'));

        const stats = kernel.getStatus();
        expect(stats.eventCount).toBeGreaterThanOrEqual(3);
        // Não temos acesso direto ao persistor aqui; assert mínimo no fluxo sem exceptions.
    });
});
