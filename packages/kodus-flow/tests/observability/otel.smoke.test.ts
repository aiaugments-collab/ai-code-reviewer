import { describe, it, expect } from 'vitest';
import {
    createOtelTracerAdapter,
    getObservability,
    shutdownObservability,
} from '../../src/observability/index.js';

describe('OTEL adapter + shutdown (smoke)', () => {
    it('creates an otel tracer adapter and starts a span', async () => {
        const adapter = await createOtelTracerAdapter();
        const obs = getObservability({
            telemetry: { externalTracer: adapter },
        });
        const span = obs.telemetry.startSpan('smoke.test');
        span.setAttribute('test.attr', 'ok');
        await obs.telemetry.withSpan(span, async () => {});
        expect(true).toBe(true);
    });

    it('shutdownObservability flushes and disposes without throwing', async () => {
        await expect(shutdownObservability()).resolves.not.toThrow();
    });
});
