import { describe, it, expect, beforeEach } from 'vitest';
import { createOrchestration } from '../../src/orchestration/sdk-orchestrator.js';
import { createMockLLMProvider } from '../../src/adapters/llm/index.js';
import { createThreadId } from '../../src/utils/thread-helpers.js';
import { z } from 'zod';

describe('Integration: Error Scenarios and Resilience', () => {
    let orchestrator: ReturnType<typeof createOrchestration>;

    beforeEach(async () => {
        const mockProvider = createMockLLMProvider();

        orchestrator = createOrchestration({
            llmAdapter: mockProvider,
        });
    });

    describe('Tool Execution Failures', () => {
        beforeEach(async () => {
            // Tool que sempre falha
            orchestrator.createTool({
                name: 'failing_tool',
                description: 'Tool that always fails',
                inputSchema: z.object({ query: z.string() }),
                execute: async (input: { query: string }) => {
                    throw new Error(`Tool execution failed: ${input.query}`);
                },
            });

            // Tool que falha intermitentemente
            let callCount = 0;
            orchestrator.createTool({
                name: 'unreliable_tool',
                description: 'Tool that fails randomly',
                inputSchema: z.object({ query: z.string() }),
                execute: async (input: { query: string }) => {
                    callCount++;
                    if (callCount % 2 === 0) {
                        throw new Error('Random failure occurred');
                    }
                    return {
                        result: `Success on attempt ${callCount}`,
                        query: input.query,
                    };
                },
            });

            // Tool que funciona (para controle)
            orchestrator.createTool({
                name: 'working_tool',
                description: 'Tool that always works',
                inputSchema: z.object({ query: z.string() }),
                execute: async (input: { query: string }) => {
                    return { result: 'Success', query: input.query };
                },
            });
        });

        it('should handle single tool failure gracefully', async () => {
            await orchestrator.createAgent({
                name: 'error-resilient-agent',
                description: 'Agent that handles tool failures',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing single tool failure handling',
                        action: {
                            type: 'tool_call',
                            content: {
                                toolName: 'failing_tool',
                                input: { query: input },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'error-resilient-agent',
                'test failure handling',
            );

            // Agent should receive error but not crash
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error?.message).toContain('Tool execution failed');
        });

        it('should handle parallel tool failures with failFast=false', async () => {
            await orchestrator.createAgent({
                name: 'parallel-error-agent',
                description: 'Agent with parallel tool execution',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing parallel execution with failures',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'working_tool',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'failing_tool',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'unreliable_tool',
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
                'parallel-error-agent',
                'test parallel failures',
            );

            expect(result).toBeDefined();
            // Should complete with partial results
            expect(result.metadata).toBeDefined();
            expect(result.metadata?.toolsUsed).toBeGreaterThan(0);
        });

        it('should handle parallel tool failures with failFast=true', async () => {
            await orchestrator.createAgent({
                name: 'fail-fast-agent',
                description: 'Agent with fail-fast enabled',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing fail-fast behavior',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'failing_tool',
                                        input: { query: input },
                                    },
                                    {
                                        name: 'working_tool',
                                        input: { query: input },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 2,
                                    failFast: true, // Stop on first failure
                                    aggregateResults: false,
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'fail-fast-agent',
                'test fail-fast',
            );

            expect(result).toBeDefined();
            // Should fail quickly due to failFast
            expect(result.success).toBe(false);
        });

        it('should handle sequential tool failures', async () => {
            await orchestrator.createAgent({
                name: 'sequential-error-agent',
                description: 'Agent with sequential tool execution',
                think: async (
                    _input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing sequential execution with failures',
                        action: {
                            type: 'sequential_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'working_tool',
                                        input: { query: 'step 1' },
                                    },
                                    {
                                        name: 'failing_tool',
                                        input: { query: 'step 2' },
                                        dependsOn: 'working_tool',
                                    },
                                    {
                                        name: 'working_tool',
                                        input: { query: 'step 3' },
                                        dependsOn: 'failing_tool',
                                    },
                                ],
                                config: {
                                    stopOnError: true,
                                    passResults: true,
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'sequential-error-agent',
                'test sequential failures',
            );

            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            // Should stop at the failing tool
            expect(result.metadata?.toolsUsed).toBe(1); // Only first tool should execute
        });
    });

    describe('Timeout Scenarios', () => {
        beforeEach(async () => {
            // Tool que demora muito
            orchestrator.createTool({
                name: 'slow_tool',
                description: 'Tool that takes a long time',
                inputSchema: z.object({ delay: z.number() }),
                execute: async (input: { delay: number }) => {
                    await new Promise((resolve) =>
                        setTimeout(resolve, input.delay),
                    );
                    return {
                        result: 'Completed after delay',
                        delay: input.delay,
                    };
                },
            });

            // Tool rápida
            orchestrator.createTool({
                name: 'fast_tool',
                description: 'Tool that completes quickly',
                inputSchema: z.object({ message: z.string() }),
                execute: async (input: { message: string }) => {
                    return {
                        result: 'Fast completion',
                        message: input.message,
                    };
                },
            });
        });

        it('should handle single tool timeout', async () => {
            await orchestrator.createAgent({
                name: 'timeout-agent',
                description: 'Agent that tests timeouts',
                think: async (
                    _input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing single tool timeout',
                        action: {
                            type: 'tool_call',
                            content: {
                                toolName: 'slow_tool',
                                input: { delay: 3000 }, // 3 seconds delay
                            },
                        },
                    };
                },
            });

            const startTime = Date.now();
            const result = await orchestrator.callAgent(
                'timeout-agent',
                'test timeout',
                { timeout: 1000, thread: createThreadId({ test: 'timeout' }) }, // 1 second timeout
            );
            const duration = Date.now() - startTime;

            expect(result).toBeDefined();
            expect(duration).toBeLessThan(1500); // Should timeout before 3 seconds
        });

        it('should handle parallel tools with mixed timing', async () => {
            await orchestrator.createAgent({
                name: 'mixed-timing-agent',
                description: 'Agent with mixed tool timing',
                think: async (
                    _input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing mixed timing with timeout',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'fast_tool',
                                        input: { message: 'quick' },
                                    },
                                    {
                                        name: 'slow_tool',
                                        input: { delay: 2000 }, // 2 seconds
                                    },
                                    {
                                        name: 'fast_tool',
                                        input: { message: 'another quick' },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 3,
                                    failFast: false,
                                    timeout: 1000, // 1 second timeout
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'mixed-timing-agent',
                'test mixed timing',
            );

            expect(result).toBeDefined();
            // Fast tools should complete, slow tool should timeout
            expect(result.metadata).toBeDefined();
        });

        it('should handle sequential tools with timeout in middle', async () => {
            await orchestrator.createAgent({
                name: 'sequential-timeout-agent',
                description: 'Agent with sequential timeout',
                think: async (
                    _input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing sequential with timeout',
                        action: {
                            type: 'sequential_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'fast_tool',
                                        input: { message: 'step 1' },
                                    },
                                    {
                                        name: 'slow_tool',
                                        input: { delay: 2000 },
                                        dependsOn: 'fast_tool',
                                    },
                                    {
                                        name: 'fast_tool',
                                        input: { message: 'step 3' },
                                        dependsOn: 'slow_tool',
                                    },
                                ],
                                config: {
                                    stopOnError: true,
                                    timeout: 1000, // 1 second timeout
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'sequential-timeout-agent',
                'test sequential timeout',
            );

            expect(result).toBeDefined();
            // Should stop after timeout in second tool
            expect(result.metadata?.toolsUsed).toBe(1);
        });
    });

    describe('Partial Failures and Recovery', () => {
        beforeEach(async () => {
            // Tool de retry
            let retryCount = 0;
            orchestrator.createTool({
                name: 'retry_tool',
                description: 'Tool that succeeds after retries',
                inputSchema: z.object({ maxRetries: z.number() }),
                execute: async (input: { maxRetries: number }) => {
                    retryCount++;
                    if (retryCount <= input.maxRetries) {
                        throw new Error(`Retry ${retryCount} failed`);
                    }
                    const result = {
                        result: 'Success after retries',
                        attempts: retryCount,
                    };
                    retryCount = 0; // Reset for next test
                    return result;
                },
            });

            // Tool de backup
            orchestrator.createTool({
                name: 'backup_tool',
                description: 'Backup tool when primary fails',
                inputSchema: z.object({
                    originalInput: z.unknown(),
                }),
                execute: async (input: { originalInput?: unknown }) => {
                    return {
                        result: 'Backup solution',
                        originalInput: input.originalInput,
                        source: 'backup',
                    };
                },
            });
        });

        it('should handle partial success in parallel execution', async () => {
            await orchestrator.createAgent({
                name: 'partial-success-agent',
                description: 'Agent handling partial success',
                think: async (
                    _input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing partial success handling',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'fast_tool',
                                        input: { message: 'success 1' },
                                    },
                                    {
                                        name: 'retry_tool',
                                        input: { maxRetries: 5 }, // Will fail
                                    },
                                    {
                                        name: 'fast_tool',
                                        input: { message: 'success 2' },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 3,
                                    failFast: false,
                                    aggregateResults: true,
                                    allowPartialSuccess: true,
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'partial-success-agent',
                'test partial success',
            );

            expect(result).toBeDefined();
            // Should have some successful results
            expect(result.metadata?.toolsUsed).toBeGreaterThan(0);
        });

        it('should implement fallback strategy on tool failure', async () => {
            await orchestrator.createAgent({
                name: 'fallback-agent',
                description: 'Agent with fallback strategy',
                think: async (
                    input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing fallback strategy',
                        action: {
                            type: 'conditional_tools',
                            content: {
                                conditions: [
                                    {
                                        condition: 'primary_available',
                                        tools: [
                                            {
                                                name: 'retry_tool',
                                                input: { maxRetries: 5 }, // Will fail
                                            },
                                        ],
                                    },
                                ],
                                fallback: [
                                    {
                                        name: 'backup_tool',
                                        input: { originalInput: input },
                                    },
                                ],
                                config: {
                                    enableFallback: true,
                                    fallbackOnError: true,
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'fallback-agent',
                'test fallback',
            );

            expect(result).toBeDefined();
            // Should complete using fallback
            expect(result.metadata?.toolsUsed).toBeGreaterThan(0);
        });

        it('should handle cascading failures gracefully', async () => {
            // Tool que falha e causa efeito em cascata
            orchestrator.createTool({
                name: 'cascade_failure_tool',
                description: 'Tool that causes cascade failure',
                inputSchema: z.object({ triggerCascade: z.boolean() }),
                execute: async (input: { triggerCascade: boolean }) => {
                    if (input.triggerCascade) {
                        throw new Error('Cascade failure triggered');
                    }
                    return { result: 'No cascade' };
                },
            });

            await orchestrator.createAgent({
                name: 'cascade-agent',
                description: 'Agent handling cascade failures',
                think: async (
                    _input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing cascade failure handling',
                        action: {
                            type: 'sequential_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'cascade_failure_tool',
                                        input: { triggerCascade: true },
                                    },
                                    {
                                        name: 'fast_tool',
                                        input: { message: 'dependent step' },
                                        dependsOn: 'cascade_failure_tool',
                                    },
                                    {
                                        name: 'backup_tool',
                                        input: { originalInput: 'recovery' },
                                        dependsOn: 'fast_tool',
                                    },
                                ],
                                config: {
                                    stopOnError: false, // Continue despite errors
                                    allowPartialSuccess: true,
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'cascade-agent',
                'test cascade',
            );

            expect(result).toBeDefined();
            // Should handle cascade gracefully
            expect(result.metadata).toBeDefined();
        });
    });

    describe('Agent Decision Making Under Errors', () => {
        it('should make fallback decisions when tools unavailable', async () => {
            await orchestrator.createAgent({
                name: 'decision-agent',
                description: 'Agent that makes decisions under constraints',
                think: async (
                    input: string,
                    context: Record<string, unknown>,
                ) => {
                    const availableTools =
                        (context.availableTools as Array<{ name: string }>) ||
                        [];

                    // Check if preferred tool is available
                    const hasPreferredTool = availableTools.some(
                        (tool: { name: string }) =>
                            tool.name === 'preferred_tool',
                    );

                    if (hasPreferredTool) {
                        return {
                            reasoning: 'Using preferred tool',
                            action: {
                                type: 'tool_call',
                                content: {
                                    toolName: 'preferred_tool',
                                    input: { query: input },
                                },
                            },
                        };
                    } else {
                        // Fallback to basic response
                        return {
                            reasoning:
                                'Preferred tool unavailable, providing direct response',
                            action: {
                                type: 'final_answer',
                                content: `I can help with "${input}" but my preferred tools are currently unavailable. Here's what I can tell you based on my knowledge...`,
                            },
                        };
                    }
                },
            });

            const result = await orchestrator.callAgent(
                'decision-agent',
                'help me with something',
            );

            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            // Should provide fallback response
            expect(result.result).toContain('unavailable');
        });

        it('should adapt strategy based on previous failures', async () => {
            await orchestrator.createAgent({
                name: 'adaptive-agent',
                description: 'Agent that adapts to failures',
                think: async (
                    input: string,
                    context: Record<string, unknown>,
                ) => {
                    const sessionHistory =
                        (context.sessionHistory as Array<{ type: string }>) ||
                        [];
                    const recentFailures = sessionHistory.filter(
                        (event: { type: string }) =>
                            event.type === 'tool_failure',
                    ).length;

                    if (recentFailures > 2) {
                        return {
                            reasoning:
                                'Too many recent failures, switching to conservative mode',
                            action: {
                                type: 'final_answer',
                                content:
                                    "I'm experiencing some technical difficulties. Let me provide a direct response instead.",
                            },
                        };
                    } else {
                        return {
                            reasoning: 'Attempting tool usage despite risks',
                            action: {
                                type: 'tool_call',
                                content: {
                                    toolName: 'retry_tool',
                                    input: { maxRetries: 1 }, // Will likely fail
                                },
                            },
                        };
                    }
                },
            });

            // First few calls should try tools
            const result1 = await orchestrator.callAgent(
                'adaptive-agent',
                'first attempt',
            );
            expect(result1).toBeDefined();

            const result2 = await orchestrator.callAgent(
                'adaptive-agent',
                'second attempt',
            );
            expect(result2).toBeDefined();
        });
    });

    describe('Resource Exhaustion and Limits', () => {
        it('should handle tool concurrency limits gracefully', async () => {
            await orchestrator.createAgent({
                name: 'concurrency-test-agent',
                description: 'Agent testing concurrency limits',
                think: async (
                    _input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing concurrency limits',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: Array.from({ length: 10 }, (_, i) => ({
                                    name: 'fast_tool',
                                    input: { message: `concurrent-${i}` },
                                })),
                                config: {
                                    maxConcurrency: 2, // Very limited
                                    failFast: false,
                                    timeout: 5000,
                                },
                            },
                        },
                    };
                },
            });

            const startTime = Date.now();
            const result = await orchestrator.callAgent(
                'concurrency-test-agent',
                'test concurrency',
            );
            const duration = Date.now() - startTime;

            expect(result).toBeDefined();
            expect(result.metadata?.toolsUsed).toBe(10);
            // Should take longer due to concurrency limit
            expect(duration).toBeGreaterThan(100); // Some batching delay
        });

        it('should handle memory pressure scenarios', async () => {
            // Tool que usa muita memória
            orchestrator.createTool({
                name: 'memory_intensive_tool',
                description: 'Tool that uses lots of memory',
                inputSchema: z.object({ size: z.number() }),
                execute: async (input: { size: number }) => {
                    // Simulate memory usage
                    const largeArray = new Array(input.size).fill('data');
                    return {
                        result: 'Memory operation completed',
                        arraySize: largeArray.length,
                    };
                },
            });

            await orchestrator.createAgent({
                name: 'memory-pressure-agent',
                description: 'Agent under memory pressure',
                think: async (
                    _input: string,
                    _context: Record<string, unknown>,
                ) => {
                    return {
                        reasoning: 'Testing memory pressure handling',
                        action: {
                            type: 'parallel_tools',
                            content: {
                                tools: [
                                    {
                                        name: 'memory_intensive_tool',
                                        input: { size: 10000 },
                                    },
                                    {
                                        name: 'memory_intensive_tool',
                                        input: { size: 10000 },
                                    },
                                    {
                                        name: 'fast_tool',
                                        input: { message: 'light operation' },
                                    },
                                ],
                                config: {
                                    maxConcurrency: 3,
                                    failFast: false,
                                },
                            },
                        },
                    };
                },
            });

            const result = await orchestrator.callAgent(
                'memory-pressure-agent',
                'test memory pressure',
            );

            expect(result).toBeDefined();
            // Should complete despite memory pressure
            expect(result.metadata?.toolsUsed).toBeGreaterThan(0);
        });
    });
});
