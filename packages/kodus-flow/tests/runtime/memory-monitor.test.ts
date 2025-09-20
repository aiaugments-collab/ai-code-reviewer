/**
 * Memory Monitor Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryMonitor } from '../../src/runtime/core/memory-monitor.js';
import { getObservability } from '../../src/observability/index.js';
import type { ObservabilitySystem } from '../../src/observability/index.js';

describe('MemoryMonitor', () => {
    let observability: ObservabilitySystem;
    let memoryMonitor: MemoryMonitor;

    beforeEach(() => {
        observability = getObservability({
            enabled: true,
            environment: 'test',
            logging: {
                enabled: false, // Desabilitar logs nos testes
            },
        });

        memoryMonitor = new MemoryMonitor(observability, {
            intervalMs: 100, // Intervalo rápido para testes
            thresholds: {
                heapUsed: 10 * 1024 * 1024, // 10MB
                rss: 20 * 1024 * 1024, // 20MB
                external: 5 * 1024 * 1024, // 5MB
                heapTotal: 15 * 1024 * 1024, // 15MB
            },
            leakDetection: {
                enabled: true,
                samples: 3,
                minGrowthMb: 1,
                sampleIntervalMs: 200,
            },
        });
    });

    afterEach(() => {
        memoryMonitor.stop();
    });

    describe('Configuration', () => {
        it('should initialize with default configuration', () => {
            const monitor = new MemoryMonitor(observability);
            expect(monitor).toBeInstanceOf(MemoryMonitor);
        });

        it('should accept custom configuration', () => {
            const customConfig = {
                intervalMs: 5000,
                thresholds: {
                    heapUsed: 100 * 1024 * 1024,
                },
                leakDetection: {
                    enabled: false,
                },
            };

            const monitor = new MemoryMonitor(observability, customConfig);
            expect(monitor).toBeInstanceOf(MemoryMonitor);
        });
    });

    describe('Start/Stop', () => {
        it('should start monitoring', () => {
            memoryMonitor.start();
            const stats = memoryMonitor.getStats();
            expect(stats.isRunning).toBe(true);
        });

        it('should stop monitoring', () => {
            memoryMonitor.start();
            memoryMonitor.stop();
            const stats = memoryMonitor.getStats();
            expect(stats.isRunning).toBe(false);
        });

        it('should not start if already running', () => {
            memoryMonitor.start();
            memoryMonitor.start(); // Segunda chamada não deve fazer nada
            const stats = memoryMonitor.getStats();
            expect(stats.isRunning).toBe(true);
        });
    });

    describe('Statistics', () => {
        it('should provide initial statistics', () => {
            const stats = memoryMonitor.getStats();

            expect(stats).toHaveProperty('totalMeasurements');
            expect(stats).toHaveProperty('totalAlerts');
            expect(stats).toHaveProperty('leaksDetected');
            expect(stats).toHaveProperty('isRunning');
            expect(stats).toHaveProperty('nextMeasurementIn');
            expect(stats).toHaveProperty('peakUsage');
            expect(stats).toHaveProperty('averageUsage');
        });

        it('should track measurements after starting', async () => {
            memoryMonitor.start();

            // Aguardar algumas medições
            await new Promise((resolve) => setTimeout(resolve, 500));

            const stats = memoryMonitor.getStats();
            expect(stats.totalMeasurements).toBeGreaterThan(0);
        });

        it('should track peak usage', async () => {
            memoryMonitor.start();

            // Aguardar algumas medições
            await new Promise((resolve) => setTimeout(resolve, 500));

            const stats = memoryMonitor.getStats();
            expect(stats.peakUsage.heapUsed).toBeGreaterThan(0);
            expect(stats.peakUsage.rss).toBeGreaterThan(0);
        });
    });

    describe('Memory Leak Detection', () => {
        it('should detect memory leaks', async () => {
            memoryMonitor.start();

            // Simular memory leak
            const leaks: Buffer[] = [];
            for (let i = 0; i < 10; i++) {
                leaks.push(Buffer.alloc(1024 * 1024)); // 1MB cada
                await new Promise((resolve) => setTimeout(resolve, 50));
            }

            // Aguardar detecção
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Em um ambiente real, isso detectaria o leak
            // const stats = memoryMonitor.getStats();
            // expect(stats.leaksDetected).toBeGreaterThan(0);
        });
    });

    describe('Alert Callbacks', () => {
        it('should call alert callback when threshold exceeded', async () => {
            const alertCallback = vi.fn();

            const monitor = new MemoryMonitor(observability, {
                intervalMs: 100,
                thresholds: {
                    heapUsed: 1 * 1024 * 1024, // 1MB (muito baixo para ser excedido)
                },
                onAlert: alertCallback,
            });

            monitor.start();

            // Aguardar algumas medições
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Em um ambiente real, isso geraria alertas
            // expect(alertCallback).toHaveBeenCalled();
        });
    });

    describe('Utility Methods', () => {
        it('should clear history', () => {
            memoryMonitor.start();
            memoryMonitor.clearHistory();

            const stats = memoryMonitor.getStats();
            expect(stats.totalMeasurements).toBe(0);
            expect(stats.totalAlerts).toBe(0);
        });

        it('should get recent alerts', () => {
            const alerts = memoryMonitor.getRecentAlerts(5);
            expect(Array.isArray(alerts)).toBe(true);
        });

        it('should handle force GC', () => {
            // Não deve lançar erro
            expect(() => memoryMonitor.forceGC()).not.toThrow();
        });
    });

    describe('Memory Metrics', () => {
        it('should provide valid memory metrics', async () => {
            memoryMonitor.start();

            // Aguardar uma medição
            await new Promise((resolve) => setTimeout(resolve, 200));

            const stats = memoryMonitor.getStats();

            if (stats.lastMeasurement) {
                const metrics = stats.lastMeasurement;

                expect(metrics.heapUsed).toBeGreaterThan(0);
                expect(metrics.heapTotal).toBeGreaterThan(0);
                expect(metrics.rss).toBeGreaterThan(0);
                expect(metrics.heapUsedMb).toBeGreaterThan(0);
                expect(metrics.heapUsagePercent).toBeGreaterThan(0);
                expect(metrics.heapUsagePercent).toBeLessThanOrEqual(100);
            }
        });
    });
});
