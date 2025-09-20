import { describe, it, expect } from 'vitest';
import { createOrchestration } from '../../src/orchestration/sdk-orchestrator';
import { z } from 'zod';

describe('Integração Agent + Tool', () => {
    it('deve executar uma tool via action tool_call do agent', async () => {
        const orchestration = createOrchestration({
            llmAdapter: {
                call: async (input: unknown) => {
                    // ✅ ADD: Implementação correta do método call
                    if (
                        typeof input === 'object' &&
                        input !== null &&
                        'messages' in input
                    ) {
                        const messages = (
                            input as { messages: Array<{ content: string }> }
                        ).messages;
                        const lastMessage = messages[messages.length - 1];

                        // ✅ ADD: Análise inteligente baseada no conteúdo
                        if (lastMessage.content.includes('Complete:')) {
                            return {
                                content:
                                    'Complete: yes\nHelpful: yes\nNext: final_answer\nReasoning: Tool execution successful, goal achieved',
                            };
                        }

                        return { content: 'Mock response' };
                    }
                    return { content: 'Mock response' };
                },
                analyzeContext: async () => ({
                    intent: 'test',
                    urgency: 'normal',
                    complexity: 'simple',
                    selectedTool: 'eco',
                    confidence: 0.9,
                    reasoning: 'Test reasoning',
                }),
                extractParameters: async () => ({}),
                generateResponse: async () => 'Mock response',
                getProvider: () => ({ name: 'mock' }),
                getAvailableTechniques: () => ['cot'],
                // ✅ ADD: Suporte para createPlan (necessário para ReAct planner)
                createPlan: async (
                    goal: string,
                    strategy: string,
                    _context: unknown,
                ) => ({
                    strategy,
                    steps: [
                        {
                            type: 'tool_call',
                            tool: 'eco', // ✅ CORRIGIR: tool em vez de toolName
                            arguments: { mensagem: goal }, // ✅ CORRIGIR: arguments em vez de input
                            description:
                                'Vou usar a tool eco para processar a mensagem',
                        },
                    ],
                    confidence: 0.9,
                    reasoning: 'Plano para usar a tool eco',
                }),
                // ✅ ADD: Suporte para structured generation
                supportsStructuredGeneration: () => true,
            },
        });

        orchestration.createTool({
            name: 'eco',
            description: 'Ecoa o input',
            inputSchema: z.object({
                mensagem: z.string().describe('Mensagem'),
            }),
            execute: async (input: unknown, _context: unknown) => {
                const typedInput = input as { mensagem: string };
                return { resposta: `ECO: ${typedInput.mensagem}` };
            },
        });

        await orchestration.createAgent({
            name: 'agent-eco',
            identity: {
                name: 'agent-eco',
                description: 'Agent que ecoa usando tool',
                capabilities: ['tool_execution'],
            },
            // Remover think function - será substituída pelo AgentCore
        });

        // 1. Chama o agent - ele deve processar automaticamente o ciclo tool_call → tool → final_answer
        const result = await orchestration.callAgent('agent-eco', 'olá mundo');

        // ✅ ADD: Debug do resultado
        console.log('🔍 RESULTADO DO AGENTE:', JSON.stringify(result, null, 2));

        // 2. Verifica que o resultado final é o esperado
        expect(
            (result.result as { content: { resposta: string } }).content
                .resposta,
        ).toBe('ECO: olá mundo');

        // 3. Verifica que a execução foi bem-sucedida
        expect(result.success).toBe(true);
    });
});
