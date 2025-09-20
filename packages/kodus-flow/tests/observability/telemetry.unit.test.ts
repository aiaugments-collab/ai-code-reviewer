/**
 * @file telemetry.unit.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getObservability,
    withObservability as withObs,
    startAgentSpan,
    startToolSpan,
    startLLMSpan,
} from '../../src/observability/index.js';
import {
    TelemetrySystem,
    type Tracer,
    type Span,
    type TraceItem,
} from '../../src/observability/telemetry.js';

describe('TelemetrySystem - Unit', () => {
    beforeEach(() => {
        const obs = getObservability();
        obs.updateConfig({
            telemetry: {
                enabled: true,
                sampling: { rate: 1, strategy: 'probabilistic' },
            },
            monitoring: { enabled: false },
            logging: { enabled: true },
        });
        obs.clearContext();
        obs.telemetry.setTraceProcessors([]);
    });

    it('sampling=0 deve não produzir spans', async () => {
        const obs = getObservability();
        obs.updateConfig({
            telemetry: { sampling: { rate: 0, strategy: 'probabilistic' } },
        });

        const items: TraceItem[] = [];
        obs.telemetry.setTraceProcessors([(batch) => items.push(...batch)]);

        await obs.trace('root', async () => {
            const s = startAgentSpan(obs.telemetry, 'think', {
                agentName: 'a',
            });
            await obs.telemetry.withSpan(s, async () => {});
        });

        expect(items.length).toBe(0);
    });

    it('forceFlush delega para tracer externo quando disponível', async () => {
        let flushed = 0;
        const fakeTracer: Tracer & { flush(): void } = {
            startSpan: () =>
                ({
                    setAttribute: () =>
                        ({
                            setAttribute: () => ({}) as Span,
                            setAttributes: () => ({}) as Span,
                            setStatus: () => ({}) as Span,
                            recordException: () => ({}) as Span,
                            addEvent: () => ({}) as Span,
                            end: () => {},
                            getSpanContext: () => ({
                                traceId: 't',
                                spanId: 's',
                                traceFlags: 1,
                            }),
                            isRecording: () => true,
                        }) as Span,
                    setAttributes: () => ({}) as Span,
                    setStatus: () => ({}) as Span,
                    recordException: () => ({}) as Span,
                    addEvent: () => ({}) as Span,
                    end: () => {},
                    getSpanContext: () => ({
                        traceId: 't',
                        spanId: 's',
                        traceFlags: 1,
                    }),
                    isRecording: () => true,
                }) as Span,
            createSpanContext: (traceId: string, spanId: string) => ({
                traceId,
                spanId,
                traceFlags: 1,
            }),
            flush: () => {
                flushed += 1;
            },
        };

        const tel = new TelemetrySystem({ externalTracer: fakeTracer });
        await tel.forceFlush();
        expect(flushed).toBe(1);
    });

    it('withObservability cria span raiz e helpers geram spans filhos', async () => {
        const obs = getObservability({
            telemetry: { sampling: { rate: 1, strategy: 'probabilistic' } },
        });
        const items: TraceItem[] = [];
        obs.telemetry.setTraceProcessors([(batch) => items.push(...batch)]);

        await withObs('root.op', async () => {
            await obs.telemetry.withSpan(
                startAgentSpan(obs.telemetry, 'think', { agentName: 'A' }),
                async () => {},
            );
            await obs.telemetry.withSpan(
                startToolSpan(obs.telemetry, { toolName: 'T' }),
                async () => {},
            );
            await obs.telemetry.withSpan(
                startLLMSpan(obs.telemetry, { model: 'M' }),
                async () => {},
            );
        });

        const names = items.map((i) => i.name).sort();
        expect(names).toContain('root.op');
        expect(names).toContain('agent.think');
        expect(names).toContain('tool.execute');
        expect(names).toContain('llm.generation');
    });
});
