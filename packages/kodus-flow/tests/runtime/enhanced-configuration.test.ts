/**
 * @file enhanced-configuration.test.ts
 * @description Tests for basic runtime configuration validation and behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { createPersistorFromConfig } from '../../src/persistor/factory.js';
import { getObservability } from '../../src/observability/index.js';
import type { WorkflowContext } from '../../src/core/types/workflow-types.js';
import { ContextStateService } from '../../src/core/context/index.js';

describe('Runtime Configuration', () => {
    let observability: ReturnType<typeof getObservability>;
    let workflowContext: WorkflowContext;

    beforeEach(() => {
        observability = getObservability({ environment: 'test' });

        workflowContext = {
            workflowName: 'test-workflow',
            executionId: 'test-execution',
            correlationId: 'test-correlation',
            stateManager: new ContextStateService({}),
            data: {},
            currentSteps: [],
            completedSteps: [],
            failedSteps: [],
            tenantId: 'test-tenant',
            signal: new AbortController().signal,
            isPaused: false,
            cleanup: async () => {},
            startTime: Date.now(),
        };
    });

    describe('Basic Configuration', () => {
        it('should create runtime with basic configuration', async () => {
            const runtime = createRuntime(workflowContext, observability);

            const stats = runtime.getStats();
            expect(stats.runtime).toBeTruthy();
            expect(stats.queue).toBeTruthy();

            await runtime.cleanup();
        });

        it('should create runtime with auto-generated execution ID', async () => {
            const runtime = createRuntime(workflowContext, observability);

            const stats = runtime.getStats() as {
                runtime: { executionId: string };
            };
            expect(stats.runtime.executionId).toBeTruthy();
            expect(typeof stats.runtime.executionId).toBe('string');

            await runtime.cleanup();
        });

        it('should accept custom persistor', async () => {
            const customPersistor = createPersistorFromConfig({
                type: 'memory',
                maxSnapshots: 1000,
                enableCompression: true,
                enableDeltaCompression: true,
                cleanupInterval: 300000,
                maxMemoryUsage: 100 * 1024 * 1024,
            });

            const runtime = createRuntime(workflowContext, observability, {
                persistor: customPersistor,
                executionId: 'persistor-test',
            });

            const stats = runtime.getStats() as {
                runtime: { persistorType: string };
            };
            expect(stats.runtime.persistorType).toBe('StoragePersistorAdapter');

            await runtime.cleanup();
        });
    });

    describe('Multi-tenant Configuration', () => {
        it('should support tenant-specific configuration', async () => {
            const runtime = createRuntime(workflowContext, observability, {
                tenantId: 'tenant-123',
            });

            const stats = runtime.getStats();
            expect(stats.runtime).toBeTruthy();

            const tenantRuntime = runtime.forTenant('tenant-456');
            expect(tenantRuntime).toBeTruthy();
            expect(tenantRuntime).not.toBe(runtime);

            await runtime.cleanup();
            await tenantRuntime.cleanup();
        });
    });
});
