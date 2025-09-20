import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '../../src/core/context/context-builder.js';
import type { Thread } from '../../src/core/types/common-types.js';

describe('Context isolation by thread and tenant', () => {
    it('isolates context between different threads in the same tenant', async () => {
        const builder = ContextBuilder.getInstance();
        const tenantId = 'tenant-iso-1';

        const threadA: Thread = {
            id: 'thread-A',
            metadata: { description: 'A' },
        };
        const threadB: Thread = {
            id: 'thread-B',
            metadata: { description: 'B' },
        };

        const ctxA = await builder.createAgentContext({
            agentName: 'agent',
            thread: threadA,
            tenantId,
        } as unknown as {
            agentName: string;
            thread: Thread;
            tenantId: string;
        });

        const ctxB = await builder.createAgentContext({
            agentName: 'agent',
            thread: threadB,
            tenantId,
        } as unknown as {
            agentName: string;
            thread: Thread;
            tenantId: string;
        });

        await ctxA.state.set('ns', 'k', 'value-A');
        await ctxB.state.set('ns', 'k', 'value-B');

        const readBackA = await ctxA.state.get<string>('ns', 'k');
        const readBackB = await ctxB.state.get<string>('ns', 'k');

        expect(readBackA).toBe('value-A');
        expect(readBackB).toBe('value-B');
    });

    it('isolates context between different tenants using the same thread id', async () => {
        const builder = ContextBuilder.getInstance();
        const thread: Thread = {
            id: 'shared-thread',
            metadata: { description: 'X' },
        };

        const ctxTenant1 = await builder.createAgentContext({
            agentName: 'agent',
            thread,
            tenantId: 'tenant-1',
        } as unknown as {
            agentName: string;
            thread: Thread;
            tenantId: string;
        });

        const ctxTenant2 = await builder.createAgentContext({
            agentName: 'agent',
            thread,
            tenantId: 'tenant-2',
        } as unknown as {
            agentName: string;
            thread: Thread;
            tenantId: string;
        });

        await ctxTenant1.state.set('ns', 'secureKey', 'secret-T1');
        await ctxTenant2.state.set('ns', 'secureKey', 'secret-T2');

        const valueT1 = await ctxTenant1.state.get<string>('ns', 'secureKey');
        const valueT2 = await ctxTenant2.state.get<string>('ns', 'secureKey');

        expect(valueT1).toBe('secret-T1');
        expect(valueT2).toBe('secret-T2');
    });
});
