/**
 * @file runtime.middleware.test.ts
 */

import { describe, it, expect } from 'vitest';
import { withObservability } from '../../src/runtime/middleware/observability.js';
import { getObservability } from '../../src/observability/index.js';
import type { Event } from '../../src/core/types/events.js';
import type { TraceItem } from '../../src/observability/telemetry.js';

describe('Runtime Middleware - withObservability', () => {
    it('cria span por evento e registra exceções', async () => {
        const obs = getObservability({
            telemetry: {
                enabled: true,
                sampling: { rate: 1, strategy: 'probabilistic' },
            },
        });
        obs.updateConfig({
            telemetry: {
                enabled: true,
                sampling: { rate: 1, strategy: 'probabilistic' },
            },
        });

        const collected: TraceItem[] = [];
        obs.telemetry.setTraceProcessors([(items) => collected.push(...items)]);

        const middleware = withObservability({ namePrefix: 'event.process' });

        const handler = async (_ev: Event) => {
            throw new Error('boom');
        };
        const wrapped = middleware(handler);

        const ev: Event = {
            id: 'e1',
            type: 'my.event',
            data: {},
            ts: Date.now(),
            threadId: 't1',
            metadata: { tenantId: 't', correlationId: 'c' },
        };

        await expect(wrapped(ev)).rejects.toThrow('boom');

        const names = collected.map((i) => i.name);
        expect(names).toContain('event.process.my.event');
        const attrsMerged = collected.reduce<Record<string, unknown>>(
            (acc, i) => ({ ...acc, ...i.attributes }),
            {},
        );
        expect(String(attrsMerged['tenant.id'])).toBe('t');
        expect(String(attrsMerged['correlation.id'])).toBe('c');
    });
});
