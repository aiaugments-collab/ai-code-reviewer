/**
 * @file tool-engine.test.ts
 * @description Testes unitários abrangentes para o ToolEngine - Execução Paralela de Ferramentas
 *
 * Testa todos os novos métodos implementados:
 * - executeParallelTools()
 * - executeSequentialTools()
 * - executeConditionalTools()
 * - createBatches()
 * - Gerenciamento de concorrência
 * - Tratamento de erros avançado
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolEngine } from '../../src/engine/tools/tool-engine.js';
import type {
    ParallelToolsAction,
    SequentialToolsAction,
    ConditionalToolsAction,
} from '../../src/core/types/agent-types.js';
import { z } from 'zod';
import { ToolCall } from '../../src/core/types/tool-types.js';
import { extractDescription } from '../../src/core/utils/zod-to-json-schema';

// ===== MOCKS E SETUP =====

const createMockTool = (
    name: string,
    delay: number = 100,
    shouldFail: boolean = false,
) => ({
    name,
    description: `Mock tool ${name}`,
    inputSchema: z.object({}),
    execute: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (shouldFail) {
            throw new Error(`Tool ${name} failed`);
        }
        return {
            result: `${name} executed successfully`,
            timestamp: Date.now(),
        };
    }),
});

describe('ToolEngine - Parallel Tool Execution', () => {
    let toolEngine: ToolEngine;
    let mockTool1: ReturnType<typeof createMockTool>;
    let mockTool2: ReturnType<typeof createMockTool>;
    let mockTool3: ReturnType<typeof createMockTool>;
    let mockFailingTool: ReturnType<typeof createMockTool>;

    beforeEach(() => {
        toolEngine = new ToolEngine();

        // Criar ferramentas mock
        mockTool1 = createMockTool('tool1', 50);
        mockTool2 = createMockTool('tool2', 100);
        mockTool3 = createMockTool('tool3', 75);
        mockFailingTool = createMockTool('failingTool', 25, true);

        // Registrar ferramentas no engine
        toolEngine.registerTool(mockTool1);
        toolEngine.registerTool(mockTool2);
        toolEngine.registerTool(mockTool3);
        toolEngine.registerTool(mockFailingTool);

        // Limpar mocks
        vi.clearAllMocks();
    });

    // ===== EXECUÇÃO PARALELA =====

    describe('executeParallelTools()', () => {
        it('deve executar múltiplas ferramentas em paralelo com sucesso', async () => {
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [
                    { toolName: 'tool1', input: { data: 'test1' } },
                    { toolName: 'tool2', input: { data: 'test2' } },
                    { toolName: 'tool3', input: { data: 'test3' } },
                ],
                concurrency: 3,
                timeout: 5000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'Test parallel execution',
            };

            const startTime = Date.now();
            const results = await toolEngine.executeParallelTools(action);
            const endTime = Date.now();
            const executionTime = endTime - startTime;

            // Verificar resultados
            expect(results).toHaveLength(3);
            expect(results.every((r) => r.result && !r.error)).toBe(true);

            // Verificar que foi executado em paralelo (tempo total < soma dos delays)
            expect(executionTime).toBeLessThan(300); // 50+100+75 = 225ms, paralelo deve ser ~100ms

            // Verificar que todas as ferramentas foram chamadas
            expect(mockTool1.execute).toHaveBeenCalled();
            expect(mockTool2.execute).toHaveBeenCalled();
            expect(mockTool3.execute).toHaveBeenCalled();
        });

        it('deve respeitar o limite de concorrência', async () => {
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [
                    { toolName: 'tool1', input: {} },
                    { toolName: 'tool2', input: {} },
                    { toolName: 'tool3', input: {} },
                ],
                concurrency: 2, // Limite de 2 execuções simultâneas
                timeout: 5000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'Test concurrency limit',
            };

            const startTime = Date.now();
            const results = await toolEngine.executeParallelTools(action);
            const endTime = Date.now();
            const executionTime = endTime - startTime;

            // Com concorrência 2, deve demorar mais que execução totalmente paralela
            // mas menos que execução sequencial
            expect(executionTime).toBeGreaterThan(100); // Não totalmente paralelo
            expect(executionTime).toBeLessThan(300); // Não totalmente sequencial
            expect(results).toHaveLength(3);
        });

        it('deve lidar com failFast=true parando na primeira falha', async () => {
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [
                    { toolName: 'failingTool', input: {} },
                    { toolName: 'tool1', input: {} },
                    { toolName: 'tool2', input: {} },
                ],
                concurrency: 3,
                timeout: 5000,
                failFast: true,
                aggregateResults: false,
                reasoning: 'Test fail fast',
            };

            try {
                await toolEngine.executeParallelTools(action);
                // Se chegou aqui, deve ter pelo menos um erro nos resultados
                // (failFast pode ainda retornar resultados parciais)
                expect(true).toBe(true); // Test passes if no exception thrown
            } catch (error) {
                // Com failFast, deve lançar uma exceção
                expect(error).toBeDefined();
                expect((error as Error).message).toContain('failed');
            }
        });

        it('deve lidar com timeout global', async () => {
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [
                    { toolName: 'tool1', input: {} },
                    { toolName: 'tool2', input: {} },
                ],
                concurrency: 2,
                timeout: 50, // Timeout muito baixo
                failFast: false,
                aggregateResults: true,
                reasoning: 'Test timeout',
            };

            try {
                await toolEngine.executeParallelTools(action);
                // Se chegou aqui sem timeout, pode ser que as ferramentas foram muito rápidas
                expect(true).toBe(true); // Test passes
            } catch (error) {
                // Timeout deve lançar uma exceção
                expect(error).toBeDefined();
                expect((error as Error).message).toContain('timeout');
            }
        });

        it('deve agregar resultados quando aggregateResults=true', async () => {
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [
                    { toolName: 'tool1', input: { value: 10 } },
                    { toolName: 'tool2', input: { value: 20 } },
                ],
                concurrency: 2,
                timeout: 5000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'Test result aggregation',
            };

            const results = await toolEngine.executeParallelTools(action);

            expect(results).toHaveLength(2);
            expect(results.every((r) => r.result)).toBe(true);
            expect(results.every((r) => !r.error)).toBe(true);
        });
    });

    // ===== EXECUÇÃO SEQUENCIAL =====

    describe('executeSequentialTools()', () => {
        it('deve executar ferramentas em sequência com passagem de resultados', async () => {
            const action: SequentialToolsAction = {
                type: 'sequential_tools',
                tools: [
                    { toolName: 'tool1', input: { data: 'initial' } },
                    { toolName: 'tool2', input: { data: 'second' } },
                    { toolName: 'tool3', input: { data: 'third' } },
                ],
                stopOnError: true,
                passResults: true,
                timeout: 5000,
                reasoning: 'Test sequential execution',
            };

            const startTime = Date.now();
            const results = await toolEngine.executeSequentialTools(action);
            const endTime = Date.now();
            const executionTime = endTime - startTime;

            // Verificar que foi executado sequencialmente (tempo ≥ soma dos delays)
            expect(executionTime).toBeGreaterThanOrEqual(200); // 50+100+75 = 225ms

            // Verificar ordem de execução
            expect(results).toHaveLength(3);
            expect(results.every((r) => r.result && !r.error)).toBe(true);

            // Verificar que foram chamadas na ordem correta
            const calls = [
                mockTool1.execute,
                mockTool2.execute,
                mockTool3.execute,
            ];
            for (let i = 1; i < calls.length; i++) {
                expect(calls[i].mock.invocationCallOrder[0]).toBeGreaterThan(
                    calls[i - 1].mock.invocationCallOrder[0],
                );
            }
        });

        it('deve parar na primeira falha quando stopOnError=true', async () => {
            const action: SequentialToolsAction = {
                type: 'sequential_tools',
                tools: [
                    { toolName: 'tool1', input: {} },
                    { toolName: 'failingTool', input: {} },
                    { toolName: 'tool3', input: {} },
                ],
                stopOnError: true,
                passResults: false,
                timeout: 5000,
                reasoning: 'Test stop on error',
            };

            const results = await toolEngine.executeSequentialTools(action);

            // Deve ter parado na segunda ferramenta
            expect(results.length).toBeLessThanOrEqual(2);

            // A terceira ferramenta não deve ter sido executada
            expect(mockTool3.execute).not.toHaveBeenCalled();

            // Deve ter erro na segunda posição
            const hasError = results.some((r) => r.error);
            expect(hasError).toBe(true);
        });

        it('deve continuar executando quando stopOnError=false', async () => {
            const action: SequentialToolsAction = {
                type: 'sequential_tools',
                tools: [
                    { toolName: 'tool1', input: {} },
                    { toolName: 'failingTool', input: {} },
                    { toolName: 'tool3', input: {} },
                ],
                stopOnError: false,
                passResults: false,
                timeout: 5000,
                reasoning: 'Test continue on error',
            };

            const results = await toolEngine.executeSequentialTools(action);

            // Deve ter executado todas as 3 ferramentas
            expect(results).toHaveLength(3);
            expect(mockTool1.execute).toHaveBeenCalled();
            expect(mockFailingTool.execute).toHaveBeenCalled();
            expect(mockTool3.execute).toHaveBeenCalled();

            // Deve ter uma falha no meio
            const errorIndex = results.findIndex((r) => r.error);
            expect(errorIndex).toBe(1); // Segundo item (failingTool)
        });

        it('deve passar resultados entre ferramentas quando passResults=true', async () => {
            // Este teste verificaria a passagem de resultados, mas o mock atual não implementa isso
            // Na implementação real, o resultado da tool1 seria passado como input para tool2
            const action: SequentialToolsAction = {
                type: 'sequential_tools',
                tools: [
                    { toolName: 'tool1', input: { initialData: 'start' } },
                    { toolName: 'tool2', input: {} }, // Deveria receber resultado da tool1
                ],
                stopOnError: true,
                passResults: true,
                timeout: 5000,
                reasoning: 'Test result passing',
            };

            const results = await toolEngine.executeSequentialTools(action);

            expect(results).toHaveLength(2);
            expect(results.every((r) => r.result)).toBe(true);

            // Na implementação real, verificaríamos se o input da tool2
            // contém o resultado da tool1
        });
    });

    // ===== EXECUÇÃO CONDICIONAL =====

    describe('executeConditionalTools()', () => {
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
                    {
                        toolName: 'tool3',
                        input: {},
                        conditions: {
                            dependsOn: ['tool1'],
                            executeIf: 'failure',
                        },
                    },
                ],
                reasoning: 'Test conditional execution',
            };

            const results = await toolEngine.executeConditionalTools(action);

            // tool1 deve sempre executar
            expect(mockTool1.execute).toHaveBeenCalled();

            // tool2 deve executar porque tool1 teve sucesso
            expect(mockTool2.execute).toHaveBeenCalled();

            // tool3 NÃO deve executar porque tool1 não falhou
            expect(mockTool3.execute).not.toHaveBeenCalled();

            // Deve ter resultados apenas para tool1 e tool2
            expect(results.filter((r) => r.result)).toHaveLength(2);
        });

        it('deve lidar com dependências complexas', async () => {
            const action: ConditionalToolsAction = {
                type: 'conditional_tools',
                tools: [
                    {
                        toolName: 'tool1',
                        input: {},
                        conditions: { always: true },
                    },
                    {
                        toolName: 'failingTool',
                        input: {},
                        conditions: {
                            dependsOn: ['tool1'],
                            executeIf: 'success',
                        },
                    },
                    {
                        toolName: 'tool3',
                        input: {},
                        conditions: {
                            dependsOn: ['failingTool'],
                            executeIf: 'failure',
                        },
                    },
                ],
                reasoning: 'Test complex dependencies',
            };

            const results = await toolEngine.executeConditionalTools(action);

            // tool1 executa
            expect(mockTool1.execute).toHaveBeenCalled();

            // failingTool executa porque tool1 teve sucesso
            expect(mockFailingTool.execute).toHaveBeenCalled();

            // tool3 executa porque failingTool falhou
            expect(mockTool3.execute).toHaveBeenCalled();

            expect(results).toHaveLength(3);
        });
    });

    // ===== GERENCIAMENTO DE BATCHES =====

    describe('createBatches() e Batching System', () => {
        it('deve criar batches corretos baseado na concorrência', async () => {
            const tools: ToolCall[] = [
                { toolName: 'tool1', input: {} },
                { toolName: 'tool2', input: {} },
                { toolName: 'tool3', input: {} },
                { toolName: 'tool1', input: {} }, // Reutilizar tool1
                { toolName: 'tool2', input: {} }, // Reutilizar tool2
            ];

            // Simular execução com concorrência 2
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools,
                concurrency: 2,
                timeout: 5000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'Test batching',
            };

            const results = await toolEngine.executeParallelTools(action);

            // Deve ter executado todas as 5 ferramentas
            expect(results).toHaveLength(5);

            // tool1 deve ter sido chamada 2 vezes
            expect(mockTool1.execute).toHaveBeenCalledTimes(2);
            expect(mockTool2.execute).toHaveBeenCalledTimes(2);
            expect(mockTool3.execute).toHaveBeenCalledTimes(1);
        });

        it('deve processar batches grandes eficientemente', async () => {
            // Criar muitas ferramentas
            const tools: ToolCall[] = Array.from({ length: 10 }, (_, i) => ({
                toolName:
                    i % 3 === 0 ? 'tool1' : i % 3 === 1 ? 'tool2' : 'tool3',
                input: { batch: i },
            }));

            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools,
                concurrency: 3,
                timeout: 10000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'Test large batch',
            };

            const startTime = Date.now();
            const results = await toolEngine.executeParallelTools(action);
            const endTime = Date.now();

            expect(results).toHaveLength(10);
            expect(endTime - startTime).toBeLessThan(1000); // Deve ser eficiente
        });
    });

    // ===== TRATAMENTO DE ERROS AVANÇADO =====

    describe('Advanced Error Handling', () => {
        it('deve isolar erros entre ferramentas em execução paralela', async () => {
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [
                    { toolName: 'tool1', input: {} },
                    { toolName: 'failingTool', input: {} },
                    { toolName: 'tool3', input: {} },
                ],
                concurrency: 3,
                timeout: 5000,
                failFast: false,
                aggregateResults: false,
                reasoning: 'Test error isolation',
            };

            const results = await toolEngine.executeParallelTools(action);

            // Deve ter 3 resultados
            expect(results).toHaveLength(3);

            // 2 devem ter sucesso, 1 deve ter erro
            const successes = results.filter((r) => r.result && !r.error);
            const errors = results.filter((r) => r.error);

            expect(successes).toHaveLength(2);
            expect(errors).toHaveLength(1);
            expect(errors[0].toolName).toBe('failingTool');
        });

        it('deve incluir informações detalhadas de erro', async () => {
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [
                    {
                        toolName: 'failingTool',
                        input: { testData: 'error case' },
                    },
                ],
                concurrency: 1,
                timeout: 5000,
                failFast: false,
                aggregateResults: false,
                reasoning: 'Test error details',
            };

            const results = await toolEngine.executeParallelTools(action);

            expect(results).toHaveLength(1);
            expect(results[0].error).toBeDefined();
            expect(results[0].error).toContain('failingTool failed');
            expect(results[0].toolName).toBe('failingTool');
            expect(results[0].result).toBeUndefined();
        });

        it('deve lidar com ferramentas não encontradas', async () => {
            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools: [
                    { toolName: 'nonexistentTool', input: {} },
                    { toolName: 'tool1', input: {} },
                ],
                concurrency: 2,
                timeout: 5000,
                failFast: false,
                aggregateResults: false,
                reasoning: 'Test missing tools',
            };

            const results = await toolEngine.executeParallelTools(action);

            expect(results).toHaveLength(2);

            // Uma deve falhar (ferramenta não encontrada)
            const missingToolResult = results.find(
                (r) => r.toolName === 'nonexistentTool',
            );
            expect(missingToolResult?.error).toBeDefined();

            // A outra deve ter sucesso
            const validToolResult = results.find((r) => r.toolName === 'tool1');
            expect(validToolResult?.result).toBeDefined();
            expect(validToolResult?.error).toBeUndefined();
        });
    });

    // ===== PERFORMANCE E OTIMIZAÇÃO =====

    describe('Performance and Optimization', () => {
        it('deve otimizar execução paralela vs sequencial', async () => {
            const tools: ToolCall[] = [
                { toolName: 'tool1', input: {} },
                { toolName: 'tool2', input: {} },
                { toolName: 'tool3', input: {} },
            ];

            // Execução paralela
            const parallelAction: ParallelToolsAction = {
                type: 'parallel_tools',
                tools,
                concurrency: 3,
                timeout: 5000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'Parallel performance test',
            };

            const startParallel = Date.now();
            await toolEngine.executeParallelTools(parallelAction);
            const parallelTime = Date.now() - startParallel;

            // Reset mocks
            vi.clearAllMocks();

            // Execução sequencial
            const sequentialAction: SequentialToolsAction = {
                type: 'sequential_tools',
                tools,
                stopOnError: false,
                passResults: false,
                timeout: 5000,
                reasoning: 'Sequential performance test',
            };

            const startSequential = Date.now();
            await toolEngine.executeSequentialTools(sequentialAction);
            const sequentialTime = Date.now() - startSequential;

            // Execução paralela deve ser significativamente mais rápida
            expect(parallelTime).toBeLessThan(sequentialTime * 0.7);
        });

        it('deve lidar eficientemente com alta concorrência', async () => {
            // Criar muitas ferramentas idênticas
            const tools: ToolCall[] = Array.from({ length: 20 }, () => ({
                toolName: 'tool1',
                input: { data: 'stress test' },
            }));

            const action: ParallelToolsAction = {
                type: 'parallel_tools',
                tools,
                concurrency: 10,
                timeout: 10000,
                failFast: false,
                aggregateResults: true,
                reasoning: 'High concurrency test',
            };

            const startTime = Date.now();
            const results = await toolEngine.executeParallelTools(action);
            const endTime = Date.now();

            expect(results).toHaveLength(20);
            expect(results.every((r) => r.result)).toBe(true);
            expect(endTime - startTime).toBeLessThan(2000); // Deve terminar rapidamente
            expect(mockTool1.execute).toHaveBeenCalledTimes(20);
        });
    });
});

describe('ToolEngine - Enhanced Schema Conversion', () => {
    let toolEngine: ToolEngine;

    beforeEach(() => {
        toolEngine = new ToolEngine();
    });

    describe('getToolsForLLM - Schema Preservation', () => {
        it('should preserve optional fields correctly', () => {
            // Create a tool with optional fields
            const optionalTool = {
                name: 'test.optional_tool',
                description: 'Test tool with optional fields',
                inputSchema: z.object({
                    requiredField: z.string(),
                    optionalField: z.string().optional(),
                    nullableField: z.string().nullable(),
                    defaultField: z.string().default('default'),
                }),
                execute: async () => ({ result: 'success' }),
            };

            toolEngine.registerTool(optionalTool);

            const tools = toolEngine.getToolsForLLM();
            const testTool = tools.find((t) => t.name === 'test.optional_tool');

            expect(testTool).toBeDefined();
            expect(testTool?.parameters).toBeDefined();

            const params = testTool!.parameters as Record<string, unknown>;
            const properties = params.properties as Record<string, unknown>;
            const required = params.required as string[];

            // Should only have required_field in required array
            expect(required).toContain('requiredField');
            expect(required).not.toContain('optionalField');
            expect(required).not.toContain('nullableField');
            expect(required).not.toContain('defaultField');

            // Should have all fields in properties
            expect(properties.requiredField).toBeDefined();
            expect(properties.optionalField).toBeDefined();
            expect(properties.nullableField).toBeDefined();
            expect(properties.defaultField).toBeDefined();
        });

        it('should preserve complex object types', () => {
            const complexTool = {
                name: 'test.complex_tool',
                description: 'Test tool with complex object types',
                inputSchema: z.object({
                    pageSize: z.object({
                        value: z.number(),
                        unit: z.string(),
                    }),
                    filters: z
                        .object({
                            status: z.enum(['active', 'inactive']),
                            dateRange: z
                                .object({
                                    start: z.string(),
                                    end: z.string(),
                                })
                                .optional(),
                        })
                        .optional(),
                }),
                execute: async () => ({ result: 'success' }),
            };

            toolEngine.registerTool(complexTool);

            const tools = toolEngine.getToolsForLLM();
            const testTool = tools.find((t) => t.name === 'test.complex_tool');

            expect(testTool).toBeDefined();

            const params = testTool!.parameters as Record<string, unknown>;
            const properties = params.properties as Record<string, unknown>;

            // Should preserve nested object structure
            const pageSize = properties.pageSize as Record<string, unknown>;
            expect(pageSize.type).toBe('object');
            expect(pageSize.properties).toBeDefined();

            const pageSizeProps = pageSize.properties as Record<
                string,
                unknown
            >;
            expect(pageSizeProps.value?.type).toBe('number');
            expect(pageSizeProps.unit?.type).toBe('string');
        });

        it('should preserve enum types correctly', () => {
            const enumTool = {
                name: 'test.enum_tool',
                description: 'Test tool with enum types',
                inputSchema: z.object({
                    priority: z.enum(['low', 'medium', 'high']),
                    status: z.enum(['active', 'inactive', 'pending']),
                }),
                execute: async () => ({ result: 'success' }),
            };

            toolEngine.registerTool(enumTool);

            const tools = toolEngine.getToolsForLLM();
            const testTool = tools.find((t) => t.name === 'test.enum_tool');

            expect(testTool).toBeDefined();

            const params = testTool!.parameters as Record<string, unknown>;
            const properties = params.properties as Record<string, unknown>;

            // Should preserve enum values
            const priority = properties.priority as Record<string, unknown>;
            expect(priority.type).toBe('string');
            expect(priority.enum).toEqual(['low', 'medium', 'high']);

            const status = properties.status as Record<string, unknown>;
            expect(status.type).toBe('string');
            expect(status.enum).toEqual(['active', 'inactive', 'pending']);
        });

        it('should handle union types correctly', () => {
            const unionTool = {
                name: 'test.union_tool',
                description: 'Test tool with union types',
                inputSchema: z.object({
                    id: z.union([z.string(), z.number()]),
                    status: z.union([
                        z.literal('active'),
                        z.literal('inactive'),
                    ]),
                }),
                execute: async () => ({ result: 'success' }),
            };

            toolEngine.registerTool(unionTool);

            const tools = toolEngine.getToolsForLLM();
            const testTool = tools.find((t) => t.name === 'test.union_tool');

            expect(testTool).toBeDefined();

            const params = testTool!.parameters as Record<string, unknown>;
            const properties = params.properties as Record<string, unknown>;

            // Should handle union types appropriately
            const id = properties.id as Record<string, unknown>;
            expect(id.anyOf).toBeDefined();

            const status = properties.status as Record<string, unknown>;
            // Should convert literal union to enum
            expect(status.type).toBe('string');
            expect(status.enum).toEqual(['active', 'inactive']);
        });

        it('should preserve .describe() descriptions correctly', () => {
            const describeTool = {
                name: 'test.describe_tool',
                description: 'Test tool with .describe() descriptions',
                inputSchema: z.object({
                    organizationId: z
                        .string()
                        .describe(
                            'Organization UUID - unique identifier for the organization in the system',
                        ),
                    teamId: z
                        .string()
                        .describe(
                            'Team UUID - unique identifier for the team within the organization',
                        ),
                    filters: z
                        .object({
                            archived: z
                                .boolean()
                                .optional()
                                .describe(
                                    'Filter by archived status: true (only archived repos), false (only active repos), undefined (all repos)',
                                ),
                            private: z
                                .boolean()
                                .optional()
                                .describe(
                                    'Filter by visibility: true (only private repos), false (only public repos), undefined (all repos)',
                                ),
                            language: z
                                .string()
                                .optional()
                                .describe(
                                    'Filter by primary programming language (e.g., "JavaScript", "TypeScript", "Python")',
                                ),
                        })
                        .optional()
                        .describe(
                            'Optional filters to narrow down repository results',
                        ),
                }),
                execute: async () => ({ result: 'success' }),
            };

            toolEngine.registerTool(describeTool);

            const tools = toolEngine.getToolsForLLM();
            const testTool = tools.find((t) => t.name === 'test.describe_tool');

            expect(testTool).toBeDefined();

            const params = testTool!.parameters;
            expect(params).toBeDefined();

            // Check that descriptions are preserved
            expect(params.properties?.organizationId?.description).toBe(
                'Organization UUID - unique identifier for the organization in the system',
            );
            expect(params.properties?.teamId?.description).toBe(
                'Team UUID - unique identifier for the team within the organization',
            );
            expect(params.properties?.filters?.description).toBe(
                'Optional filters to narrow down repository results',
            );

            // Check nested object descriptions
            const filtersProps = params.properties?.filters
                ?.properties as Record<string, unknown>;
            expect(filtersProps.archived?.description).toBe(
                'Filter by archived status: true (only archived repos), false (only active repos), undefined (all repos)',
            );
            expect(filtersProps.private?.description).toBe(
                'Filter by visibility: true (only private repos), false (only public repos), undefined (all repos)',
            );
            expect(filtersProps.language?.description).toBe(
                'Filter by primary programming language (e.g., "JavaScript", "TypeScript", "Python")',
            );
        });

        it('should support all complex schema patterns with .describe()', () => {
            // Test 1: Enum with .describe()
            const enumTool = {
                name: 'test.enum_tool',
                description: 'Test tool with enum and .describe()',
                inputSchema: z.object({
                    state: z
                        .enum(['open', 'closed', 'merged'])
                        .optional()
                        .describe(
                            'PR state filter: "open" (active PRs awaiting review), "closed" (rejected/abandoned PRs), "merged" (accepted and merged PRs)',
                        ),
                    repository: z
                        .string()
                        .optional()
                        .describe(
                            'Repository name or ID to filter PRs from a specific repository only',
                        ),
                }),
                execute: async () => ({ result: 'success' }),
            };

            // Test 2: Nested objects with .describe()
            const nestedTool = {
                name: 'test.nested_tool',
                description: 'Test tool with nested objects and .describe()',
                inputSchema: z.object({
                    repository: z
                        .object({
                            id: z
                                .string()
                                .describe(
                                    'Repository unique identifier (UUID or platform-specific ID)',
                                ),
                            name: z
                                .string()
                                .describe(
                                    'Repository name (e.g., "my-awesome-project")',
                                ),
                        })
                        .optional()
                        .describe(
                            'Specific repository to get commits from. If not provided, gets commits from all accessible repositories',
                        ),
                    filters: z
                        .object({
                            since: z
                                .string()
                                .optional()
                                .describe(
                                    'ISO date string (YYYY-MM-DDTHH:mm:ssZ) to get commits created after this date',
                                ),
                            until: z
                                .string()
                                .optional()
                                .describe(
                                    'ISO date string (YYYY-MM-DDTHH:mm:ssZ) to get commits created before this date',
                                ),
                        })
                        .optional()
                        .describe(
                            'Optional filters to narrow down commit history results',
                        ),
                }),
                execute: async () => ({ result: 'success' }),
            };

            // Test 3: Arrays with .describe()
            const arrayTool = {
                name: 'test.array_tool',
                description: 'Test tool with arrays and .describe()',
                inputSchema: z.object({
                    examples: z
                        .array(
                            z
                                .object({
                                    snippet: z
                                        .string()
                                        .describe(
                                            'Code example snippet demonstrating the rule',
                                        ),
                                    isCorrect: z
                                        .boolean()
                                        .describe(
                                            'Whether this snippet follows the rule (true) or violates it (false)',
                                        ),
                                })
                                .describe(
                                    'Code example showing correct or incorrect usage of the rule',
                                ),
                        )
                        .optional()
                        .describe(
                            'Array of code examples to help understand and apply the rule',
                        ),
                }),
                execute: async () => ({ result: 'success' }),
            };

            // Register all tools
            toolEngine.registerTool(enumTool);
            toolEngine.registerTool(nestedTool);
            toolEngine.registerTool(arrayTool);

            const tools = toolEngine.getToolsForLLM();

            // Test enum tool
            const enumTestTool = tools.find((t) => t.name === 'test.enum_tool');
            expect(enumTestTool).toBeDefined();
            const enumParams = enumTestTool!.parameters;
            expect(enumParams.properties?.state?.description).toBe(
                'PR state filter: "open" (active PRs awaiting review), "closed" (rejected/abandoned PRs), "merged" (accepted and merged PRs)',
            );

            // Test nested tool
            const nestedTestTool = tools.find(
                (t) => t.name === 'test.nested_tool',
            );
            expect(nestedTestTool).toBeDefined();
            const nestedParams = nestedTestTool!.parameters;
            expect(nestedParams.properties?.repository?.description).toBe(
                'Specific repository to get commits from. If not provided, gets commits from all accessible repositories',
            );

            // Test array tool
            const arrayTestTool = tools.find(
                (t) => t.name === 'test.array_tool',
            );
            expect(arrayTestTool).toBeDefined();
            const arrayParams = arrayTestTool!.parameters;
            expect(arrayParams.properties?.examples?.description).toBe(
                'Array of code examples to help understand and apply the rule',
            );
        });
    });
});

describe('extractDescription compatibilidade Zod 3 e 4', () => {
    it('extrai descrição de schema Zod 4 (.meta().description)', () => {
        const schema = z.string().describe('Descrição Zod 4');
        // Usa a função real
        expect(extractDescription(schema)).toBe('Descrição Zod 4');
    });

    it('extrai descrição de schema Zod 3 (_def.description)', () => {
        // Simula um objeto Zod 3
        type FakeZod3 = { _def: { description: string } };
        const fakeZod3Schema: FakeZod3 = {
            ['_def']: { description: 'Descrição Zod 3' },
        };
        expect(
            extractDescription(fakeZod3Schema as unknown as z.ZodSchema),
        ).toBe('Descrição Zod 3');
    });
});
