/**
 * @file logger.unit.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../../src/observability/logger.js';
import { getObservability } from '../../src/observability/index.js';

describe('Logger - Context Provider', () => {
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
        logSpy.mockRestore();
        debugSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('mescla contexto global em logs', () => {
        const obs = getObservability();
        const ctx = obs.createContext('corr_Z');
        ctx.tenantId = 'tenant_Z';
        obs.setContext(ctx);

        const logger = createLogger('test', 'debug');
        logger.info('hello', { foo: 'bar' });

        const lastLogArgs = logSpy.mock.calls.at(-1);
        expect(lastLogArgs).toBeTruthy();
        const mergedContext = (lastLogArgs as unknown[])[1] as Record<
            string,
            unknown
        >;
        expect(String(mergedContext.correlationId)).toBe('corr_Z');
        expect(String(mergedContext.tenantId)).toBe('tenant_Z');
        expect(String(mergedContext.foo)).toBe('bar');
    });
});
