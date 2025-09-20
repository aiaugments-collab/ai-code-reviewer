/**
 * @file observability.system.unit.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import dns from 'dns';
import {
    ObservabilitySystem,
    getObservability,
} from '../../src/observability/index.js';

describe('ObservabilitySystem - Unit', () => {
    const originalEnv = { ...process.env };
    let infoSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        infoSpy.mockRestore();
        vi.restoreAllMocks();
    });

    it('measure() deve medir duração e retornar resultado', async () => {
        const obs = getObservability({ telemetry: { enabled: true } });
        // Debug system gera duration; como é assíncrono, usamos uma função com pequeno delay
        const { result, duration } = await obs.measure(
            'calc',
            async () => {
                await new Promise((r) => setTimeout(r, 1));
                return 42;
            },
            'perf',
        );
        expect(result).toBe(42);
        expect(typeof duration).toBe('number');
        expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('updateConfig() atualiza sampling da Telemetry', () => {
        const obs = getObservability();
        obs.updateConfig({
            telemetry: { sampling: { rate: 0.2, strategy: 'probabilistic' } },
        });
        expect(obs.telemetry.getConfig().sampling.rate).toBe(0.2);
    });

    it('getHealthStatus() e runHealthChecks() retornam estrutura válida', async () => {
        const obs = getObservability();
        const lookupSpy = vi
            .spyOn(dns, 'lookup')
            // @ts-expect-error vi mock types
            .mockImplementation((_host: string, cb: (err: null) => void) =>
                cb(null),
            );

        const status = obs.getHealthStatus();
        expect(status.overall).toMatch(/healthy|degraded|unhealthy/);
        expect(status.components.logging).toBeDefined();
        expect(status.components.telemetry).toBeDefined();
        expect(status.components.monitoring).toBeDefined();
        expect(status.components.debugging).toBeDefined();

        const checks = await obs.runHealthChecks();
        expect(typeof checks.memory).toBe('boolean');
        expect(typeof checks.cpu).toBe('boolean');
        expect(typeof checks.connectivity).toBe('boolean');
        expect(typeof checks.overall).toBe('boolean');

        lookupSpy.mockRestore();
    });

    it('constructor em production aplica ajustes (sampling default 0.1)', () => {
        const localObs = new ObservabilitySystem({ environment: 'production' });
        expect(localObs['telemetry'].getConfig().sampling.rate).toBe(0.1);
    });
});
