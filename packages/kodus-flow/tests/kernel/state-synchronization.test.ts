/**
 * @file State Synchronization Tests
 * @description Testes para verificar se os problemas críticos de sincronização foram corrigidos
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createKernel } from '../../src/kernel/index.js';

describe('Kernel State Synchronization Tests', () => {
    let kernel: ReturnType<typeof createKernel>;

    beforeEach(() => {
        // Create a mock workflow with createContext method

        kernel = createKernel({
            tenantId: 'test-tenant',
            workflow: {
                createContext: () => ({
                    sendEvent: async () => {},
                    workflowName: 'test-workflow',
                    executionId: 'test-execution',

                    stateManager: {} as any,
                    data: {},
                    currentSteps: [],
                    completedSteps: [],
                    failedSteps: [],
                    metadata: {},
                    tenantId: 'test-tenant',
                    signal: new AbortController().signal,
                    isPaused: false,
                    isCompleted: false,
                    isFailed: false,
                    cleanup: async () => {},
                    startTime: Date.now(),
                    status: 'RUNNING' as const,
                }),
            } as any,
            runtimeConfig: {
                middleware: [],
                queueSize: 100,
                batchSize: 10,
            },
        });
    });

    afterEach(async () => {
        if (kernel) {
            await kernel.enhancedCleanup();
        }
    });

    describe('Critical State Synchronization Issues', () => {
        it('should prevent runtime access when not initialized', async () => {
            // Kernel criado mas não inicializado
            expect(kernel.isRuntimeReady()).toBe(false);

            // Tentar acessar runtime deve falhar
            expect(() => kernel.getRuntimeStats()).toThrow('Runtime not ready');
            expect(() => kernel.emitEvent('test.event', {})).toThrow(
                'Runtime not ready',
            );
        });

        it('should maintain state/runtime synchronization during initialization', async () => {
            // Inicializar kernel
            await kernel.initialize();

            // Verificar sincronização
            expect(kernel.isRuntimeReady()).toBe(true);
            expect(kernel.getStatus().status).toBe('running');
            expect(kernel.getRuntime()).not.toBeNull();
        });

        it('should handle initialization failure gracefully', async () => {
            // Criar kernel com configuração inválida para forçar falha

            const invalidKernel = createKernel({
                tenantId: 'test-tenant',
                workflow: {
                    createContext: () => {
                        throw new Error(
                            'Invalid workflow - createContext fails',
                        );
                    },
                },
                runtimeConfig: {
                    queueSize: -1, // Valor inválido
                    batchSize: 0, // Valor inválido
                },
            });

            // Tentar inicializar deve falhar
            await expect(invalidKernel.initialize()).rejects.toThrow();

            // Estado deve estar consistente após falha
            expect(invalidKernel.getStatus().status).toBe('failed');
            expect(invalidKernel.getRuntime()).toBeNull();
            expect(invalidKernel.isRuntimeReady()).toBe(false);
        });

        it('should maintain synchronization during reset', async () => {
            // Inicializar kernel
            await kernel.initialize();
            expect(kernel.isRuntimeReady()).toBe(true);

            // Reset kernel
            await kernel.reset();

            // Verificar sincronização após reset
            expect(kernel.isRuntimeReady()).toBe(false);
            expect(kernel.getStatus().status).toBe('initialized');
            expect(kernel.getRuntime()).toBeNull();
        });

        it('should handle reset failure gracefully', async () => {
            // Inicializar kernel
            await kernel.initialize();

            // Mock runtime.cleanup para falhar
            const runtime = kernel.getRuntime();
            if (!runtime) throw new Error('Runtime is null');
            const originalCleanup = runtime.cleanup;
            runtime.cleanup = async () => {
                throw new Error('Cleanup failed');
            };

            // Tentar reset deve falhar
            await expect(kernel.reset()).rejects.toThrow('Cleanup failed');

            // Estado deve estar consistente após falha
            expect(kernel.getStatus().status).toBe('failed');
            expect(kernel.getRuntime()).toBeNull();

            // Restaurar cleanup original
            const runtimeAfter = kernel.getRuntime();
            if (runtimeAfter) {
                runtimeAfter.cleanup = originalCleanup;
            }
        });

        it('should detect and fix state desynchronization', async () => {
            // Inicializar kernel
            await kernel.initialize();
            expect(kernel.isRuntimeReady()).toBe(true);

            // Simular dessincronização (manualmente)

            (kernel as any).state.status = 'running';

            (kernel as any).runtime = null;

            // isRuntimeReady deve detectar e corrigir
            expect(kernel.isRuntimeReady()).toBe(false);

            // Estado deve ser corrigido
            expect(kernel.getStatus().status).toBe('failed');
        });

        it('should provide safe runtime access methods', async () => {
            // Kernel não inicializado
            expect(() => kernel.getRuntimeStats()).toThrow('Runtime not ready');

            // Inicializar kernel
            await kernel.initialize();

            // Agora deve funcionar
            expect(() => kernel.getRuntimeStats()).not.toThrow();

            // Todos os métodos devem funcionar
            expect(() =>
                kernel.registerHandler('test.event', () => {}),
            ).not.toThrow();
            expect(() => kernel.getRuntimeStats()).not.toThrow();
            expect(() => kernel.emitEvent('test.event', {})).not.toThrow();
        });

        it('should handle concurrent access safely', async () => {
            // Inicializar kernel
            await kernel.initialize();

            // Simular acesso concorrente
            const promises = [
                kernel.getRuntimeStats(),
                kernel.emitEvent('test.event', {}),
                kernel.getRuntimeStats(),
                kernel.emitEvent('test.event', {}),
            ];

            // Todas as operações devem completar sem erro
            await expect(Promise.all(promises)).resolves.toBeDefined();
        });

        it('should provide comprehensive health status', () => {
            // Kernel não inicializado
            const healthBefore = kernel.getHealthStatus();
            expect(healthBefore.status).toBe('unhealthy');
            expect(healthBefore.checks.runtime).toBe(false);

            // Inicializar kernel
            return kernel.initialize().then(() => {
                const healthAfter = kernel.getHealthStatus();
                expect(healthAfter.status).toBe('healthy');
                expect(healthAfter.checks.runtime).toBe(true);
            });
        });

        it('should handle error recovery', async () => {
            // Inicializar kernel
            await kernel.initialize();
            expect(kernel.isRuntimeReady()).toBe(true);

            // Simular erro real - limpar runtime e setar status como failed

            (kernel as any).runtime = null;

            (kernel as any).state.status = 'failed';

            // Tentar recuperação
            const recovered = await kernel.recoverFromError();
            expect(recovered).toBe(true);

            // Kernel deve estar funcionando novamente
            expect(kernel.isRuntimeReady()).toBe(true);
            expect(kernel.getStatus().status).toBe('running');
        });
    });
});
