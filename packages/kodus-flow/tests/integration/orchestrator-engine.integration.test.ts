/**
 * Teste de integração entre Orchestrator e Engine
 * Verifica se a camada de execução está funcionando corretamente
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createOrchestration } from '../../src/orchestration/sdk-orchestrator.js';
import { createMockLLMProvider } from '../../src/adapters/llm/index.js';
import { createAgent } from '../../src/engine/agents/agent-engine.js';
import { createDefaultMultiKernelHandler } from '../../src/engine/core/multi-kernel-handler.js';
import type { AgentDefinition } from '../../src/core/types/agent-types.js';

describe('Orchestrator vs AgentEngine Integration', () => {
    let kernelHandler: ReturnType<typeof createDefaultMultiKernelHandler>;

    // Setup global MultiKernelHandler para todos os testes
    beforeAll(async () => {
        kernelHandler = createDefaultMultiKernelHandler('test-tenant');
        await kernelHandler.initialize();
    });

    // Helper function para injetar MultiKernelHandler em agentes do Orchestrator
    const injectKernelHandler = (
        orchestration: ReturnType<typeof createOrchestration>,
        agentName: string,
    ) => {
        // @ts-expect-error acesso interno para teste
        const agentData = orchestration.agents.get(agentName);
        if (
            agentData &&
            typeof agentData.instance === 'object' &&
            agentData.instance !== null &&
            'setKernelHandler' in agentData.instance
        ) {
            (
                agentData.instance as {
                    setKernelHandler: (kh: typeof kernelHandler) => void;
                }
            ).setKernelHandler(kernelHandler);
        }
    };

    // ──────────────────────────────────────────────────────────────────────────
    // 🧪 TESTE 1: Orchestrator direto (atual)
    // ──────────────────────────────────────────────────────────────────────────

    it('should work with Orchestrator direct approach', async () => {
        const mockProvider = createMockLLMProvider();

        const orchestration = createOrchestration({
            tenantId: 'test-tenant',
            llmAdapter: mockProvider,
        });

        // Criar um agente simples
        await orchestration.createAgent({
            name: 'test-agent',
            description: 'Agente de teste',
            think: async (input: string, _context) => {
                return {
                    reasoning: `Processando: ${input}`,
                    action: {
                        type: 'final_answer',
                        content: `Resposta para: ${input}`,
                    },
                };
            },
        });

        // Injetar MultiKernelHandler no agente criado
        injectKernelHandler(orchestration, 'test-agent');

        // Chamar o agente
        const result = await orchestration.callAgent(
            'test-agent',
            'Olá mundo!',
        );

        expect(result.success).toBe(true);
        const agentResult = result.result as { output?: string };
        expect(agentResult.output).toBe('Resposta para: Olá mundo!');
        expect(result.metadata?.agentName).toBe('test-agent');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 🧪 TESTE 2: AgentEngine direto
    // ──────────────────────────────────────────────────────────────────────────

    it('should work with AgentEngine direct approach', async () => {
        // Criar MultiKernelHandler para o teste
        const kernelHandler = createDefaultMultiKernelHandler('test-tenant');
        await kernelHandler.initialize();

        // Criar definição do agente
        const agentDefinition: AgentDefinition<string, string, unknown> = {
            name: 'test-agent-engine',
            identity: {
                description: 'Agente de teste via Engine',
            },
            async think(input: string, context) {
                console.log('context', context);
                return {
                    reasoning: `Engine processando: ${input}`,
                    action: {
                        type: 'final_answer',
                        content: `Resposta Engine para: ${input}`,
                    },
                };
            },
        };

        // Criar AgentEngine
        const agentEngine = createAgent(agentDefinition, {
            tenantId: 'test-tenant',
            timeout: 30000,
        });

        // Configurar KernelHandler
        agentEngine.setKernelHandler(kernelHandler);

        // Executar via Engine
        const result = await agentEngine.execute('Olá mundo!', {
            thread: { id: 'test-thread', metadata: {} },
            correlationId: 'test-123',
        });

        expect(result.success).toBe(true);
        expect(result.output).toBe('Resposta Engine para: Olá mundo!');
        expect(result.metadata?.agentName).toBe('test-agent-engine');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 🧪 TESTE 3: Comparação de performance
    // ──────────────────────────────────────────────────────────────────────────

    it('should have similar performance between approaches', async () => {
        const orchestration = createOrchestration({ tenantId: 'test-tenant' });

        // Criar agente para teste
        await orchestration.createAgent({
            name: 'perf-agent',
            description: 'Agente de performance',
            think: async (input: string, context) => {
                // Simular processamento
                console.log('context', context);
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                    reasoning: `Processado: ${input}`,
                    action: {
                        type: 'final_answer',
                        content: `Resultado: ${input}`,
                    },
                };
            },
        });

        // Injetar MultiKernelHandler no agente criado
        injectKernelHandler(orchestration, 'perf-agent');

        // Teste Orchestrator
        const startOrchestrator = Date.now();
        await orchestration.callAgent('perf-agent', 'test');
        const timeOrchestrator = Date.now() - startOrchestrator;

        // Teste AgentEngine
        const kernelHandler = createKernelHandler({
            tenantId: 'test-tenant',
            debug: true,
        });
        await kernelHandler.initialize();

        const agentDefinition: AgentDefinition<string, string, unknown> = {
            name: 'perf-agent-engine',
            identity: {
                description: 'Agente de performance via Engine',
            },
            async think(input: string, context) {
                console.log('context', context);
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                    reasoning: `Engine processado: ${input}`,
                    action: {
                        type: 'final_answer',
                        content: `Resultado Engine: ${input}`,
                    },
                };
            },
        };

        const agentEngine = createAgent(agentDefinition, {
            tenantId: 'test-tenant',
        });

        // Configurar KernelHandler
        agentEngine.setKernelHandler(kernelHandler);

        const startEngine = Date.now();
        await agentEngine.execute('test', {
            thread: { id: 'test-thread', metadata: {} },
            correlationId: 'perf-test',
        });
        const timeEngine = Date.now() - startEngine;

        // Verificar se a diferença de performance é aceitável (< 50ms)
        const performanceDiff = Math.abs(timeEngine - timeOrchestrator);
        expect(performanceDiff).toBeLessThan(50);

        // Verificar se ambos são rápidos (< 100ms)
        expect(timeOrchestrator).toBeLessThan(100);
        expect(timeEngine).toBeLessThan(100);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 🧪 TESTE 4: Verificar se AgentEngine tem features extras
    // ──────────────────────────────────────────────────────────────────────────

    it('should have additional features in AgentEngine', async () => {
        const kernelHandler = createKernelHandler({
            tenantId: 'test-tenant',
            debug: true,
        });
        await kernelHandler.initialize();

        const agentDefinition: AgentDefinition<string, string, unknown> = {
            name: 'feature-agent',
            identity: {
                description: 'Agente com features',
            },
            async think(input: string, context) {
                console.log('context', context);
                return {
                    reasoning: `Processando com features: ${input}`,
                    action: {
                        type: 'final_answer',
                        content: `Resultado com features: ${input}`,
                    },
                };
            },
        };

        const agentEngine = createAgent(agentDefinition, {
            tenantId: 'test-tenant',
            enableMultiAgent: true,
            enableTools: true,
            maxThinkingIterations: 3,
        });

        // Configurar KernelHandler
        agentEngine.setKernelHandler(kernelHandler);

        // Verificar status do engine
        const status = agentEngine.getEngineStatus();
        expect(status.engineType).toBe('direct');
        expect(status.agentName).toBe('feature-agent');
        expect(status.isReady).toBe(true);

        // Verificar estatísticas
        const stats = agentEngine.getExecutionStats();
        expect(stats).toBeDefined();
        expect(typeof stats.totalExecutions).toBe('number');

        // Executar
        const result = await agentEngine.execute('teste features', {
            thread: { id: 'test-thread', metadata: {} },
            correlationId: 'features-test',
        });

        expect(result.success).toBe(true);
        expect(result.output).toBe('Resultado com features: teste features');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 🧪 TESTE 5: Verificar se Orchestrator tem features de SDK
    // ──────────────────────────────────────────────────────────────────────────

    it('should have SDK features in Orchestrator', async () => {
        const orchestration = createOrchestration({ tenantId: 'test-tenant' });

        let onStartCalled = false;
        let onFinishCalled = false;

        // Criar agente com hooks
        await orchestration.createAgent({
            name: 'sdk-agent',
            description: 'Agente com hooks SDK',
            think: async (input: string, context) => {
                console.log('context', context);
                return {
                    reasoning: `SDK processando: ${input}`,
                    action: {
                        type: 'final_answer',
                        content: `Resultado SDK: ${input}`,
                    },
                };
            },
            onStart: async (input, context) => {
                console.log('context', context);
                console.log('input', input);
                onStartCalled = true;
            },
            onFinish: async (result, context) => {
                console.log('result', result);
                console.log('context', context);
                onFinishCalled = true;
            },
        });

        // Injetar MultiKernelHandler no agente criado
        injectKernelHandler(orchestration, 'sdk-agent');

        // Chamar o agente
        const result = await orchestration.callAgent(
            'sdk-agent',
            'teste hooks',
        );

        expect(result.success).toBe(true);
        expect(onStartCalled).toBe(true);
        expect(onFinishCalled).toBe(true);

        // Verificar estatísticas do orchestrator
        const stats = orchestration.getStats();
        expect(stats.tenantId).toBe('test-tenant');
        expect(stats.totalAgents).toBe(1);
        expect(stats.agentNames).toContain('sdk-agent');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 🧪 TESTE 6: Verificar compatibilidade de tipos
    // ──────────────────────────────────────────────────────────────────────────

    it('should have compatible types between approaches', async () => {
        const orchestration = createOrchestration({ tenantId: 'test-tenant' });

        // Criar agente tipado
        await orchestration.createAgent<string, number>({
            name: 'typed-agent',
            description: 'Agente tipado',
            think: async (input: string, context) => {
                console.log('context', context);
                return {
                    reasoning: `Processando string: ${input}`,
                    action: {
                        type: 'final_answer',
                        content: input.length, // Retorna number
                    },
                };
            },
        });

        // Injetar MultiKernelHandler no agente criado
        injectKernelHandler(orchestration, 'typed-agent');

        // Chamar com tipos corretos
        const result = await orchestration.callAgent('typed-agent', 'teste');

        expect(result.success).toBe(true);
        const typedResult = result.result as { output?: number };
        expect(typeof typedResult.output).toBe('number');
        expect(typedResult.output).toBe(5); // 'teste' tem 5 caracteres
    });
});
