/**
 * @fileoverview Testes de Integração End-to-End para Arquitetura Limpa
 *
 * OBJETIVO: Validar que toda a nova arquitetura funciona integrada
 * - Fluxo completo: Orchestrator → Agent → Planner → Tools
 * - Think→Act→Observe em cenários reais
 * - Performance e responsividade
 * - Cenários complexos multi-step
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { createOrchestration } from '../../src/orchestration/sdk-orchestrator.js';
import { createMockLLMProvider } from '../../src/adapters/llm/index.js';
import { z } from 'zod';

describe('🚀 Clean Architecture Integration Tests', () => {
    let orchestrator: ReturnType<typeof createOrchestration>;

    beforeEach(() => {
        const mockProvider = createMockLLMProvider();

        orchestrator = createOrchestration({
            llmAdapter: mockProvider,
            defaultPlanner: 'react',
            defaultMaxIterations: 5,
            enableObservability: true,
            tenantId: 'integration-test',
        });
    });

    describe('📊 Scenario: Mathematical Problem Solving', () => {
        test('deve resolver problema matemático complexo', async () => {
            // Setup calculator tool
            orchestrator.createTool({
                name: 'calculator',
                description: 'Performs mathematical calculations',
                inputSchema: z.object({
                    expression: z
                        .string()
                        .describe(
                            'Mathematical expression like "2+3" or "sqrt(16)"',
                        ),
                }),
                execute: async (input) => {
                    try {
                        // Safe evaluation for common math operations
                        const typedInput = input as { expression: string };
                        const expr = typedInput.expression.replace(/\s/g, '');
                        const result = Function(
                            '"use strict"; return (' + expr + ')',
                        )();
                        return {
                            result,
                            expression: typedInput.expression,
                            success: true,
                        };
                    } catch {
                        const typedInput = input as { expression: string };
                        return {
                            error: `Invalid expression: ${typedInput.expression}`,
                            success: false,
                        };
                    }
                },
            });

            // Create math agent
            await orchestrator.createAgent({
                name: 'math-agent',
                identity: {
                    role: 'Mathematical Problem Solver',
                    goal: 'Solve complex mathematical problems step by step',
                    description:
                        'Expert agent for solving mathematical problems',
                },
                planner: 'react',
                maxIterations: 3,
                executionMode: 'simple',
            });

            // Execute complex math problem
            const result = await orchestrator.callAgent(
                'math-agent',
                'Calculate the result of (15 + 25) * 2 and then subtract 10. Show your work step by step.',
            );

            expect(result.success).toBe(true);
            expect(result.duration).toBeGreaterThan(0);
            expect(result.result).toBeDefined();

            // Should contain the correct answer (70)
            const resultStr = JSON.stringify(result.result);
            expect(resultStr).toMatch(/70|seventy/i);
        });

        test('deve lidar com múltiplas operações matemáticas', async () => {
            orchestrator.createTool({
                name: 'advanced-calc',
                description: 'Advanced calculator with multiple operations',
                inputSchema: z.object({
                    operation: z.enum(['add', 'multiply', 'power', 'sqrt']),
                    operands: z.array(z.number()),
                }),
                execute: async (input) => {
                    const typedInput = input as {
                        operation: string;
                        operands: number[];
                    };
                    const { operation, operands } = typedInput;

                    switch (operation) {
                        case 'add':
                            return {
                                result: operands.reduce((a, b) => a + b, 0),
                            };
                        case 'multiply':
                            return {
                                result: operands.reduce((a, b) => a * b, 1),
                            };
                        case 'power':
                            return {
                                result: Math.pow(operands[0], operands[1]),
                            };
                        case 'sqrt':
                            return { result: Math.sqrt(operands[0]) };
                        default:
                            return { error: 'Unknown operation' };
                    }
                },
            });

            await orchestrator.createAgent({
                name: 'advanced-math-agent',
                identity: {
                    role: 'Advanced Mathematical Operations Specialist',
                    goal: 'Perform complex mathematical operations with precision',
                    description: 'Agent for advanced mathematical operations',
                },
                planner: 'react',
            });

            const result = await orchestrator.callAgent(
                'advanced-math-agent',
                'First add 5 and 3, then multiply the result by 4, then calculate the square root of that result',
            );

            expect(result.success).toBe(true);
            // Expected: sqrt((5+3)*4) = sqrt(32) ≈ 5.66
            const resultStr = JSON.stringify(result.result);
            expect(resultStr).toMatch(/5\.6|5\.7|sqrt/i);
        });
    });

    describe('🌍 Scenario: Information Gathering & Processing', () => {
        test('deve buscar e processar informações de múltiplas fontes', async () => {
            // Mock weather tool
            orchestrator.createTool({
                name: 'weather',
                description: 'Gets weather information for a location',
                inputSchema: z.object({
                    location: z.string(),
                }),
                execute: async (input) => {
                    const typedInput = input as { location: string };
                    const weatherData = {
                        saoPaulo: {
                            temp: 22,
                            condition: 'Cloudy',
                            humidity: 65,
                        },
                        rioDeJaneiro: {
                            temp: 28,
                            condition: 'Sunny',
                            humidity: 70,
                        },
                        brasilia: {
                            temp: 25,
                            condition: 'Clear',
                            humidity: 45,
                        },
                    };

                    const data = weatherData[
                        typedInput.location as keyof typeof weatherData
                    ] || {
                        temp: 20,
                        condition: 'Unknown',
                        humidity: 50,
                    };

                    return {
                        location: typedInput.location,
                        temperature: data.temp,
                        condition: data.condition,
                        humidity: data.humidity,
                        timestamp: new Date().toISOString(),
                    };
                },
            });

            // Mock time tool
            orchestrator.createTool({
                name: 'time',
                description: 'Gets current time in specified timezone',
                inputSchema: z.object({
                    timezone: z.string().optional(),
                }),
                execute: async (input) => {
                    const typedInput = input as { timezone?: string };
                    return {
                        currentTime: new Date().toISOString(),
                        timezone: typedInput.timezone || 'UTC',
                        timestamp: Date.now(),
                    };
                },
            });

            await orchestrator.createAgent({
                name: 'info-agent',
                identity: {
                    role: 'Information Gathering Specialist',
                    goal: 'Collect and analyze information from multiple sources',
                    description: 'Information gathering and analysis agent',
                },
                planner: 'react',
                maxIterations: 4,
            });

            const result = await orchestrator.callAgent(
                'info-agent',
                'Get the weather in São Paulo and Rio de Janeiro, then tell me the current time. Compare the weather conditions between these cities.',
            );

            expect(result.success).toBe(true);

            const resultStr = JSON.stringify(result.result).toLowerCase();
            expect(resultStr).toMatch(/são paulo|rio/i);
            expect(resultStr).toMatch(/temperature|weather|condition/i);
            expect(resultStr).toMatch(/time|current/i);
        });
    });

    describe('🔄 Scenario: Multi-Step Workflow', () => {
        test('deve executar workflow complexo multi-step', async () => {
            // Text processor tool
            orchestrator.createTool({
                name: 'text-processor',
                description: 'Processes text in various ways',
                inputSchema: z.object({
                    text: z.string(),
                    operation: z.enum([
                        'uppercase',
                        'lowercase',
                        'count-words',
                        'reverse',
                    ]),
                }),
                execute: async (input) => {
                    const { text, operation } = input as {
                        text: string;
                        operation: string;
                    };

                    switch (operation) {
                        case 'uppercase':
                            return {
                                result: text.toUpperCase(),
                                original: text,
                            };
                        case 'lowercase':
                            return {
                                result: text.toLowerCase(),
                                original: text,
                            };
                        case 'count-words':
                            return {
                                result: text.split(/\s+/).length,
                                original: text,
                            };
                        case 'reverse':
                            return {
                                result: text.split('').reverse().join(''),
                                original: text,
                            };
                        default:
                            return { error: 'Unknown operation' };
                    }
                },
            });

            // Data storage tool
            orchestrator.createTool({
                name: 'data-store',
                description: 'Stores and retrieves data',
                inputSchema: z.object({
                    action: z.enum(['store', 'retrieve']),
                    key: z.string(),
                    value: z.string().optional(),
                }),
                execute: async (input) => {
                    const typedInput = input as {
                        action: string;
                        key: string;
                        value?: string;
                    };
                    // Simple in-memory storage for testing
                    const storage = new Map();

                    if (typedInput.action === 'store') {
                        storage.set(typedInput.key, typedInput.value);
                        return {
                            success: true,
                            stored: typedInput.value,
                            key: typedInput.key,
                        };
                    } else {
                        const value =
                            storage.get(typedInput.key) || 'Not found';
                        return {
                            success: true,
                            retrieved: value,
                            key: typedInput.key,
                        };
                    }
                },
            });

            await orchestrator.createAgent({
                name: 'workflow-agent',
                identity: {
                    role: 'Workflow Execution Specialist',
                    goal: 'Execute complex multi-step workflows efficiently',
                    description:
                        'Agent specialized in executing complex workflows',
                },
                planner: 'react',
                maxIterations: 6,
            });

            const result = await orchestrator.callAgent(
                'workflow-agent',
                'Take the text "Hello Clean Architecture", convert it to uppercase, count the words, store the count with key "word-count", then retrieve it back and confirm the workflow completed successfully.',
            );

            expect(result.success).toBe(true);

            const resultStr = JSON.stringify(result.result).toLowerCase();
            expect(resultStr).toMatch(/hello|clean|architecture/i);
            expect(resultStr).toMatch(/uppercase|count|store|retrieve/i);
            expect(resultStr).toMatch(/3|three/i); // Should find 3 words
        });
    });

    describe('🎯 Scenario: Error Recovery & Resilience', () => {
        test('deve se recuperar de erros de ferramentas', async () => {
            // Flaky tool that sometimes fails
            let callCount = 0;
            orchestrator.createTool({
                name: 'flaky-tool',
                description:
                    'A tool that sometimes fails for testing resilience',
                inputSchema: z.object({
                    input: z.string(),
                }),
                execute: async (input) => {
                    const typedInput = input as { input: string };
                    callCount++;

                    // Fail on first call, succeed on subsequent calls
                    if (callCount === 1) {
                        throw new Error('Temporary failure');
                    }

                    return {
                        result: `Processed: ${typedInput.input}`,
                        attempts: callCount,
                        success: true,
                    };
                },
            });

            // Backup tool
            orchestrator.createTool({
                name: 'backup-tool',
                description: 'Backup tool when primary fails',
                inputSchema: z.object({
                    input: z.string(),
                }),
                execute: async (input) => {
                    const typedInput = input as { input: string };
                    return {
                        result: `Backup processed: ${typedInput.input}`,
                        source: 'backup',
                    };
                },
            });

            await orchestrator.createAgent({
                name: 'resilient-agent',
                identity: {
                    role: 'Resilient Problem Solver',
                    goal: 'Recover from tool failures and continue execution',
                    description: 'Agent that can recover from tool failures',
                },
                planner: 'react',
                maxIterations: 4,
            });

            const result = await orchestrator.callAgent(
                'resilient-agent',
                'Process the text "resilience test" using the flaky-tool. If it fails, try the backup-tool instead.',
            );

            expect(result.success).toBe(true);

            const resultStr = JSON.stringify(result.result).toLowerCase();
            expect(resultStr).toMatch(/resilience test|processed/i);
            // Should use either the flaky tool (after retry) or backup tool
        });
    });

    describe('⚡ Performance & Efficiency', () => {
        test('deve completar tarefas simples rapidamente', async () => {
            orchestrator.createTool({
                name: 'quick-response',
                description: 'Returns immediate response',
                inputSchema: z.object({
                    message: z.string(),
                }),
                execute: async (input) => {
                    const typedInput = input as { message: string };
                    return { echo: typedInput.message, timestamp: Date.now() };
                },
            });

            await orchestrator.createAgent({
                name: 'quick-agent',
                identity: {
                    role: 'Quick Response Specialist',
                    goal: 'Provide fast and efficient responses',
                    description: 'Agent optimized for quick responses',
                },
                planner: 'react',
                maxIterations: 2,
            });

            const startTime = Date.now();

            const result = await orchestrator.callAgent(
                'quick-agent',
                'Echo back "Quick response test"',
            );

            const duration = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
            expect(result.duration).toBeGreaterThan(0);
        });

        test('deve otimizar para tarefas que não precisam de tools', async () => {
            await orchestrator.createAgent({
                name: 'direct-agent',
                identity: {
                    role: 'Direct Response Specialist',
                    goal: 'Provide direct responses without using tools',
                    description: 'Agent for direct responses without tools',
                },
                planner: 'react',
                maxIterations: 2,
            });

            const result = await orchestrator.callAgent(
                'direct-agent',
                'Just say hello and explain that you are working correctly',
            );

            expect(result.success).toBe(true);

            const resultStr = JSON.stringify(result.result).toLowerCase();
            expect(resultStr).toMatch(/hello|working|correctly/i);
        });
    });

    describe('🏗️ Architecture Validation Integration', () => {
        test('deve manter separação limpa durante execução complexa', async () => {
            // Complex scenario that would previously trigger God Object behavior
            orchestrator.createTool({
                name: 'validator',
                description: 'Validates system state',
                inputSchema: z.object({
                    check: z.string(),
                }),
                execute: async (input) => {
                    const typedInput = input as { check: string };
                    return {
                        validation: `Checked: ${typedInput.check}`,
                        status: 'valid',
                        architecture: 'clean',
                    };
                },
            });

            await orchestrator.createAgent({
                name: 'validation-agent',
                description: 'Agent for validating clean architecture',
                planner: 'react',
                maxIterations: 3,
            });

            const result = await orchestrator.callAgent(
                'validation-agent',
                'Validate that the system architecture is clean and working correctly. Check separation of concerns.',
            );

            expect(result.success).toBe(true);

            // Verify orchestrator stats remain consistent
            const stats = orchestrator.getStats();
            expect(stats.totalAgents).toBeGreaterThan(0);
            expect(stats.availableTools).toBeGreaterThan(0);
            expect(stats.llmProvider).toBe('gemini');
            expect(stats.defaultPlanner).toBe('react');
        });

        test('deve escalar múltiplos agents simultaneamente', async () => {
            // Create multiple agents
            await orchestrator.createAgent({
                name: 'agent-1',
                description: 'First concurrent agent',
                planner: 'react',
            });

            await orchestrator.createAgent({
                name: 'agent-2',
                description: 'Second concurrent agent',
                planner: 'react',
            });

            await orchestrator.createAgent({
                name: 'agent-3',
                description: 'Third concurrent agent',
                planner: 'react',
            });

            // Execute multiple agents (could be done in parallel in real scenarios)
            const results = await Promise.all([
                orchestrator.callAgent('agent-1', 'Task for agent 1'),
                orchestrator.callAgent('agent-2', 'Task for agent 2'),
                orchestrator.callAgent('agent-3', 'Task for agent 3'),
            ]);

            results.forEach((result, index) => {
                expect(result.success).toBe(true);
                expect(result.context.agentName).toBe(`agent-${index + 1}`);
            });

            // Verify system maintains stability
            const stats = orchestrator.getStats();
            expect(stats.totalAgents).toBe(3);
        });
    });
});
