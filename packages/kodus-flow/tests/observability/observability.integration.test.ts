/**
 * @file observability.integration.test.ts
 * Teste de integração do sistema de Observabilidade (logger + telemetry + contexto + helpers)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getObservability,
    startAgentSpan,
    startToolSpan,
    startLLMSpan,
    createObservabilityMiddleware,
} from '../../src/observability/index.js';
import type { TraceItem } from '../../src/observability/telemetry.js';
import type { Event } from '../../src/core/types/events.js';

describe('ObservabilitySystem - Integração', () => {
    const originalEnv = { ...process.env };
    let logSpy: ReturnType<typeof vi.spyOn>;
    let debugSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        logSpy.mockRestore();
        debugSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('propaga contexto (tenant/correlation) para spans e logs via helpers', async () => {
        process.env.KODUS_DISABLE_TRACING = '0';
        const obs = getObservability({
            environment: 'development',
            telemetry: {
                enabled: true,
                sampling: { rate: 1, strategy: 'probabilistic' },
            },
            monitoring: { enabled: false },
            logging: { enabled: true, level: 'debug' },
        });
        obs.updateConfig({
            telemetry: {
                enabled: true,
                sampling: { rate: 1, strategy: 'probabilistic' },
            },
        });

        const correlationId = 'corr_test_123';
        const tenantId = 'tenant_acme';
        const ctx = obs.createContext(correlationId);
        ctx.tenantId = tenantId;
        obs.setContext(ctx);

        const collected: TraceItem[] = [];
        obs.telemetry.addTraceProcessor((items) => {
            collected.push(...items);
        });

        const result = await obs.trace('orchestration.call_agent', async () => {
            const think = startAgentSpan(obs.telemetry, 'think', {
                agentName: 'agent-A',
                iteration: 1,
            });
            await obs.telemetry.withSpan(think, async () => {});

            const tool = startToolSpan(obs.telemetry, {
                toolName: 'search',
                callId: 'call_1',
            });
            await obs.telemetry.withSpan(tool, async () => {});

            const llm = startLLMSpan(obs.telemetry, {
                model: 'gpt-4o',
                technique: 'plan',
                inputTokens: 10,
                outputTokens: 5,
            });
            await obs.telemetry.withSpan(llm, async () => {});

            obs.logger.info('structured-log', { foo: 'bar' });
            return 'ok';
        });

        // Garantir que processors async tenham tempo de rodar
        await obs.telemetry.forceFlush();
        await new Promise((r) => setTimeout(r, 0));

        expect(result).toBe('ok');

        // Deve ter spans para root e os 3 helpers
        const names = collected.map((i) => i.name).sort();
        expect(names).toContain('orchestration.call_agent');
        expect(names).toContain('agent.think');
        expect(names).toContain('tool.execute');
        expect(names).toContain('llm.generation');

        // Todos os spans devem compartilhar o mesmo traceId
        const traceIds = new Set(collected.map((i) => i.context.traceId));
        expect(traceIds.size).toBe(1);

        // Atributos de contexto devem estar presentes (propagação automática)
        const attrsMerged = collected.reduce<Record<string, unknown>>(
            (acc, i) => ({ ...acc, ...i.attributes }),
            {},
        );
        expect(String(attrsMerged['tenant.id'])).toBe(tenantId);
        expect(String(attrsMerged['correlation.id'])).toBe(correlationId);

        // Validação do logger é coberta por logger.unit.test.ts
    });

    it('instrumenta handler genérico via createObservabilityMiddleware', async () => {
        const obs = getObservability({
            environment: 'development',
            telemetry: {
                enabled: true,
                sampling: { rate: 1, strategy: 'probabilistic' },
            },
            monitoring: { enabled: false },
        });
        obs.updateConfig({
            telemetry: {
                enabled: true,
                sampling: { rate: 1, strategy: 'probabilistic' },
            },
        });

        const collected: TraceItem[] = [];
        obs.telemetry.addTraceProcessor((items) => {
            collected.push(...items);
        });

        const middleware = createObservabilityMiddleware();

        const handler = async (_ev: Event) => ({ ok: true as const });
        const wrapped = middleware(handler, 'myHandler');

        const ev: Event = {
            id: 'evt1',
            type: 'custom.test',
            data: { foo: 'bar' },
            ts: Date.now(),
            threadId: 'thread_1',
            metadata: { correlationId: 'corr_X' },
        };

        const res = await wrapped(ev);
        expect(res && (res as { ok: boolean }).ok).toBe(true);

        const names = collected.map((i) => i.name);
        expect(names).toContain('handler.myHandler');
    });
});
