/**
 * @file telemetry.more.unit.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getTelemetry,
    getActiveSpan,
    addSpanAttribute,
    withTelemetry,
    TelemetrySystem,
} from '../../src/observability/telemetry.js';

describe('TelemetrySystem - Extras', () => {
    beforeEach(() => {
        const tel = getTelemetry();
        tel.updateConfig({
            enabled: true,
            sampling: { rate: 1, strategy: 'probabilistic' },
        });
    });

    it('getActiveSpan e addSpanAttribute funcionam dentro de withTelemetry', async () => {
        await withTelemetry('op', async () => {
            const span = getActiveSpan();
            expect(span).toBeDefined();
            addSpanAttribute('test.key', 'value');
        });
    });

    it('setTraceProcessors substitui processors anteriores', async () => {
        const tel = getTelemetry();
        const first: string[] = [];
        const second: string[] = [];
        tel.setTraceProcessors([
            (items) => first.push(...items.map((i) => i.name)),
        ]);
        tel.setTraceProcessors([
            (items) => second.push(...items.map((i) => i.name)),
        ]);

        await withTelemetry('root', async () => {});
        await new Promise((r) => setTimeout(r, 0));
        // Os processors são chamados no onEnd do span em withSpan; como usamos o global getTelemetry
        // e setTraceProcessors substitui a lista, só o segundo deve receber eventos subsequentes.
        // Validamos que o primeiro não recebe mais nada após a substituição.
        expect(first.length).toBe(0);
        expect(second.length).toBeGreaterThan(0);
    });

    it('honra configuração programática desativando spans', async () => {
        const telLocal = new TelemetrySystem({
            enabled: false, // ✅ Programmatic config instead of env vars
            sampling: { rate: 1, strategy: 'probabilistic' },
        });
        const spans: string[] = [];
        telLocal.setTraceProcessors([
            (items) => spans.push(...items.map((i) => i.name)),
        ]);
        const span = telLocal.startSpan('disabled.local');
        await telLocal.withSpan(span, async () => {});
        expect(spans.length).toBe(0);
    });
});
