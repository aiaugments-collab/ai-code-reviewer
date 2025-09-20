import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '../../src/core/context/context-builder.js';
import type { Thread } from '../../src/core/types/common-types.js';

describe('Context persistence - session/thread/tenant rehydration', () => {
    it('should rehydrate ctx.state across executions in same thread/tenant', async () => {
        // Arrange: configure builder (uses defaults if not provided)
        const builder = ContextBuilder.getInstance();

        const thread: Thread = {
            id: 'thread-context-persist',
            metadata: { description: 'test' },
        };
        const tenantId = 'tenant-context-persist';

        // Act 1: first context sets a value
        const ctx1 = await builder.createAgentContext({
            agentName: 'persist-agent',
            thread,
            tenantId,
        } as unknown as {
            agentName: string;
            thread: Thread;
            tenantId: string;
        });

        await ctx1.state.set('app', 'count', 1);

        // Act 2: new execution in same thread/tenant should read previous value
        const ctx2 = await builder.createAgentContext({
            agentName: 'persist-agent',
            thread,
            tenantId,
        } as unknown as {
            agentName: string;
            thread: Thread;
            tenantId: string;
        });

        const value = await ctx2.state.get<number>('app', 'count');

        // Assert
        expect(value).toBe(1);
    });
});
