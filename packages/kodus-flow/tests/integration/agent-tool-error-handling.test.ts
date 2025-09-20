import { describe, it, expect, beforeEach } from 'vitest';
import { createOrchestration } from '../../src/orchestration/index.js';
import { z } from 'zod';

describe('Agent Tool Error Handling', () => {
    let orchestration: ReturnType<typeof createOrchestration>;

    beforeEach(() => {
        orchestration = createOrchestration({
            llmAdapter: {
                call: async (input: {
                    messages: Array<{ content: string }>;
                }) => {
                    const messages = input.messages;
                    const lastMessage = messages[messages.length - 1];

                    if (lastMessage.content.includes('error')) {
                        return {
                            content:
                                'Complete: yes\nHelpful: yes\nNext: final_answer\nReasoning: Tool failed but I can provide a helpful response',
                        };
                    }

                    return { content: 'Mock response' };
                },
                analyzeContext: async () => ({
                    intent: 'test',
                    urgency: 'normal',
                    complexity: 'simple',
                    selectedTool: 'test-tool',
                    confidence: 0.9,
                    reasoning: 'Test reasoning',
                }),
                extractParameters: async () => ({}),
                generateResponse: async () => 'Mock response',
                getProvider: () => ({ name: 'mock' }),
                getAvailableTechniques: () => ['cot'],
                createPlan: async () => ({
                    strategy: 'test',
                    steps: [
                        {
                            type: 'tool_call',
                            tool: 'test-tool',
                            arguments: { test: 'data' },
                        },
                    ],
                    finalAnswer: 'Test completed',
                }),
            },
        });

        // ✅ Registrar tool que falha com 401 (não retryable)
        orchestration.createTool({
            name: 'auth-error-tool',
            description: 'Tool that fails with 401 error',
            inputSchema: z.object({}),
            execute: async () => {
                throw new Error('401 Unauthorized - Invalid API key');
            },
        });
    });

    it('deve continuar execução mesmo quando tool falha com erro 401', async () => {
        await orchestration.createAgent({
            name: 'error-handling-agent',
            identity: {
                name: 'Error Handling Agent',
                description: 'Agent that handles tool errors gracefully',
            },
        });

        const result = await orchestration.callAgent(
            'error-handling-agent',
            'Test 401 error handling',
        );

        console.log(
            '🔍 RESULTADO COM ERRO 401:',
            JSON.stringify(result, null, 2),
        );

        expect(result.success).toBe(true);
        expect(result.result).toBeDefined();
        const resultData = result.result as Record<string, unknown>;
        expect(resultData.type).toBe('error');
        expect(resultData.error).toContain('401');
        expect(resultData.metadata).toBeDefined();
        expect((resultData.metadata as Record<string, unknown>).tool).toBe(
            'auth-error-tool',
        );
    });
});
