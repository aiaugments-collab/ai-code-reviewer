import {
    MemoryAlert,
    MemoryMetrics,
    MemoryMonitorConfig,
    MemoryMonitorStats,
} from '../../core/types/allTypes.js';
import type { ObservabilitySystem } from '../../observability/index.js';

export class MemoryMonitor {
    private config: Required<MemoryMonitorConfig>;
    private intervalId?: NodeJS.Timeout;
    private leakDetectionId?: NodeJS.Timeout;
    private measurements: MemoryMetrics[] = [];
    private alerts: MemoryAlert[] = [];
    private isRunning = false;
    private lastMeasurementTime = 0;

    // ✅ ADICIONADO: Throttling para evitar spam de alertas
    private lastHighUsageAlert = 0;
    private readonly highUsageAlertThrottleMs = 30000; // 30s entre alertas de uso alto

    constructor(
        private observability: ObservabilitySystem,
        config: MemoryMonitorConfig = {},
    ) {
        this.config = {
            intervalMs: 30000,
            enabled: false,
            onAlert: () => {},
            ...config,
            thresholds: {
                heapUsed: 512 * 1024 * 1024,
                rss: 512 * 1024 * 1024,
                external: 512 * 1024 * 1024,
                heapTotal: 512 * 1024 * 1024,
                ...config.thresholds,
            },
            leakDetection: {
                enabled: false,
                samples: 5,
                minGrowthMb: 100,
                sampleIntervalMs: 60000,
                ...config.leakDetection,
            },
        };
    }

    /**
     * Iniciar monitoramento
     */
    start(): void {
        if (this.isRunning || !this.config.enabled) {
            return;
        }

        this.isRunning = true;

        // Medição inicial
        this.measure();

        // Intervalo principal
        this.intervalId = setInterval(() => {
            this.measure();
        }, this.config.intervalMs);

        // Detecção de memory leaks
        if (this.config.leakDetection.enabled) {
            this.leakDetectionId = setInterval(() => {
                this.detectMemoryLeak();
            }, this.config.leakDetection.sampleIntervalMs);
        }

        this.observability.log('info', 'Memory monitor started', {
            intervalMs: this.config.intervalMs,
            thresholds: this.config.thresholds,
            leakDetection: this.config.leakDetection,
        });
    }

    /**
     * Parar monitoramento
     */
    stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }

        if (this.leakDetectionId) {
            clearInterval(this.leakDetectionId);
            this.leakDetectionId = undefined;
        }

        this.observability.log('info', 'Memory monitor stopped');
    }

    /**
     * Medir uso de memória atual
     */
    private measure(): MemoryMetrics {
        const memUsage = process.memoryUsage();
        const timestamp = Date.now();

        const metrics: MemoryMetrics = {
            timestamp,
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            heapFree: memUsage.heapTotal - memUsage.heapUsed,
            rss: memUsage.rss,
            external: memUsage.external,
            arrayBuffers: memUsage.arrayBuffers,
            heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
            rssMb: Math.round(memUsage.rss / 1024 / 1024),
            externalMb: Math.round(memUsage.external / 1024 / 1024),
            heapUsagePercent: Math.round(
                (memUsage.heapUsed / memUsage.heapTotal) * 100,
            ),
        };

        this.measurements.push(metrics);
        this.lastMeasurementTime = timestamp;

        // Manter apenas últimas 100 medições
        if (this.measurements.length > 100) {
            this.measurements = this.measurements.slice(-100);
        }

        // Verificar thresholds
        this.checkThresholds(metrics);

        // Log de métricas
        this.observability.log('debug', 'Memory metrics', {
            heapUsedMb: metrics.heapUsedMb,
            heapTotalMb: metrics.heapTotalMb,
            rssMb: metrics.rssMb,
            externalMb: metrics.externalMb,
            heapUsagePercent: metrics.heapUsagePercent,
        });

        return metrics;
    }

    /**
     * Verificar se thresholds foram excedidos
     */
    private checkThresholds(metrics: MemoryMetrics): void {
        const { thresholds } = this.config;

        // Heap usado
        if (thresholds.heapUsed && metrics.heapUsed > thresholds.heapUsed) {
            this.createAlert({
                type: 'THRESHOLD_EXCEEDED',
                severity:
                    metrics.heapUsed > thresholds.heapUsed * 1.5
                        ? 'CRITICAL'
                        : 'ERROR',
                message: `Heap usage exceeded threshold: ${metrics.heapUsedMb}MB > ${Math.round(thresholds.heapUsed / 1024 / 1024)}MB`,
                metrics,
                threshold: thresholds.heapUsed,
            });
        }

        // RSS
        if (thresholds.rss && metrics.rss > thresholds.rss) {
            this.createAlert({
                type: 'THRESHOLD_EXCEEDED',
                severity:
                    metrics.rss > thresholds.rss * 1.5 ? 'CRITICAL' : 'ERROR',
                message: `RSS exceeded threshold: ${metrics.rssMb}MB > ${Math.round(thresholds.rss / 1024 / 1024)}MB`,
                metrics,
                threshold: thresholds.rss,
            });
        }

        // External memory
        if (thresholds.external && metrics.external > thresholds.external) {
            this.createAlert({
                type: 'THRESHOLD_EXCEEDED',
                severity: 'WARNING',
                message: `External memory exceeded threshold: ${metrics.externalMb}MB > ${Math.round(thresholds.external / 1024 / 1024)}MB`,
                metrics,
                threshold: thresholds.external,
            });
        }

        // Heap total
        if (thresholds.heapTotal && metrics.heapTotal > thresholds.heapTotal) {
            this.createAlert({
                type: 'THRESHOLD_EXCEEDED',
                severity: 'WARNING',
                message: `Total heap exceeded threshold: ${metrics.heapTotalMb}MB > ${Math.round(thresholds.heapTotal / 1024 / 1024)}MB`,
                metrics,
                threshold: thresholds.heapTotal,
            });
        }

        // Uso alto (>80%)
        if (metrics.heapUsagePercent > 80) {
            const now = Date.now();
            // ✅ ADICIONADO: Throttling para evitar spam de alertas
            if (now - this.lastHighUsageAlert > this.highUsageAlertThrottleMs) {
                this.createAlert({
                    type: 'HIGH_USAGE',
                    severity:
                        metrics.heapUsagePercent > 90 ? 'CRITICAL' : 'WARNING',
                    message: `High heap usage: ${metrics.heapUsagePercent}%`,
                    metrics,
                });
                this.lastHighUsageAlert = now;
            }
        }
    }

    /**
     * Detectar memory leaks
     */
    private detectMemoryLeak(): void {
        const samples = this.config.leakDetection.samples || 10;
        if (this.measurements.length < samples) {
            return;
        }

        const recent = this.measurements.slice(-samples);
        const first = recent[0];
        const last = recent[recent.length - 1];

        if (!first || !last) {
            return;
        }

        const growthMb = last.heapUsedMb - first.heapUsedMb;
        const growthPercent =
            ((last.heapUsed - first.heapUsed) / first.heapUsed) * 100;

        // Verificar se há crescimento significativo
        if (
            this.config.leakDetection.minGrowthMb &&
            growthMb > this.config.leakDetection.minGrowthMb &&
            growthPercent > 10
        ) {
            this.createAlert({
                type: 'MEMORY_LEAK_DETECTED',
                severity: growthPercent > 50 ? 'CRITICAL' : 'ERROR',
                message: `Memory leak detected: ${growthMb}MB growth (${growthPercent.toFixed(1)}%) over ${this.config.leakDetection.samples} samples`,
                metrics: last,
                growth: {
                    samples: this.config.leakDetection.samples || 10,
                    growthMb,
                    growthPercent,
                },
            });
        }
    }

    /**
     * Criar alerta
     */
    private createAlert(alert: Omit<MemoryAlert, 'timestamp'>): void {
        const fullAlert: MemoryAlert = {
            ...alert,
            timestamp: Date.now(),
        };

        this.alerts.push(fullAlert);

        // Manter apenas últimos 50 alertas
        if (this.alerts.length > 50) {
            this.alerts = this.alerts.slice(-50);
        }

        // Log do alerta
        this.observability.log('warn', 'Memory alert', {
            type: fullAlert.type,
            severity: fullAlert.severity,
            message: fullAlert.message,
            metrics: {
                heapUsedMb: fullAlert.metrics.heapUsedMb,
                rssMb: fullAlert.metrics.rssMb,
                externalMb: fullAlert.metrics.externalMb,
                heapUsagePercent: fullAlert.metrics.heapUsagePercent,
            },
            threshold: fullAlert.threshold,
            growth: fullAlert.growth,
        });

        // Callback customizado
        this.config.onAlert(fullAlert);
    }

    /**
     * Obter estatísticas do monitor
     */
    getStats(): MemoryMonitorStats {
        const now = Date.now();
        const recentMeasurements = this.measurements.filter(
            (m) => now - m.timestamp < 10 * 60 * 1000, // Últimos 10 minutos
        );

        const averageUsage =
            recentMeasurements.length > 0
                ? {
                      heapUsed: Math.round(
                          recentMeasurements.reduce(
                              (sum, m) => sum + m.heapUsed,
                              0,
                          ) / recentMeasurements.length,
                      ),
                      rss: Math.round(
                          recentMeasurements.reduce(
                              (sum, m) => sum + m.rss,
                              0,
                          ) / recentMeasurements.length,
                      ),
                      external: Math.round(
                          recentMeasurements.reduce(
                              (sum, m) => sum + m.external,
                              0,
                          ) / recentMeasurements.length,
                      ),
                  }
                : { heapUsed: 0, rss: 0, external: 0 };

        const peakUsage =
            this.measurements.length > 0
                ? {
                      heapUsed: Math.max(
                          ...this.measurements.map((m) => m.heapUsed),
                      ),
                      rss: Math.max(...this.measurements.map((m) => m.rss)),
                      external: Math.max(
                          ...this.measurements.map((m) => m.external),
                      ),
                      timestamp: this.measurements.reduce((max, m) =>
                          m.heapUsed > max.heapUsed ? m : max,
                      ).timestamp,
                  }
                : { heapUsed: 0, rss: 0, external: 0, timestamp: 0 };

        return {
            totalMeasurements: this.measurements.length,
            totalAlerts: this.alerts.length,
            lastMeasurement: this.measurements[this.measurements.length - 1],
            peakUsage,
            averageUsage,
            leaksDetected: this.alerts.filter(
                (a) => a.type === 'MEMORY_LEAK_DETECTED',
            ).length,
            isRunning: this.isRunning,
            nextMeasurementIn:
                this.isRunning && this.intervalId
                    ? this.config.intervalMs - (now - this.lastMeasurementTime)
                    : 0,
        };
    }

    /**
     * Obter alertas recentes
     */
    getRecentAlerts(limit = 10): MemoryAlert[] {
        return this.alerts.slice(-limit);
    }

    /**
     * Limpar histórico
     */
    clearHistory(): void {
        this.measurements = [];
        this.alerts = [];
    }

    /**
     * Forçar garbage collection (se disponível)
     */
    forceGC(): void {
        if (global.gc) {
            global.gc();
            this.observability.log('info', 'Forced garbage collection');
        } else {
            this.observability.log(
                'warn',
                'Garbage collection not available (use --expose-gc flag)',
            );
        }
    }
}
