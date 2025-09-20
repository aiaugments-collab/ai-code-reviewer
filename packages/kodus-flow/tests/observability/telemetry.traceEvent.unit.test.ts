/**
 * @file telemetry.traceEvent.unit.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
    getTelemetry,
    type TraceItem,
} from '../../src/observability/telemetry.js';
import type { Event } from '../../src/core/types/events.js';

describe('TelemetrySystem - traceEvent', () => {
    it('cria span de evento com atributos básicos (sucesso)', async () => {
        const tel = getTelemetry({
            enabled: true,
            sampling: { rate: 1, strategy: 'probabilistic' },
        });
        const items: TraceItem[] = [];
        tel.addTraceProcessor((batch) => {
            items.push(...batch);
        });

        const ev: Event = {
            id: 'e1',
            type: 'unit.success',
            data: {},
            ts: Date.now(),
            threadId: 't1',
        };

        const res = await tel.traceEvent(ev, async () => 'ok');
        expect(res).toBe('ok');
        expect(items.length).toBeGreaterThan(0);
        const success = items.find((i) => i.name === 'event.unit.success');
        expect(success).toBeTruthy();
        expect(String(success!.attributes['eventType'])).toBe('unit.success');
        expect(typeof success!.attributes['eventTimestamp']).toBe('number');
    });

    it('registra span também quando handler lança erro', async () => {
        const tel = getTelemetry({
            enabled: true,
            sampling: { rate: 1, strategy: 'probabilistic' },
        });
        const items: TraceItem[] = [];
        tel.addTraceProcessor((batch) => {
            items.push(...batch);
        });

        const ev: Event = {
            id: 'e2',
            type: 'unit.error',
            data: {},
            ts: Date.now(),
            threadId: 't2',
        };

        await expect(
            tel.traceEvent(ev, async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');

        expect(items.some((i) => i.name === 'event.unit.error')).toBe(true);
    });
});
