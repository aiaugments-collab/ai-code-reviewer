/**
 * @file monitoring.unit.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
    ensureMetricsSystem,
    getLayeredMetricsSystem,
} from '../../src/observability/monitoring.js';

describe('Monitoring - LayeredMetricsSystem', () => {
    it('ensureMetricsSystem inicializa global e exporta formatos', () => {
        const sys = ensureMetricsSystem({
            enabled: true,
            collectionIntervalMs: 100000, // não coletar durante o teste
            retentionPeriodMs: 3600000,
            enableRealTime: false,
            enableHistorical: true,
            maxMetricsHistory: 10,
            exportFormats: ['json', 'prometheus', 'statsd'],
        });

        expect(getLayeredMetricsSystem()).toBe(sys);

        const json = sys.exportMetrics('json');
        expect(json).toContain('kernel');

        const prom = sys.exportMetrics('prometheus');
        expect(prom).toContain('kernel_event_count');

        const statsd = sys.exportMetrics('statsd');
        expect(statsd).toContain('kernel.event_count');
    });
});
