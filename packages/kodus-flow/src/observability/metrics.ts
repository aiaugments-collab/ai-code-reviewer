import { createLogger } from './logger.js';

/**
 * Simple metrics system for observability
 */
export class MetricsSystem {
    private logger = createLogger('metrics');
    private counters = new Map<string, number>();
    private histograms = new Map<string, number[]>();
    private gauges = new Map<string, number>();
    private timers = new Map<string, number>();

    /**
     * Increment a counter
     */
    counter(
        name: string,
        value: number = 1,
        labels: Record<string, string> = {},
    ): void {
        const key = this.createKey(name, labels);
        const current = this.counters.get(key) || 0;
        this.counters.set(key, current + value);

        this.logger.debug('Counter incremented', {
            metric: name,
            value: current + value,
            labels,
        });
    }

    /**
     * Record a histogram value
     */
    histogram(
        name: string,
        value: number,
        labels: Record<string, string> = {},
    ): void {
        const key = this.createKey(name, labels);
        const values = this.histograms.get(key) || [];
        values.push(value);
        this.histograms.set(key, values);

        this.logger.debug('Histogram recorded', {
            metric: name,
            value,
            count: values.length,
            labels,
        });
    }

    /**
     * Set a gauge value
     */
    gauge(
        name: string,
        value: number,
        labels: Record<string, string> = {},
    ): void {
        const key = this.createKey(name, labels);
        this.gauges.set(key, value);

        this.logger.debug('Gauge set', {
            metric: name,
            value,
            labels,
        });
    }

    /**
     * Start a timer
     */
    startTimer(name: string, labels: Record<string, string> = {}): () => void {
        const key = this.createKey(name, labels);
        const startTime = Date.now();
        this.timers.set(key, startTime);

        this.logger.debug('Timer started', {
            metric: name,
            labels,
        });

        // Return function to stop timer
        return () => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            this.histogram(`${name}_duration`, duration, labels);
            this.timers.delete(key);

            this.logger.debug('Timer completed', {
                metric: name,
                duration,
                labels,
            });
        };
    }

    /**
     * Record agent-specific metrics
     */
    recordAgentMetrics(
        agentName: string,
        metrics: {
            executionCount?: number;
            successCount?: number;
            errorCount?: number;
            averageDuration?: number;
            toolCalls?: number;
            tokenUsage?: {
                input: number;
                output: number;
                total: number;
            };
        },
    ): void {
        const labels = { agent: agentName };

        if (metrics.executionCount) {
            this.counter(
                'agent_executions_total',
                metrics.executionCount,
                labels,
            );
        }

        if (metrics.successCount) {
            this.counter(
                'agent_executions_success',
                metrics.successCount,
                labels,
            );
        }

        if (metrics.errorCount) {
            this.counter('agent_executions_error', metrics.errorCount, labels);
        }

        if (metrics.averageDuration) {
            this.histogram(
                'agent_execution_duration',
                metrics.averageDuration,
                labels,
            );
        }

        if (metrics.toolCalls) {
            this.counter('agent_tool_calls_total', metrics.toolCalls, labels);
        }

        if (metrics.tokenUsage) {
            this.histogram(
                'agent_token_usage_input',
                metrics.tokenUsage.input,
                labels,
            );
            this.histogram(
                'agent_token_usage_output',
                metrics.tokenUsage.output,
                labels,
            );
            this.histogram(
                'agent_token_usage_total',
                metrics.tokenUsage.total,
                labels,
            );
        }
    }

    /**
     * Record LLM-specific metrics
     */
    recordLLMMetrics(
        model: string,
        provider: string,
        metrics: {
            requestCount?: number;
            tokenUsage?: {
                input: number;
                output: number;
                total: number;
            };
            latency?: number;
            errorCount?: number;
        },
    ): void {
        const labels = { model, provider };

        if (metrics.requestCount) {
            this.counter('llm_requests_total', metrics.requestCount, labels);
        }

        if (metrics.tokenUsage) {
            this.histogram(
                'llm_token_usage_input',
                metrics.tokenUsage.input,
                labels,
            );
            this.histogram(
                'llm_token_usage_output',
                metrics.tokenUsage.output,
                labels,
            );
            this.histogram(
                'llm_token_usage_total',
                metrics.tokenUsage.total,
                labels,
            );
        }

        if (metrics.latency) {
            this.histogram('llm_request_duration', metrics.latency, labels);
        }

        if (metrics.errorCount) {
            this.counter('llm_requests_error', metrics.errorCount, labels);
        }
    }

    /**
     * Record tool-specific metrics
     */
    recordToolMetrics(
        toolName: string,
        metrics: {
            callCount?: number;
            successCount?: number;
            errorCount?: number;
            averageDuration?: number;
        },
    ): void {
        const labels = { tool: toolName };

        if (metrics.callCount) {
            this.counter('tool_calls_total', metrics.callCount, labels);
        }

        if (metrics.successCount) {
            this.counter('tool_calls_success', metrics.successCount, labels);
        }

        if (metrics.errorCount) {
            this.counter('tool_calls_error', metrics.errorCount, labels);
        }

        if (metrics.averageDuration) {
            this.histogram(
                'tool_call_duration',
                metrics.averageDuration,
                labels,
            );
        }
    }

    /**
     * Get all metrics
     */
    getMetrics(): {
        counters: Record<string, number>;
        histograms: Record<
            string,
            { values: number[]; count: number; sum: number; avg: number }
        >;
        gauges: Record<string, number>;
    } {
        const result = {
            counters: Object.fromEntries(this.counters),
            histograms: {} as Record<
                string,
                { values: number[]; count: number; sum: number; avg: number }
            >,
            gauges: Object.fromEntries(this.gauges),
        };

        for (const [key, values] of this.histograms) {
            const sum = values.reduce((a, b) => a + b, 0);
            const avg = values.length > 0 ? sum / values.length : 0;

            result.histograms[key] = {
                values: [...values],
                count: values.length,
                sum,
                avg,
            };
        }

        return result;
    }

    /**
     * Reset all metrics
     */
    reset(): void {
        this.counters.clear();
        this.histograms.clear();
        this.gauges.clear();
        this.timers.clear();

        this.logger.debug('All metrics reset');
    }

    /**
     * Create a metric key from name and labels
     */
    private createKey(name: string, labels: Record<string, string>): string {
        if (Object.keys(labels).length === 0) {
            return name;
        }

        const sortedLabels = Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');

        return `${name}{${sortedLabels}}`;
    }
}

/**
 * Global metrics instance
 */
let globalMetrics: MetricsSystem | undefined;

/**
 * Get or create global metrics system
 */
export function getMetrics(): MetricsSystem {
    if (!globalMetrics) {
        globalMetrics = new MetricsSystem();
    }
    return globalMetrics;
}

/**
 * Convenience functions
 */
export const metrics = {
    counter: (name: string, value?: number, labels?: Record<string, string>) =>
        getMetrics().counter(name, value, labels),

    histogram: (name: string, value: number, labels?: Record<string, string>) =>
        getMetrics().histogram(name, value, labels),

    gauge: (name: string, value: number, labels?: Record<string, string>) =>
        getMetrics().gauge(name, value, labels),

    startTimer: (name: string, labels?: Record<string, string>) =>
        getMetrics().startTimer(name, labels),

    recordAgentMetrics: (agentName: string, metrics: any) =>
        getMetrics().recordAgentMetrics(agentName, metrics),

    recordLLMMetrics: (model: string, provider: string, metrics: any) =>
        getMetrics().recordLLMMetrics(model, provider, metrics),

    recordToolMetrics: (toolName: string, metrics: any) =>
        getMetrics().recordToolMetrics(toolName, metrics),

    getMetrics: () => getMetrics().getMetrics(),

    reset: () => getMetrics().reset(),
};
