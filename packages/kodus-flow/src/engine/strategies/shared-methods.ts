import type {
    StrategyExecutionContext,
    ExecutionStep,
    AgentAction,
    ActionResult,
    ResultAnalysis,
    ExecutionPlan,
} from './types.js';
import type { ToolDefinition } from '../../core/types/allTypes.js';

import { createLogger } from '../../observability/index.js';
import { ToolEngine } from '../tools/tool-engine.js';

export class SharedStrategyMethods {
    private static readonly logger = createLogger('shared-strategy-methods');
    private static toolEngine?: ToolEngine;

    static setToolEngine(toolEngine: ToolEngine): void {
        this.toolEngine = toolEngine;
        this.logger.info('🔧 ToolEngine configured for SharedStrategyMethods', {
            hasToolEngine: !!toolEngine,
        });
    }

    static async callLLM(
        prompt: string,
        _context: StrategyExecutionContext,
    ): Promise<any> {
        // TODO: Integrar com LLM adapter do agent-core.ts
        // Por enquanto, retorna resposta simulada baseada no tipo de prompt

        if (prompt.includes('próxima ação') || prompt.includes('next action')) {
            return {
                reasoning:
                    'Analyzing the request and determining next action...',
                action: { type: 'final_answer', content: 'Response generated' },
                confidence: 0.9,
            };
        } else if (prompt.includes('plano estratégico')) {
            return {
                plan: 'Strategic plan for task execution',
                reasoning: 'Breaking down complex task into manageable steps',
            };
        } else if (prompt.includes('Sintetize')) {
            return {
                synthesis: 'Comprehensive response based on executed steps',
            };
        } else {
            return {
                content: 'LLM response generated',
                reasoning: 'Processing request...',
            };
        }
    }

    static async executeTool(
        action: AgentAction,
        context: StrategyExecutionContext,
    ): Promise<unknown> {
        if (action.type !== 'tool_call' || !action.toolName) {
            throw new Error('Invalid tool call action');
        }

        if (!this.toolEngine) {
            throw new Error(
                'ToolEngine not configured. Call SharedStrategyMethods.setToolEngine() first.',
            );
        }

        this.logger.debug('🔧 Delegating tool execution to ToolEngine', {
            toolName: action.toolName,
            threadId: context.agentContext.thread?.id,
        });

        try {
            // Pure delegation - ToolEngine handles all enterprise features
            const result = await this.toolEngine.executeCall(
                action.toolName as any,
                action.input,
                {
                    //threadId: context.agentContext?.thread?.id,
                    correlationId: context.metadata?.correlationId,
                    tenantId: context.agentContext?.tenantId,
                    signal: context.agentContext?.signal,
                },
            );

            this.logger.debug('✅ Tool executed successfully via ToolEngine', {
                toolName: action.toolName,
                threadId: context.agentContext.thread?.id,
                resultType: typeof result,
            });

            return result;
        } catch (error) {
            this.logger.error(
                '❌ Tool execution failed (delegated to ToolEngine)',
                error instanceof Error ? error : undefined,
                {
                    toolName: action.toolName,
                    threadId: context.agentContext.thread?.id,
                    source: 'shared-strategy-methods',
                },
            );

            throw error;
        }
    }

    static async analyzeResult(
        result: ActionResult,
        context: StrategyExecutionContext,
    ): Promise<ResultAnalysis> {
        if (result.type === 'final_answer') {
            return {
                isComplete: true,
                isSuccessful: true,
                shouldContinue: false,
                feedback: result.content as string,
                metadata: {
                    reasoning: 'Final answer provided',
                },
            };
        } else if (result.type === 'tool_result') {
            // Analisa se precisa continuar ou parar
            const shouldContinue = this.shouldContinueAfterTool(
                result,
                context,
            );
            return {
                isComplete: !shouldContinue,
                isSuccessful: true,
                shouldContinue,
                feedback: shouldContinue
                    ? 'Tool executed, continuing...'
                    : 'Task completed',
                metadata: {
                    reasoning: shouldContinue
                        ? 'More actions needed'
                        : 'Task complete',
                },
            };
        } else {
            return {
                isComplete: false,
                isSuccessful: false,
                shouldContinue: false,
                feedback: 'Error occurred',
                metadata: {
                    reasoning: 'Error in execution',
                },
            };
        }
    }

    /**
     * Decide se continua após tool
     */
    static shouldContinueAfterTool(
        result: ActionResult,
        _context: StrategyExecutionContext,
    ): boolean {
        // Lógica simples: continua se não é final_answer
        return result.type !== 'final_answer';
    }

    // === OUTPUT EXTRACTION METHODS (compartilhados) ===

    /**
     * Extrai resultado final dos steps (lógica comum)
     */
    static extractFinalOutput(steps: ExecutionStep[]): unknown {
        // Procura por step de observe com isComplete = true
        const finalObserveStep = steps
            .filter((s) => s.type === 'observe')
            .find((s) => s.observation?.isComplete === true);

        if (finalObserveStep?.observation?.feedback) {
            return finalObserveStep.observation.feedback;
        }

        // Fallback: último resultado de tool ou resposta padrão
        const lastToolResult = steps
            .filter((s) => s.type === 'act' && s.result?.type === 'tool_result')
            .pop();

        if (lastToolResult?.result?.content) {
            return lastToolResult.result.content;
        }

        return 'Task completed';
    }

    /**
     * Extrai resultado de síntese (para ReWoo)
     */
    static async extractSynthesisOutput(
        steps: ExecutionStep[],
        context: StrategyExecutionContext,
    ): Promise<{ output: unknown }> {
        const executionSteps = steps.filter((s) => s.type === 'execute');
        const successfulSteps = executionSteps.filter(
            (s) => !s.metadata?.error,
        );

        const prompt = `
            Input original: ${context.input}
            Steps executados: ${successfulSteps.length}/${executionSteps.length}

            Resultados dos steps:
            ${successfulSteps.map((s) => `- ${(s.metadata?.planStep as any)?.name || 'Unknown step'}: ${JSON.stringify(s.metadata?.result)}`).join('\n')}

            Sintetize uma resposta final inteligente para o usuário.
        `;

        const response = await this.callLLM(prompt, context);

        return {
            output: response.synthesis || 'Task completed successfully',
        };
    }

    // === PLAN METHODS (compartilhados para ReWoo) ===

    /**
     * Cria plano estratégico (placeholder - integrar com planning/)
     */
    static async createPlan(
        context: StrategyExecutionContext,
    ): Promise<ExecutionPlan> {
        // TODO: Integrar com PlannerHandler do planning/
        const prompt = `
            Input: ${context.input}
            Tools: ${context.agentContext.availableTools.map((t) => `${t.name}: ${t.description}`).join('\n')}

            Crie um plano estratégico para resolver esta tarefa.
        `;

        const response = await this.callLLM(prompt, context);

        // Cria plano baseado na resposta
        return {
            id: `plan-${Date.now()}`,
            goal: context.input,
            strategy: 'rewoo',
            steps: this.parsePlanSteps(response.plan, context),
            reasoning: response.reasoning,
            status: 'created',
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }

    /**
     * Parseia steps do plano
     */
    static parsePlanSteps(
        _planResponse: any,
        context: StrategyExecutionContext,
    ): any[] {
        // TODO: Implementar parsing inteligente da resposta do LLM
        // For now, create basic steps
        return [
            {
                id: 'step-1',
                name: 'Analyze input',
                type: 'llm_call',
                prompt: `Analyze the following input: ${context.input}`,
            },
            {
                id: 'step-2',
                name: 'Execute tools',
                type: 'tool_call',
                toolName:
                    context.agentContext.availableTools[0]?.name ||
                    'default_tool',
                input: { query: context.input },
            },
            {
                id: 'step-3',
                name: 'Synthesize results',
                type: 'llm_call',
                prompt: 'Synthesize the results into a final response',
            },
        ];
    }

    /**
     * Executa ação do step do plano
     */
    static async executePlanStepAction(
        planStep: any,
        _context: StrategyExecutionContext,
    ): Promise<unknown> {
        // TODO: Integrar com tool engine do agent-core.ts
        if (planStep.type === 'tool_call') {
            return {
                toolName: planStep.toolName,
                result: `Executed ${planStep.toolName} with input: ${JSON.stringify(planStep.input)}`,
            };
        } else if (planStep.type === 'llm_call') {
            return {
                type: 'llm_response',
                content: `Generated response for: ${planStep.prompt}`,
            };
        } else {
            return {
                type: 'unknown',
                content: `Executed step: ${planStep.name}`,
            };
        }
    }

    // === UTILITY METHODS (compartilhados) ===

    /**
     * Cria step com timestamp
     */
    static createStep(
        type: ExecutionStep['type'],
        data: Partial<ExecutionStep> = {},
    ): ExecutionStep {
        return {
            id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type,
            type2: 'organize',
            timestamp: Date.now(),
            status: 'pending',
            ...data,
        };
    }

    /**
     * Calcula complexidade (heurísticas comuns)
     */
    static calculateComplexity(input: string, tools: ToolDefinition[]): number {
        const toolCount = tools.length;
        const inputLength = input.length;
        const hasComplexKeywords =
            /analyze|create|generate|build|integrate|workflow|plan/i.test(
                input,
            );
        const hasMultipleActions = /and|then|after|before|while|until/i.test(
            input,
        );

        let complexity = 0;

        // Base complexity
        complexity += toolCount;

        // Input complexity
        if (inputLength > 100) complexity += 1;
        if (inputLength > 500) complexity += 2;

        // Keyword complexity
        if (hasComplexKeywords) complexity += 2;
        if (hasMultipleActions) complexity += 1;

        return complexity;
    }
}
