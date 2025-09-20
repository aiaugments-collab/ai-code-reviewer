/**
 * @fileoverview Testes para Think→Act→Observe Loop
 *
 * OBJETIVO: Validar que AgentEngine executa ciclo Think→Act→Observe
 * - Loop de execução funcional
 * - Integração com planners
 * - Context tracking
 * - Iterações controladas
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { AgentEngine } from '../../../src/engine/agents/agent-engine.js';
import { ToolEngine } from '../../../src/engine/tools/tool-engine.js';
import { createLLMAdapter } from '../../../src/core/llm/llm-adapter.js';
import { createGeminiProviderFromEnv } from '../../../src/core/llm/providers/gemini-provider.js';
import { defineTool } from '../../../src/core/types/tool-types.js';
import { z } from 'zod';
import type { AgentCoreConfig } from '../../../src/engine/agents/agent-core.js';

describe('🔄 Think→Act→Observe Loop Tests', () => {
    let agentEngine: AgentEngine<string, unknown, string>;
    let toolEngine: ToolEngine;
    let llmAdapter: ReturnType<typeof createLLMAdapter>;
    let config: AgentCoreConfig;

    beforeEach(() => {
        // Setup LLM
        const geminiProvider = createGeminiProviderFromEnv();
        llmAdapter = createLLMAdapter(geminiProvider);

        // Setup ToolEngine with test tools
        toolEngine = new ToolEngine();

        // Add test tools
        const calculatorTool = defineTool({
            name: 'calculator',
            description: 'Performs mathematical calculations',
            inputSchema: z.object({
                expression: z.string(),
            }),
            execute: async (input) => {
                try {
                    const result = eval(input.expression);
                    return { result, expression: input.expression };
                } catch {
                    return { error: 'Invalid expression' };
                }
            },
        });

        const greetingTool = defineTool({
            name: 'greeting',
            description: 'Creates personalized greetings',
            inputSchema: z.object({
                name: z.string(),
            }),
            execute: async (input) => {
                return { greeting: `Hello, ${input.name}!` };
            },
        });

        toolEngine.registerTool(calculatorTool);
        toolEngine.registerTool(greetingTool);

        // Setup AgentEngine config
        config = {
            tenantId: 'test-tenant',
            agentName: 'test-agent',
            planner: 'react',
            llmAdapter,
            maxThinkingIterations: 3,
            enableKernelIntegration: false,
            debug: true,
            monitoring: false,
        };

        // Create agent definition
        const agentDefinition = {
            name: 'test-agent',
            description: 'Test agent for think-act-observe loop',
            think: async (input: string) => ({
                reasoning: `Processing: ${input}`,
                action: {
                    type: 'final_answer' as const,
                    content: `Result: ${input}`,
                },
            }),
            config: {},
        };

        agentEngine = new AgentEngine(agentDefinition, toolEngine, config);
    });

    describe('🔧 Configuration & Integration', () => {
        test('deve usar configuração fornecida', () => {
            expect(config.agentName).toBe('test-agent');
            expect(config.planner).toBe('react');
            expect(config.maxThinkingIterations).toBe(3);
        });

        test('deve integrar com ToolEngine', () => {
            const availableTools = toolEngine.getAvailableTools();
            expect(availableTools.length).toBeGreaterThan(0);
            expect(availableTools.some((t) => t.name === 'calculator')).toBe(
                true,
            );
            expect(availableTools.some((t) => t.name === 'greeting')).toBe(
                true,
            );
        });

        test('deve integrar com LLM adapter', () => {
            expect(llmAdapter).toBeDefined();
            expect(llmAdapter.getProvider()).toBeDefined();
        });
    });

    describe('🔄 Agent Execution', () => {
        test('deve executar agente com sucesso', async () => {
            const input = 'Test input';

            const result = await agentEngine.execute(input, {
                correlationId: 'test-correlation',
                sessionId: 'test-session',
                thread: {
                    id: 'test-thread',
                    metadata: { description: 'Test thread' },
                },
            });

            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
        });

        test('deve lidar com ferramentas disponíveis', async () => {
            const availableTools = toolEngine.getAvailableTools();
            expect(availableTools.length).toBeGreaterThan(0);

            // Test that tools are properly registered
            const toolNames = availableTools.map((t) => t.name);
            expect(toolNames).toContain('calculator');
            expect(toolNames).toContain('greeting');
        });
    });
});
