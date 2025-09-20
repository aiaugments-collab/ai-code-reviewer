import { describe, it, expect } from 'vitest';
import { createWorkflow } from '../../src/core/types/workflow-types.js';
import { createKernel } from '../../src/kernel/kernel.js';
import type { Event } from '../../src/core/types/events.js';

describe('Kernel tenant isolation + autosnapshot smoke', () => {
    it('keeps tenant context isolated even when autosnapshot triggers', async () => {
        const workflow = createWorkflow(
            {
                name: 'wf',
                description: 'isolated',
                steps: {},
                entryPoints: [],
            },
            { tenantId: 'tenant-A' },
        );

        const kernelA = createKernel({
            tenantId: 'tenant-A',
            workflow,
            isolation: { enableTenantIsolation: true },
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

        await kernelA.initialize();

        // Set value under tenant A
        kernelA.setContext('ns', 'k', 'A');
        const makeEvent = (id: string): Event => ({
            id,
            type: 'agent.test',
            data: {},
            ts: Date.now(),
            threadId: 't',
        });
        await kernelA.run(makeEvent('e1'));
        await kernelA.run(makeEvent('e2'));

        const workflowB = createWorkflow(
            { name: 'wf', description: 'isolated', steps: {}, entryPoints: [] },
            { tenantId: 'tenant-B' },
        );
        const kernelB = createKernel({
            tenantId: 'tenant-B',
            workflow: workflowB,
            isolation: { enableTenantIsolation: true },
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
        await kernelB.initialize();

        // Ensure kernel B doesn't see A's value
        const seenByB = kernelB.getContext<string>('ns', 'k');
        expect(seenByB).toBeUndefined();
    });
});
