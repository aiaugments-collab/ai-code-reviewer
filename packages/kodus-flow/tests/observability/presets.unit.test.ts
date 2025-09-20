/**
 * @file presets.unit.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
    setupProductionObservability,
    setupDebugObservability,
} from '../../src/observability/index.js';

describe('Observability presets', () => {
    it('setupProductionObservability aplica sampling default <= 0.1', async () => {
        const obs = await setupProductionObservability();
        expect(obs.telemetry.getConfig().sampling.rate).toBeLessThanOrEqual(
            0.1,
        );
    });

    it('setupDebugObservability mantém ambiente development', async () => {
        const obs = await setupDebugObservability();
        expect(obs['config'].environment).toBe('development');
    });
});
