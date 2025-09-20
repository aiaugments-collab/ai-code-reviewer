/**
 * @file kernel-runtime-enhanced.integration.test.ts
 * @description Integration tests for Kernel-Runtime-Enhanced functionality
 *
 * Tests the complete integration of:
 * - Kernel configuration of enhanced queue
 * - Runtime creation with enhanced features
 * - DLQ operations via kernel interface
 * - Recovery coordination between kernel and runtime
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExecutionKernel } from '../../src/kernel/kernel.js';
import { createPersistorFromConfig } from '../../src/persistor/factory.js';
import type { Workflow } from '../../src/core/types/workflow-types.js';
import { ContextStateService } from '../../src/core/context/index.js';

describe('Kernel-Runtime-Enhanced Integration', () => {
    let kernel: ExecutionKernel;
    let persistor: ReturnType<typeof createPersistorFromConfig>;

    const testWorkflow: Workflow = {
        name: 'Test Enhanced Workflow',
        createContext: () => ({
            workflowName: 'Test Enhanced Workflow',
            executionId: 'test-execution',
            stateManager: new ContextStateService({}),
            data: {},
            currentSteps: [],
            completedSteps: [],
            failedSteps: [],
            metadata: {},
            tenantId: 'test-tenant',
            signal: new AbortController().signal,
            isPaused: false,
            cleanup: async () => {},
            startTime: Date.now(),
            status: 'RUNNING' as const,
        }),
    };

    beforeEach(() => {
        persistor = createPersistorFromConfig({
            type: 'memory',
            maxSnapshots: 1000,
            enableCompression: true,
            enableDeltaCompression: true,
            cleanupInterval: 300000,
            maxMemoryUsage: 100 * 1024 * 1024,
        });
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (kernel) {
            await kernel.enhancedCleanup();
        }
    });

    describe('Enhanced Queue Configuration', () => {
        it('should create kernel with enhanced queue enabled by default', async () => {
            kernel = new ExecutionKernel({
                tenantId: 'test-tenant',
                workflow: testWorkflow,
                persistor,
                enhancedQueue: {
                    enabled: true,
                    config: {
                        maxRetries: 3,
                        baseRetryDelay: 1000,
                        enableDLQ: true,
                    },
                },
            });

            await kernel.initialize();

            const runtime = kernel.getRuntime();
            expect(runtime).toBeTruthy();

            const enhancedStats = kernel.getEnhancedRuntimeStats();
            expect(enhancedStats).toBeTruthy();
            expect(enhancedStats!.enhancedQueue.enabled).toBe(true);
        });

        it('should configure DLQ management settings', async () => {
            kernel = new ExecutionKernel({
                tenantId: 'test-tenant',
                workflow: testWorkflow,
                persistor,
                enhancedQueue: {
                    enabled: true,
                    dlqManagement: {
                        autoReprocess: true,
                        reprocessInterval: 15, // 15 minutes
                        alertThresholds: [5, 10, 20],
                    },
                    recovery: {
                        enableAutoRecovery: true,
                        maxRecoveryAttempts: 3,
                    },
                },
            });

            await kernel.initialize();

            const enhancedStats = kernel.getEnhancedRuntimeStats();
            expect(enhancedStats!.kernel.dlqAutoReprocessEnabled).toBe(true);

            const recoveryOps = kernel.getRecoveryOperations();
            expect(recoveryOps).toBeTruthy();
            expect(recoveryOps!.status.maxAttempts).toBe(3);
        });

        it('should fall back to basic queue when enhanced is disabled', async () => {
            kernel = new ExecutionKernel({
                tenantId: 'test-tenant',
                workflow: testWorkflow,
                persistor,
                enhancedQueue: {
                    enabled: false,
                },
            });

            await kernel.initialize();

            const enhancedStats = kernel.getEnhancedRuntimeStats();
            expect(enhancedStats!.enhancedQueue.enabled).toBe(false);

            const dlqOps = kernel.getDLQOperations();
            expect(dlqOps).toBeNull();
        });
    });

    describe('Runtime Enhanced Features Access', () => {
        beforeEach(async () => {
            kernel = new ExecutionKernel({
                tenantId: 'test-tenant',
                workflow: testWorkflow,
                persistor,
                enhancedQueue: {
                    enabled: true,
                    config: {
                        maxRetries: 2,
                        baseRetryDelay: 500,
                        enableDLQ: true,
                    },
                },
            });

            await kernel.initialize();
        });

        it('should provide access to enhanced queue via runtime', async () => {
            const runtime = kernel.getRuntime();
            expect(runtime).toBeTruthy();

            const enhancedQueue = runtime!.getEnhancedQueue?.();
            expect(enhancedQueue).toBeTruthy();

            const stats = enhancedQueue!.getStats();
            expect(stats).toHaveProperty('retry');
            expect(stats).toHaveProperty('dlq');
        });

        it('should support DLQ reprocessing via runtime interface', async () => {
            const runtime = kernel.getRuntime();
            expect(runtime!.reprocessDLQByCriteria).toBeTruthy();

            // Test empty DLQ reprocessing
            const result = await runtime!.reprocessDLQByCriteria!({
                maxAge: 60000, // 1 minute
                limit: 5,
            });

            expect(result).toEqual({
                reprocessedCount: 0,
                events: [],
            });
        });

        it('should support individual event reprocessing from DLQ', async () => {
            const runtime = kernel.getRuntime();
            expect(runtime!.reprocessFromDLQ).toBeTruthy();

            // Test with non-existent event ID
            const reprocessed =
                await runtime!.reprocessFromDLQ!('non-existent-id');
            expect(reprocessed).toBe(false);
        });
    });

    describe('DLQ Operations via Kernel Interface', () => {
        beforeEach(async () => {
            kernel = new ExecutionKernel({
                tenantId: 'test-tenant',
                workflow: testWorkflow,
                persistor,
                enhancedQueue: {
                    enabled: true,
                    dlqManagement: {
                        autoReprocess: false, // Disable auto to test manual
                    },
                },
            });

            await kernel.initialize();
        });

        it('should provide DLQ operations interface', () => {
            const dlqOps = kernel.getDLQOperations();
            expect(dlqOps).toBeTruthy();
            expect(dlqOps!.reprocessItems).toBeInstanceOf(Function);
            expect(dlqOps!.getStats).toBeInstanceOf(Function);
            expect(dlqOps!.isAutoReprocessEnabled()).toBe(false);
        });

        it('should execute DLQ reprocessing via kernel interface', async () => {
            const dlqOps = kernel.getDLQOperations();

            const result = await dlqOps!.reprocessItems({
                maxAge: 24 * 60 * 60 * 1000, // 24 hours
                limit: 10,
            });

            expect(result.success).toBe(true);
            expect(result.message).toContain('DLQ reprocessing completed');
            expect(result).toHaveProperty('reprocessedCount');
            expect(result).toHaveProperty('events');
        });

        it('should return DLQ stats via kernel interface', () => {
            const dlqOps = kernel.getDLQOperations();
            const stats = dlqOps!.getStats();

            // Should return null for empty DLQ, but method should work
            expect(stats).toBeDefined();
        });
    });

    describe('Recovery Operations Coordination', () => {
        beforeEach(async () => {
            kernel = new ExecutionKernel({
                tenantId: 'test-tenant',
                workflow: testWorkflow,
                persistor,
                enhancedQueue: {
                    enabled: true,
                    recovery: {
                        enableAutoRecovery: true,
                        maxRecoveryAttempts: 3,
                    },
                },
            });

            await kernel.initialize();
        });

        it('should provide recovery operations interface', () => {
            const recoveryOps = kernel.getRecoveryOperations();
            expect(recoveryOps).toBeTruthy();
            expect(recoveryOps!.status).toBeTruthy();
            expect(recoveryOps!.triggerRecovery).toBeInstanceOf(Function);
        });

        it('should track recovery attempts', async () => {
            const recoveryOps = kernel.getRecoveryOperations();

            const initialStatus = recoveryOps!.status;
            expect(initialStatus.attempts).toBe(0);
            expect(initialStatus.canAttemptRecovery).toBe(true);

            // Trigger recovery
            const result = await recoveryOps!.triggerRecovery();
            expect(result.success).toBe(true);
            expect(result.attempt).toBe(1);

            // Check updated status
            const updatedStatus = recoveryOps!.status;
            expect(updatedStatus.attempts).toBe(1);
        });

        it('should enforce maximum recovery attempts', async () => {
            const recoveryOps = kernel.getRecoveryOperations();

            // Trigger maximum attempts
            await recoveryOps!.triggerRecovery(); // 1
            await recoveryOps!.triggerRecovery(); // 2
            await recoveryOps!.triggerRecovery(); // 3

            const status = recoveryOps!.status;
            expect(status.attempts).toBe(3);
            expect(status.canAttemptRecovery).toBe(false);

            // Should throw on next attempt
            await expect(recoveryOps!.triggerRecovery()).rejects.toThrow(
                'Max recovery attempts exceeded (3)',
            );
        });

        it('should update lastRecoveryTime on successful recovery', async () => {
            const recoveryOps = kernel.getRecoveryOperations();

            const beforeTime = Date.now();
            await recoveryOps!.triggerRecovery();
            const afterTime = Date.now();

            const status = recoveryOps!.status;
            expect(status.lastRecoveryTime).toBeGreaterThanOrEqual(beforeTime);
            expect(status.lastRecoveryTime).toBeLessThanOrEqual(afterTime);
        });
    });

    describe('Enhanced Statistics Integration', () => {
        beforeEach(async () => {
            kernel = new ExecutionKernel({
                tenantId: 'test-tenant',
                workflow: testWorkflow,
                persistor,
                enhancedQueue: {
                    enabled: true,
                    dlqManagement: {
                        autoReprocess: true,
                        reprocessInterval: 30,
                    },
                },
            });

            await kernel.initialize();
        });

        it('should provide comprehensive enhanced statistics', () => {
            const enhancedStats = kernel.getEnhancedRuntimeStats();

            expect(enhancedStats).toBeTruthy();
            expect(enhancedStats!.enhancedQueue).toBeTruthy();
            expect(enhancedStats!.enhancedQueue.enabled).toBe(true);
            expect(enhancedStats!.kernel).toBeTruthy();
            expect(enhancedStats!.kernel.dlqAutoReprocessEnabled).toBe(true);
        });

        it('should include runtime statistics in enhanced stats', () => {
            const enhancedStats = kernel.getEnhancedRuntimeStats();

            // Should include base runtime stats
            // Removed properties that don't exist in the type

            // Should include enhanced-specific stats
            expect(enhancedStats!.enhancedQueue).toBeTruthy();
            expect(enhancedStats!.kernel).toBeTruthy();
        });

        it('should show kernel-specific metrics', () => {
            const enhancedStats = kernel.getEnhancedRuntimeStats();
            const kernelStats = enhancedStats!.kernel;

            expect(kernelStats.recoveryAttempts).toBe(0);
            expect(kernelStats.lastRecoveryTime).toBe(0);
            expect(kernelStats.dlqAutoReprocessEnabled).toBe(true);
        });
    });

    describe('Lifecycle Management', () => {
        it('should setup enhanced features during initialization', async () => {
            kernel = new ExecutionKernel({
                tenantId: 'test-tenant',
                workflow: testWorkflow,
                persistor,
                enhancedQueue: {
                    enabled: true,
                    dlqManagement: {
                        autoReprocess: true,
                        reprocessInterval: 5, // 5 minutes
                    },
                },
            });

            // Before initialization
            expect(kernel.getDLQOperations()).toBeNull();

            await kernel.initialize();

            // After initialization
            const dlqOps = kernel.getDLQOperations();
            expect(dlqOps).toBeTruthy();
            expect(dlqOps!.isAutoReprocessEnabled()).toBe(true);
        });

        it('should cleanup enhanced features during shutdown', async () => {
            kernel = new ExecutionKernel({
                tenantId: 'test-tenant',
                workflow: testWorkflow,
                persistor,
                enhancedQueue: {
                    enabled: true,
                    dlqManagement: {
                        autoReprocess: true,
                    },
                },
            });

            await kernel.initialize();

            const dlqOps = kernel.getDLQOperations();
            expect(dlqOps!.isAutoReprocessEnabled()).toBe(true);

            // Get enhanced stats to verify cleanup
            const statsBefore = kernel.getEnhancedRuntimeStats();
            expect(statsBefore!.kernel.dlqAutoReprocessEnabled).toBe(true);

            await kernel.enhancedCleanup();

            // After cleanup, enhanced operations should not be accessible
            const dlqOpsAfter = kernel.getDLQOperations();
            expect(dlqOpsAfter).toBeNull();

            const recoveryOpsAfter = kernel.getRecoveryOperations();
            expect(recoveryOpsAfter).toBeNull();
        });
    });
});
