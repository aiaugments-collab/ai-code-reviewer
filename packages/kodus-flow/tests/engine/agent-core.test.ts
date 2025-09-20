/**
 * @file agent-core.test.ts
 * @description Testes unitários básicos para o AgentCore - Execução Paralela de Ferramentas
 *
 * Foca nos métodos principais de processamento de ferramentas paralelas
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import {
    AgentCore,
    type AgentCoreConfig,
} from '../../src/engine/agents/agent-core.js';
import { ToolEngine } from '../../src/engine/tools/tool-engine.js';
import type {
    ParallelToolsAction,
    SequentialToolsAction,
    ConditionalToolsAction,
    AgentContext,
} from '../../src/core/types/agent-types.js';
import type { MultiKernelHandler } from '../../src/engine/core/multi-kernel-handler.js';

// ===== IMPLEMENTAÇÃO CONCRETA PARA TESTES =====

class TestAgentCore extends AgentCore {
    constructor(config: AgentCoreConfig) {
        super(config);
    }

    public setToolEngineForTest(toolEngine: ToolEngine): void {
        this.toolEngine = toolEngine;
    }

    public setKernelHandlerForTest(kernelHandler: MultiKernelHandler): void {
        this.setKernelHandler(kernelHandler);
    }

    // Expor métodos protegidos para teste
    public async testProcessParallelToolsAction(
        action: ParallelToolsAction,
        context: AgentContext,
        correlationId: string = 'test-correlation-id',
    ) {
        return this.processParallelToolsAction(action, context, correlationId);
    }

    public async testProcessSequentialToolsAction(
        action: SequentialToolsAction,
        context: AgentContext,
        correlationId: string = 'test-correlation-id',
    ) {
        return this.processSequentialToolsAction(
            action,
            context,
            correlationId,
        );
    }

    public async testProcessConditionalToolsAction(
        action: ConditionalToolsAction,
        context: AgentContext,
        correlationId: string = 'test-correlation-id',
    ) {
        return this.processConditionalToolsAction(
            action,
            context,
            correlationId,
        );
    }
}

// ===== MOCKS =====

const createMockToolEngine = () => {
    const mockToolEngine = {
        executeParallelTools: vi.fn().mockResolvedValue([
            { toolName: 'tool1', result: { result: 'tool1 result' } },
            { toolName: 'tool2', result: { result: 'tool2 result' } },
        ]),
        executeSequentialTools: vi.fn().mockResolvedValue([
            { toolName: 'tool1', result: { result: 'tool1 result' } },
            { toolName: 'tool2', result: { result: 'tool2 result' } },
        ]),
        executeConditionalTools: vi.fn().mockResolvedValue([
            { toolName: 'tool1', result: { result: 'tool1 result' } },
            { toolName: 'tool2', result: { result: 'tool2 result' } },
        ]),
        getAvailableTools: vi.fn().mockReturnValue([
            { name: 'tool1', description: 'Mock tool 1', schema: {} },
            { name: 'tool2', description: 'Mock tool 2', schema: {} },
        ]),
        registerTool: vi.fn(),
        setKernelHandler: vi.fn(),
    } as unknown as ToolEngine;

    return mockToolEngine;
};

const createMockKernelHandler = () => {
    return {
        emit: vi.fn(),
        getMultiKernelManager: vi.fn().mockReturnValue({
            getRuntime: vi.fn().mockReturnValue({
                emitAsync: vi.fn().mockResolvedValue({
                    success: true,
                    eventId: 'test-event',
                }),
                ack: vi.fn().mockResolvedValue(undefined),
            }),
        }),
        initialize: vi.fn(),
    } as unknown as MultiKernelHandler;
};

const createMockAgentContext = (): AgentContext => {
    const stateManager = {
        getState: vi.fn(),
        setState: vi.fn(),
        clearState: vi.fn(),
    };

    return {
        agentName: 'test-agent',
        invocationId: 'inv-123',
        executionId: 'exec-123',
        correlationId: 'corr-123',
        tenantId: 'test-tenant',
        sessionId: 'session-123',
        threadId: 'thread-123',
        startTime: Date.now(),
        status: 'RUNNING',
        metadata: {},
        state: new Map(),
        availableTools: [
            { name: 'tool1', description: 'Mock tool 1', schema: {} },
            { name: 'tool2', description: 'Mock tool 2', schema: {} },
        ],
        stateManager,
        signal: new AbortController().signal,
        cleanup: vi.fn(),
    } as AgentContext;
};

// ===== TESTES =====

describe('AgentCore - Parallel Tool Execution', () => {
    let agentCore: TestAgentCore;
    let mockToolEngine: ToolEngine;
    let mockKernelHandler: MultiKernelHandler;
    let mockContext: AgentContext;
    let config: AgentCoreConfig;

    beforeEach(() => {
        mockToolEngine = createMockToolEngine();
        mockKernelHandler = createMockKernelHandler();
        mockContext = createMockAgentContext();

        config = {
            tenantId: 'test-tenant',
            enableKernelIntegration: true,
            maxThinkingIterations: 5,
        };

        agentCore = new TestAgentCore(config);
        agentCore.setToolEngineForTest(mockToolEngine);
        agentCore.setKernelHandlerForTest(mockKernelHandler);

        vi.clearAllMocks();
    });

    describe('processParallelToolsAction()', () => {
        it('deve executar ferramentas em paralelo e retornar resultados', async () => {
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [
                    { toolName: 'tool1', input: { data: 'test1' } },
                    { toolName: 'tool2', input: { data: 'test2' } },
                ],
                concurrency: 2,
                timeout: 5000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'Test parallel execution',
            };

            const result = await agentCore.testProcessParallelToolsAction(
                action,
                mockContext,
            );

            // Verificar que ToolEngine foi chamado
            expect(mockToolEngine.executeParallelTools).toHaveBeenCalledWith(
                action,
            );

            // Verificar resultados
            expect(result).toHaveLength(2);
            expect(result[0].toolName).toBe('tool1');
            expect(result[1].toolName).toBe('tool2');
            expect(result.every((r) => r.result)).toBe(true);
        });

        it('deve lidar com falhas quando mock retorna erro', async () => {
            // Mock falha no ToolEngine
            (mockToolEngine.executeParallelTools as Mock).mockRejectedValue(
                new Error('Parallel execution failed'),
            );

            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [
                    { toolName: 'tool1', input: {} },
                    { toolName: 'failingTool', input: {} },
                ],
                concurrency: 2,
                timeout: 5000,
                failFast: true,
                aggregateResults: false,
                reasoning: 'Test error handling',
            };

            // Deve lançar erro
            await expect(
                agentCore.testProcessParallelToolsAction(action, mockContext),
            ).rejects.toThrow('Parallel execution failed');

            expect(mockToolEngine.executeParallelTools).toHaveBeenCalledWith(
                action,
            );
        });

        it('deve emitir eventos quando KernelHandler está disponível', async () => {
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [{ toolName: 'tool1', input: { value: 10 } }],
                concurrency: 1,
                timeout: 5000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'Test event emission',
            };

            await agentCore.testProcessParallelToolsAction(action, mockContext);

            // Verificar que kernel foi acessado para emitir eventos
            expect(mockKernelHandler.getMultiKernelManager).toHaveBeenCalled();
        });
    });

    describe('processSequentialToolsAction()', () => {
        it('deve executar ferramentas sequencialmente', async () => {
            const action: SequentialToolsAction = {
                type: 'sequential_tools',
                tools: [
                    { toolName: 'tool1', input: { data: 'initial' } },
                    { toolName: 'tool2', input: { data: 'second' } },
                ],
                stopOnError: true,
                passResults: true,
                timeout: 5000,
                reasoning: 'Test sequential execution',
            };

            const result = await agentCore.testProcessSequentialToolsAction(
                action,
                mockContext,
            );

            // Verificar que ToolEngine foi chamado
            expect(mockToolEngine.executeSequentialTools).toHaveBeenCalledWith(
                action,
            );

            // Verificar resultados
            expect(result).toHaveLength(2);
            expect(result[0].toolName).toBe('tool1');
            expect(result[1].toolName).toBe('tool2');
        });

        it('deve lidar com resultados parciais quando há falhas', async () => {
            // Mock resultado com falha parcial
            (mockToolEngine.executeSequentialTools as Mock).mockResolvedValue([
                { toolName: 'tool1', result: { result: 'success' } },
                { toolName: 'tool2', error: 'Tool failed' },
            ]);

            const action: SequentialToolsAction = {
                type: 'sequential_tools',
                tools: [
                    { toolName: 'tool1', input: {} },
                    { toolName: 'tool2', input: {} },
                ],
                stopOnError: true,
                passResults: false,
                timeout: 5000,
                reasoning: 'Test stop on error',
            };

            const result = await agentCore.testProcessSequentialToolsAction(
                action,
                mockContext,
            );

            // Deve processar resultados parciais
            expect(result).toHaveLength(2);
            expect(result[0].result).toBeDefined();
            expect(result[1].error).toBeDefined();
        });
    });

    describe('processConditionalToolsAction()', () => {
        it('deve executar ferramentas baseado em condições', async () => {
            const action: ConditionalToolsAction = {
                type: 'conditional_tools',
                tools: [
                    {
                        toolName: 'tool1',
                        input: {},
                        conditions: { always: true },
                    },
                    {
                        toolName: 'tool2',
                        input: {},
                        conditions: {
                            dependsOn: ['tool1'],
                            executeIf: 'success',
                        },
                    },
                ],
                conditions: {}, // Adicionar conditions para evitar undefined
                reasoning: 'Test conditional execution',
            };

            const result = await agentCore.testProcessConditionalToolsAction(
                action,
                mockContext,
            );

            // Verificar que ToolEngine foi chamado
            expect(mockToolEngine.executeConditionalTools).toHaveBeenCalledWith(
                action,
            );

            // Verificar resultados
            expect(result).toHaveLength(2);
            expect(result.every((r) => r.result)).toBe(true);
        });

        it('deve lidar com condições complexas', async () => {
            // Mock resultado com dependências
            (mockToolEngine.executeConditionalTools as Mock).mockResolvedValue([
                { toolName: 'tool1', result: { result: 'success' } },
                {
                    toolName: 'tool2',
                    result: { result: 'conditional success' },
                },
            ]);

            const action: ConditionalToolsAction = {
                type: 'conditional_tools',
                tools: [
                    {
                        toolName: 'tool1',
                        input: {},
                        conditions: { always: true },
                    },
                    {
                        toolName: 'tool2',
                        input: {},
                        conditions: {
                            dependsOn: ['tool1'],
                            executeIf: 'success',
                        },
                    },
                ],
                conditions: {},
                evaluateAll: true,
                reasoning: 'Test complex dependencies',
            };

            const result = await agentCore.testProcessConditionalToolsAction(
                action,
                mockContext,
            );

            // Verificar processamento
            expect(result).toHaveLength(2);
            expect(result[0].result).toBeDefined();
            expect(result[1].result).toBeDefined();
        });
    });

    describe('Error Handling e Edge Cases', () => {
        it('deve falhar quando ToolEngine não está disponível', async () => {
            const agentCoreWithoutTools = new TestAgentCore(config);
            // Não configurar ToolEngine

            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [{ toolName: 'tool1', input: {} }],
                concurrency: 1,
                timeout: 5000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'Test without tools',
            };

            await expect(
                agentCoreWithoutTools.testProcessParallelToolsAction(
                    action,
                    mockContext,
                ),
            ).rejects.toThrow('Tool engine not available');
        });

        it('deve funcionar mesmo sem KernelHandler', async () => {
            const agentCoreWithoutKernel = new TestAgentCore(config);
            agentCoreWithoutKernel.setToolEngineForTest(mockToolEngine);
            // Não configurar KernelHandler

            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [{ toolName: 'tool1', input: {} }],
                concurrency: 1,
                timeout: 5000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'Test without kernel',
            };

            const result =
                await agentCoreWithoutKernel.testProcessParallelToolsAction(
                    action,
                    mockContext,
                );

            // Deve funcionar mesmo sem kernel
            expect(result).toHaveLength(2); // Mock retorna 2 resultados
        });
    });
});
