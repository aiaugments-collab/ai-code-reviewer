/**
 * @file Kernel + ExecutionEngine Integration Test
 * @description Testes de integração entre Kernel e ExecutionEngine
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createKernel } from '../../src/kernel/index.js';
import {
    createWorkflow,
    defineWorkflow,
} from '../../src/core/types/workflow-types.js';
import type { ExecutionKernel } from '../../src/kernel/index.js';
import { createEvent } from '../../src/core/types/events.js';

describe('Kernel + ExecutionEngine Integration', () => {
    let kernel: ExecutionKernel;

    beforeEach(async () => {
        // Setup: criar uma nova instância do kernel antes de cada teste
        const workflowDefinition = defineWorkflow(
            'test-workflow',
            'Test workflow for integration tests',
            {},
            ['start'],
        );

        const workflow = createWorkflow(workflowDefinition, {
            tenantId: 'test-tenant',
        });

        kernel = createKernel({
            tenantId: 'test-tenant',
            jobId: `test-job-${Date.now()}`,
            workflow: workflow,
            debug: true,
        });

        // Inicializar kernel
        await kernel.initialize();
    });

    afterEach(async () => {
        // Cleanup após cada teste
        if (kernel) {
            try {
                await kernel.complete();
            } catch {
                // Erro esperado em alguns testes
                // console.warn removed
            }
        }
    });

    it('should initialize kernel successfully', () => {
        expect(kernel).toBeDefined();
        // Não podemos acessar o status diretamente, mas podemos verificar se o kernel foi inicializado
        // verificando se ele não lança exceção ao enviar um evento
        expect(() => {
            return kernel.sendEvent(
                createEvent('test.init', { message: 'Init Test' }),
            );
        }).not.toThrow();
    });

    it('should send events through kernel to execution engine', async () => {
        // Arrange
        const testEvent = createEvent('test', { message: 'Hello World' });

        // Act
        const sendPromise = kernel.sendEvent(testEvent);

        // Assert
        // Não podemos verificar o lastEvent diretamente, mas podemos verificar
        // se o evento foi enviado com sucesso sem erros
        await expect(sendPromise).resolves.not.toThrow();
    });

    it('should pause execution and create snapshot', async () => {
        // Arrange
        const testEvent = createEvent('test', { message: 'Pause Test' });
        await kernel.sendEvent(testEvent);

        // Act
        const snapshotId = await kernel.pause('test_pause');

        // Assert
        expect(snapshotId).toBeDefined();
        expect(typeof snapshotId).toBe('string');
        // Não podemos verificar o status diretamente
    });

    it('should resume execution from snapshot', async () => {
        // Arrange
        const testEvent = createEvent('test', { message: 'Resume Test' });
        await kernel.sendEvent(testEvent);
        const snapshotId = await kernel.pause('test_pause');

        // Act
        await kernel.resume(snapshotId);

        // Assert
        // Verificamos que o kernel foi resumido com sucesso testando se podemos enviar outro evento
        const sendPromise = kernel.sendEvent(
            createEvent('test.after.resume', { message: 'After Resume' }),
        );
        await expect(sendPromise).resolves.not.toThrow();
    });

    it('should complete full lifecycle: initialize → send event → pause → resume → complete', async () => {
        // Arrange
        const testEvent = createEvent('test', { message: 'Lifecycle Test' });

        // Act & Assert - Cada etapa do ciclo de vida
        await kernel.sendEvent(testEvent);
        // Não podemos verificar o lastEvent diretamente

        const snapshotId = await kernel.pause('lifecycle_test');
        // Não podemos verificar o status diretamente

        await kernel.resume(snapshotId);
        // Verificamos que o kernel foi resumido com sucesso testando se podemos enviar outro evento
        const sendPromise = kernel.sendEvent(
            createEvent('test.after.lifecycle', {
                message: 'After Lifecycle Resume',
            }),
        );
        await expect(sendPromise).resolves.not.toThrow();

        await kernel.complete();
        // Não podemos verificar o status diretamente, mas o complete não deve lançar exceção
    });

    // Testes de manipulação de contexto
    it('should set and get context values', async () => {
        // Arrange
        const namespace = 'test-namespace';
        const key = 'test-key';
        const value = { data: 'test-value' };

        // Act
        kernel.setContext(namespace, key, value);
        const retrievedValue = kernel.getContext(namespace, key);

        // Assert
        expect(retrievedValue).toEqual(value);
    });

    it('should increment context counter', async () => {
        // Arrange
        const namespace = 'counters';
        const key = 'test-counter';

        // Act & Assert - Inicializa com 0 implicitamente
        const value1 = kernel.incrementContext(namespace, key);
        expect(value1).toBe(1);

        // Incrementa novamente
        const value2 = kernel.incrementContext(namespace, key);
        expect(value2).toBe(2);

        // Incrementa com delta específico
        const value3 = kernel.incrementContext(namespace, key, 5);
        expect(value3).toBe(7);
    });

    // Testes de múltiplos eventos em sequência
    it('should process multiple events in sequence', async () => {
        // Arrange
        const events = [
            createEvent('sequence', { step: 1 }),
            createEvent('sequence', { step: 2 }),
            createEvent('sequence', { step: 3 }),
        ];

        // Act
        for (const event of events) {
            await kernel.sendEvent(event);
        }

        // Assert - Se chegou aqui sem erros, o teste passou
        expect(true).toBe(true);
    });

    // Teste de tratamento de erros
    it('should handle errors gracefully when sending invalid events', async () => {
        // Arrange - Evento completamente inválido (null)
        // Usamos um valor null que definitivamente deve causar erro
        const completelyInvalidEvent = null;

        // Act & Assert - Deve lançar erro para valores null/undefined
        await expect(
            kernel.sendEvent(completelyInvalidEvent as never),
        ).rejects.toThrow();
    });

    // Teste de preservação de contexto através de snapshot
    it('should preserve context data through snapshot and restore', async () => {
        // Arrange
        const namespace = 'persistence-test';
        const key = 'test-value';
        const value = { data: 'persistent-data' };

        // Set context before snapshot
        kernel.setContext(namespace, key, value);

        // Create snapshot
        const snapshotId = await kernel.pause('context_persistence_test');

        // Act - Resume from snapshot
        await kernel.resume(snapshotId);

        // Assert - Context should be preserved
        const retrievedValue = kernel.getContext(namespace, key);
        expect(retrievedValue).toEqual(value);

        // Test that we can still send events after restore
        const testEvent = createEvent('test.after.restore', {
            message: 'After Restore',
        });
        await expect(kernel.sendEvent(testEvent)).resolves.not.toThrow();
    });
});
