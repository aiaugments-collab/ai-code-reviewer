import { describe, it, expect, beforeEach } from 'vitest';
import { createOrchestration } from '../../src/orchestration/sdk-orchestrator.js';
import { createMockLLMProvider } from '../../src/adapters/llm/index.js';
import { z } from 'zod';

describe('Integration: Parallel Tools Flow End-to-End', () => {
    let orchestrator: ReturnType<typeof createOrchestration>;

    beforeEach(async () => {
        const mockProvider = createMockLLMProvider();

        orchestrator = createOrchestration({
            llmAdapter: mockProvider,
        });

        // Register test tools for parallel execution
        orchestrator.createTool({
            name: 'search_web',
            description: 'Search the web for information',
            inputSchema: z.object({ query: z.string() }),
            execute: async (input: { query: string }) => {
                // Simulate web search with random delay
                await new Promise((resolve) =>
                    setTimeout(resolve, Math.random() * 500 + 100),
                );
                return {
                    source: 'web',
                    results: [`Web result for: ${input.query}`],
                    timestamp: Date.now(),
                };
            },
        });

        orchestrator.createTool({
            name: 'search_docs',
            description: 'Search internal documentation',
            inputSchema: z.object({ query: z.string() }),
            execute: async (input: { query: string }) => {
                // Simulate doc search with random delay
                await new Promise((resolve) =>
                    setTimeout(resolve, Math.random() * 400 + 150),
                );
                return {
                    source: 'docs',
                    results: [`Documentation result for: ${input.query}`],
                    timestamp: Date.now(),
                };
            },
        });

        orchestrator.createTool({
            name: 'search_code',
            description: 'Search code repositories',
            inputSchema: z.object({ query: z.string() }),
            execute: async (input: { query: string }) => {
                // Simulate code search with random delay
                await new Promise((resolve) =>
                    setTimeout(resolve, Math.random() * 600 + 200),
                );
                return {
                    source: 'code',
                    results: [`Code result for: ${input.query}`],
                    timestamp: Date.now(),
                };
            },
        });

        orchestrator.createTool({
            name: 'analyze_data',
            description: 'Analyze collected data',
            inputSchema: z.object({ data: z.array(z.unknown()) }),
            execute: async (input: { data: unknown[] }) => {
                // Simulate data analysis
                await new Promise((resolve) => setTimeout(resolve, 200));
                return {
                    analysis: `Analyzed ${input.data.length} data sources`,
                    summary: 'Data analysis completed',
                    confidence: 0.95,
                };
            },
        });

        orchestrator.createTool({
            name: 'validate_results',
            description: 'Validate search results',
            inputSchema: z.object({ results: z.array(z.unknown()) }),
            execute: async (input: { results: unknown[] }) => {
                // Simulate validation
                await new Promise((resolve) => setTimeout(resolve, 150));
                return {
                    validation: `Validated ${input.results.length} results`,
                    valid: true,
                    score: 0.9,
                };
            },
        });
    });

    describe('Parallel Tool Execution', () => {
        it('should execute multiple search tools in parallel successfully', async () => {
            // Create agent that uses parallel tools
            await orchestrator.createAgent({
                name: 'parallel-searcher',
                description: 'Agent that searches multiple sources in parallel',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    if (
                        input.toLowerCase().includes('pesquisar') ||
                        input.toLowerCase().includes('search')
                    ) {
                        return {
                            reasoning:
                                'I will search multiple sources in parallel for comprehensive results',
                            action: {
                                type: 'parallel_tools',
                                content: {
                                    tools: [
                                        {
                                            name: 'search_web',
                                            input: { query: input },
                                        },
                                        {
                                            name: 'search_docs',
                                            input: { query: input },
                                        },
                                        {
                                            name: 'search_code',
                                            input: { query: input },
                                        },
                                    ],
                                    config: {
                                        maxConcurrency: 3,
                                        failFast: false,
                                        aggregateResults: true,
                                    },
                                },
                            },
                        };
                    }

                    return {
                        reasoning: 'Simple query without search needed',
                        action: {
                            type: 'final_answer',
                            content: `Processed: ${input}`,
                        },
                    };
                },
            });

            const startTime = Date.now();
            const result = await orchestrator.callAgent(
                'parallel-searcher',
                'pesquisar informações sobre IA',
            );
            const duration = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(result.result).toBeDefined();
            expect(result.metadata).toBeDefined();
            expect(result.metadata?.toolsUsed).toBeGreaterThan(0);

            // Parallel execution should be faster than sequential
            // (3 tools with ~300ms each would be ~900ms sequential, parallel should be much less)
            expect(duration).toBeLessThan(1000);
        });

        it('should handle sequential tools with dependencies', async () => {
            // Create agent that uses sequential tools with dependencies
            await orchestrator.createAgent({
                name: 'sequential-processor',
                description: 'Agent that processes data sequentially',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    if (
                        input.toLowerCase().includes('processar') ||
                        input.toLowerCase().includes('process')
                    ) {
                        return {
                            reasoning:
                                'I will process data step by step, passing results between tools',
                            action: {
                                type: 'sequential_tools',
                                content: {
                                    tools: [
                                        {
                                            name: 'search_web',
                                            input: { query: input },
                                            dependsOn: undefined,
                                        },
                                        {
                                            name: 'analyze_data',
                                            input: null, // Will receive data from previous tool
                                            dependsOn: 'search_web',
                                            passPreviousResult: true,
                                        },
                                        {
                                            name: 'validate_results',
                                            input: null, // Will receive data from previous tool
                                            dependsOn: 'analyze_data',
                                            passPreviousResult: true,
                                        },
                                    ],
                                    config: {
                                        stopOnError: true,
                                        passResults: true,
                                    },
                                },
                            },
                        };
                    }

                    return {
                        reasoning: 'Simple query without processing needed',
                        action: {
                            type: 'final_answer',
                            content: `Processed: ${input}`,
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'sequential-processor',
                'processar dados complexos',
            );

            expect(result.success).toBe(true);
            expect(result.result).toBeDefined();
            expect(result.metadata?.toolsUsed).toBeGreaterThan(0);
        });

        it('should handle conditional tools based on context', async () => {
            // Create agent that uses conditional tools
            await orchestrator.createAgent({
                name: 'conditional-agent',
                description: 'Agent that conditionally executes tools',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    if (
                        input.toLowerCase().includes('conditional') ||
                        input.toLowerCase().includes('se')
                    ) {
                        return {
                            reasoning:
                                'I will execute tools conditionally based on the input',
                            action: {
                                type: 'conditional_tools',
                                content: {
                                    conditions: [
                                        {
                                            condition: 'input.includes("web")',
                                            tools: [
                                                {
                                                    name: 'search_web',
                                                    input: { query: input },
                                                },
                                            ],
                                        },
                                        {
                                            condition: 'input.includes("docs")',
                                            tools: [
                                                {
                                                    name: 'search_docs',
                                                    input: { query: input },
                                                },
                                            ],
                                        },
                                    ],
                                    fallback: [
                                        {
                                            name: 'search_web',
                                            input: { query: input },
                                        },
                                    ],
                                },
                            },
                        };
                    }

                    return {
                        reasoning: 'Simple query without conditions needed',
                        action: {
                            type: 'final_answer',
                            content: `Processed: ${input}`,
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'conditional-agent',
                'conditional search with web',
            );

            expect(result.success).toBe(true);
            expect(result.result).toBeDefined();
        });
    });

    describe('Tool Execution Configuration', () => {
        it('should respect maxConcurrency limits', async () => {
            await orchestrator.createAgent({
                name: 'concurrency-limited-agent',
                description: 'Agent with limited concurrency',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning:
                            'I will execute tools with limited concurrency',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'search_web',
                                        input: { query: input + ' 1' },
                                    },
                                    {
                                        name: 'search_docs',
                                        input: { query: input + ' 2' },
                                    },
                                    {
                                        name: 'search_code',
                                        input: { query: input + ' 3' },
                                    },
                                    {
                                        name: 'search_web',
                                        input: { query: input + ' 4' },
                                    },
                                    {
                                        name: 'search_docs',
                                        input: { query: input + ' 5' },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 2, // Limited to 2 concurrent executions
                                    failFast: false,
                                    aggregateResults: true,
                                },
                            },
                        },
                    };
                },
            });

            const startTime = Date.now();
            const result = await orchestrator.callAgent(
                'concurrency-limited-agent',
                'search multiple',
            );
            const duration = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(result.metadata?.toolsUsed).toBe(5);

            // With concurrency limit of 2, it should take longer than unlimited parallel
            // but less than fully sequential
            expect(duration).toBeGreaterThan(300); // Should take some time due to batching
        });

        it('should handle failFast configuration correctly', async () => {
            // Create a tool that will fail
            orchestrator.createTool({
                name: 'failing_tool',
                description: 'Tool that always fails',
                inputSchema: z.object({ query: z.string() }),
                execute: async (_input: { query: string }) => {
                    throw new Error('Simulated tool failure');
                },
            });

            await orchestrator.createAgent({
                name: 'fail-fast-agent',
                description: 'Agent with fail-fast enabled',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'I will test fail-fast behavior',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'search_web',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'failing_tool',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'search_docs',
                                        input: { query: input },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 3,
                                    failFast: true, // Should stop on first failure
                                    aggregateResults: false,
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'fail-fast-agent',
                'test failure',
            );

            // The agent should still complete but might have partial results
            expect(result).toBeDefined();
            // Some tools might have succeeded before the failure
        });

        it('should aggregate results when configured', async () => {
            await orchestrator.createAgent({
                name: 'aggregator-agent',
                description: 'Agent that aggregates results',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning:
                            'I will aggregate results from multiple tools',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'search_web',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'search_docs',
                                        input: { query: input },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 2,
                                    failFast: false,
                                    aggregateResults: true,
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'aggregator-agent',
                'aggregate search',
            );

            expect(result.success).toBe(true);
            expect(result.result).toBeDefined();
            expect(result.metadata?.toolsUsed).toBe(2);
        });
    });

    describe('Error Handling and Resilience', () => {
        it('should gracefully handle tool failures without stopping execution', async () => {
            // Create a tool that fails intermittently
            orchestrator.createTool({
                name: 'unreliable_tool',
                description: 'Tool that fails sometimes',
                inputSchema: z.object({ query: z.string() }),
                execute: async (input: { query: string }) => {
                    if (Math.random() < 0.5) {
                        throw new Error('Random failure');
                    }
                    return { result: 'Success', query: input.query };
                },
            });

            await orchestrator.createAgent({
                name: 'resilient-agent',
                description: 'Agent that handles failures gracefully',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'I will handle tool failures gracefully',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'search_web',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'unreliable_tool',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'search_docs',
                                        input: { query: input },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 3,
                                    failFast: false, // Continue despite failures
                                    aggregateResults: true,
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'resilient-agent',
                'test resilience',
            );

            // Should complete even if some tools fail
            expect(result).toBeDefined();
            // At least the reliable tools should have executed
            expect(result.metadata?.toolsUsed).toBeGreaterThanOrEqual(2);
        });

        it('should handle timeout scenarios appropriately', async () => {
            // Create a slow tool
            orchestrator.createTool({
                name: 'slow_tool',
                description: 'Tool that takes a long time',
                inputSchema: z.object({ query: z.string() }),
                execute: async (input: { query: string }) => {
                    await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay
                    return { result: 'Slow result', query: input.query };
                },
            });

            await orchestrator.createAgent({
                name: 'timeout-aware-agent',
                description: 'Agent aware of timeouts',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'I will test timeout handling',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'search_web',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'slow_tool',
                                        input: { query: input },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 2,
                                    failFast: false,
                                    timeout: 1000, // 1 second timeout
                                },
                            },
                        },
                    };
                },
            });

            const startTime = Date.now();
            const result = await orchestrator.callAgent(
                'timeout-aware-agent',
                'test timeout',
            );
            const duration = Date.now() - startTime;

            expect(result).toBeDefined();
            // Should not wait for the full 2 seconds
            expect(duration).toBeLessThan(1500);
        });
    });

    describe('Performance and Metrics', () => {
        it('should provide execution metrics and timing information', async () => {
            await orchestrator.createAgent({
                name: 'metrics-agent',
                description: 'Agent that provides metrics',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'I will provide execution metrics',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'search_web',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'search_docs',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'search_code',
                                        input: { query: input },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 3,
                                    failFast: false,
                                    aggregateResults: true,
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'metrics-agent',
                'metrics test',
            );

            expect(result.success).toBe(true);
            expect(result.metadata).toBeDefined();
            expect(result.metadata?.toolsUsed).toBe(3);
            expect(result.metadata?.duration).toBeGreaterThan(0);
            expect(result.metadata?.executionId).toBeDefined();
        });

        it('should demonstrate performance improvement with parallel execution', async () => {
            // Sequential execution agent
            await orchestrator.createAgent({
                name: 'sequential-agent',
                description: 'Agent that executes tools sequentially',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'I will execute tools one by one',
                        action: {
                            type: 'sequential_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'search_web',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'search_docs',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'search_code',
                                        input: { query: input },
                                    },
                                ],
                                config: {
                                    stopOnError: false,
                                    passResults: false,
                                },
                            },
                        },
                    };
                },
            });

            // Parallel execution agent
            await orchestrator.createAgent({
                name: 'parallel-agent',
                description: 'Agent that executes tools in parallel',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'I will execute tools in parallel',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'search_web',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'search_docs',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'search_code',
                                        input: { query: input },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 3,
                                    failFast: false,
                                    aggregateResults: true,
                                },
                            },
                        },
                    };
                },
            });

            // Execute both and compare timing
            const startSequential = Date.now();
            const sequentialResult = await orchestrator.callAgent(
                'sequential-agent',
                'performance test',
            );
            const sequentialDuration = Date.now() - startSequential;

            const startParallel = Date.now();
            const parallelResult = await orchestrator.callAgent(
                'parallel-agent',
                'performance test',
            );
            const parallelDuration = Date.now() - startParallel;

            expect(sequentialResult.success).toBe(true);
            expect(parallelResult.success).toBe(true);
            expect(sequentialResult.metadata?.toolsUsed).toBe(3);
            expect(parallelResult.metadata?.toolsUsed).toBe(3);

            // Parallel should be significantly faster
            expect(parallelDuration).toBeLessThan(sequentialDuration * 0.8);
        });
    });
});
