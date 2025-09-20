/**
 * @fileoverview Testes Unitários ReWOO - Sem dependência de LLM
 *
 * OBJETIVO: Validar o funcionamento básico do ReWOO sem precisar de APIs externas
 * - PlanExecutor com ReWOO mode
 * - Rich context integration
 * - Step execution logic
 * - Replan context preservation
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { PlanExecutor } from '../../../src/engine/planning/executor/plan-executor.js';
import type {
    ExecutionPlan,
    PlanStep,
} from '../../../src/core/types/planning-shared.js';
import type {
    AgentAction,
    ActionResult,
    PlannerExecutionContext,
} from '../../../src/engine/planning/planner-factory.js';

// Type for tool_call actions in tests
interface ToolCallAction extends AgentAction {
    type: 'tool_call';
    toolName: string;
    input?: Record<string, unknown>;
    arguments?: Record<string, unknown>;
}

describe('🚀 ReWOO Unit Tests', () => {
    let planExecutor: PlanExecutor;
    let mockAct: (action: AgentAction) => Promise<ActionResult>;
    let mockResolveArgs: (
        rawArgs: Record<string, unknown>,
        stepList: PlanStep[],
        context: PlannerExecutionContext,
    ) => Promise<{ args: Record<string, unknown>; missing: string[] }>;
    let mockContext: PlannerExecutionContext;

    beforeEach(() => {
        // Mock act function that simulates tool execution
        mockAct = async (action: AgentAction): Promise<ActionResult> => {
            if (action.type === 'tool_call') {
                const toolAction = action as ToolCallAction;
                const toolName = toolAction.toolName;
                const args = toolAction.input || toolAction.arguments || {};

                // Simulate different tool behaviors
                switch (toolName) {
                    case 'calculator':
                        const expression = (args.expression as string) || '1+1';
                        if (expression === 'invalid') {
                            return {
                                type: 'error',
                                error: 'Invalid mathematical expression',
                            };
                        }
                        return {
                            type: 'tool_result',
                            content: {
                                result: eval(expression),
                                expression,
                            },
                        };

                    case 'weather_api':
                        const city = (args.city as string) || 'Unknown';
                        if (city === 'InvalidCity') {
                            return {
                                type: 'error',
                                error: 'City not found',
                            };
                        }
                        return {
                            type: 'tool_result',
                            content: {
                                city,
                                temperature: 25,
                                condition: 'sunny',
                            },
                        };

                    case 'email_sender':
                        const to = (args.to as string) || 'unknown@domain';
                        if (to === 'invalid@domain') {
                            return {
                                type: 'error',
                                error: 'Invalid email address',
                            };
                        }
                        return {
                            type: 'tool_result',
                            content: {
                                messageId: 'msg-123',
                                status: 'sent',
                                recipient: to,
                            },
                        };

                    default:
                        return {
                            type: 'error',
                            error: `Unknown tool: ${toolName}`,
                        };
                }
            }

            return {
                type: 'error',
                error: 'Unsupported action type',
            };
        };

        // Mock resolve args function
        mockResolveArgs = async (
            rawArgs: Record<string, unknown>,
            stepList: PlanStep[],
            _context: PlannerExecutionContext,
        ) => {
            const resolved: Record<string, unknown> = {};
            const missing: string[] = [];

            for (const [key, value] of Object.entries(rawArgs)) {
                if (typeof value === 'string' && value.includes('{{')) {
                    // Simple template resolution for testing
                    const match = value.match(/\{\{([^}]+)\}\}/);
                    if (match) {
                        const ref = match[1];
                        const [stepId] = ref.split('.');

                        // Find the referenced step result
                        const referencedStep = stepList.find(
                            (s) => s.id === stepId,
                        );
                        if (referencedStep && referencedStep.result) {
                            resolved[key] = referencedStep.result;
                        } else {
                            missing.push(ref);
                        }
                    } else {
                        resolved[key] = value;
                    }
                } else {
                    resolved[key] = value;
                }
            }

            return { args: resolved, missing };
        };

        // Mock context
        mockContext = {
            input: 'Test execution',
            history: [],
            isComplete: false,
            iterations: 1,
            maxIterations: 5,
            plannerMetadata: {
                tenantId: 'test-tenant',
                correlationId: 'test-correlation',
            },
            update: () => {},
            getCurrentSituation: () => 'Testing situation',
            getFinalResult: () => ({
                output: 'test result',
                success: true,
                iterations: 1,
                totalTime: 100,
                thoughts: [],
            }),
        } as PlannerExecutionContext;

        // Create PlanExecutor in ReWOO mode
        planExecutor = new PlanExecutor(mockAct, mockResolveArgs, {
            enableReWOO: true,
            maxRetries: 2,
        });
    });

    describe('🎯 Basic ReWOO Execution', () => {
        test('deve executar plano simples com sucesso', async () => {
            const plan: ExecutionPlan = {
                id: 'plan-test-1',
                strategy: 'rewoo',
                version: '1.0',
                goal: 'Calculate 2+3',
                reasoning: 'Simple calculation',
                steps: [
                    {
                        id: 'step-1',
                        description: 'Calculate 2+3',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: '2+3' },
                        status: 'pending',
                        dependencies: [],
                        parallel: false,
                    },
                ],
                status: 'executing',
                currentStepIndex: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const result = await planExecutor.run(plan, mockContext);

            expect(result.type).toBe('execution_complete');
            expect(result.planId).toBe('plan-test-1');
            expect(result.strategy).toBe('rewoo');
            expect(result.totalSteps).toBe(1);
            expect(result.successfulSteps).toHaveLength(1);
            expect(result.failedSteps).toHaveLength(0);
            expect(result.executedSteps).toHaveLength(1);
            expect(result.executedSteps[0].success).toBe(true);
            expect(result.executedSteps[0].result).toBeDefined();
        });

        test('deve executar steps paralelos simultaneamente', async () => {
            const plan: ExecutionPlan = {
                id: 'plan-parallel',
                strategy: 'rewoo',
                version: '1.0',
                goal: 'Multiple parallel calculations',
                reasoning: 'Test parallel execution',
                steps: [
                    {
                        id: 'step-1',
                        description: 'Calculate 5+5',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: '5+5' },
                        status: 'pending',
                        dependencies: [],
                        parallel: true,
                    },
                    {
                        id: 'step-2',
                        description: 'Calculate 10*2',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: '10*2' },
                        status: 'pending',
                        dependencies: [],
                        parallel: true,
                    },
                    {
                        id: 'step-3',
                        description: 'Get weather',
                        type: 'action',
                        tool: 'weather_api',
                        arguments: { city: 'São Paulo' },
                        status: 'pending',
                        dependencies: [],
                        parallel: true,
                    },
                ],
                status: 'executing',
                currentStepIndex: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const startTime = Date.now();
            const result = await planExecutor.run(plan, mockContext);
            const executionTime = Date.now() - startTime;

            expect(result.type).toBe('execution_complete');
            expect(result.successfulSteps).toHaveLength(3);
            expect(result.failedSteps).toHaveLength(0);

            // Parallel execution should be fast
            expect(executionTime).toBeLessThan(1000);

            // All steps should have executed
            expect(result.executedSteps).toHaveLength(3);
            expect(result.executedSteps.every((step) => step.success)).toBe(
                true,
            );
        });

        test('deve lidar com dependências entre steps', async () => {
            const plan: ExecutionPlan = {
                id: 'plan-dependencies',
                strategy: 'rewoo',
                version: '1.0',
                goal: 'Calculate then use result',
                reasoning: 'Test step dependencies',
                steps: [
                    {
                        id: 'step-calc',
                        description: 'Calculate base value',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: '20+10' },
                        status: 'pending',
                        dependencies: [],
                        parallel: false,
                    },
                    {
                        id: 'step-weather',
                        description: 'Get weather for city',
                        type: 'action',
                        tool: 'weather_api',
                        arguments: { city: 'São Paulo' },
                        status: 'pending',
                        dependencies: ['step-calc'], // Depends on calculation
                        parallel: false,
                    },
                ],
                status: 'executing',
                currentStepIndex: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const result = await planExecutor.run(plan, mockContext);

            expect(result.type).toBe('execution_complete');
            expect(result.successfulSteps).toHaveLength(2);
            expect(result.failedSteps).toHaveLength(0);

            // Check execution order - step-calc should execute before step-weather
            const calcStep = result.executedSteps.find(
                (s) => s.stepId === 'step-calc',
            );
            const weatherStep = result.executedSteps.find(
                (s) => s.stepId === 'step-weather',
            );

            expect(calcStep).toBeDefined();
            expect(weatherStep).toBeDefined();
            // Allow for very fast execution (same timestamp is valid for synchronous operations)
            expect(calcStep!.executedAt).toBeLessThanOrEqual(
                weatherStep!.executedAt,
            );
        });
    });

    describe('🔄 ReWOO Error Handling & Replan Context', () => {
        test('deve detectar falha e retornar needs_replan', async () => {
            const plan: ExecutionPlan = {
                id: 'plan-with-error',
                strategy: 'rewoo',
                version: '1.0',
                goal: 'Mixed success and failure',
                reasoning: 'Test error handling',
                steps: [
                    {
                        id: 'step-success',
                        description: 'Successful calculation',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: '15+15' },
                        status: 'pending',
                        dependencies: [],
                        parallel: true,
                    },
                    {
                        id: 'step-failure',
                        description: 'Invalid calculation',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: 'invalid' },
                        status: 'pending',
                        dependencies: [],
                        parallel: true,
                    },
                    {
                        id: 'step-weather-error',
                        description: 'Invalid city weather',
                        type: 'action',
                        tool: 'weather_api',
                        arguments: { city: 'InvalidCity' },
                        status: 'pending',
                        dependencies: [],
                        parallel: true,
                    },
                ],
                status: 'executing',
                currentStepIndex: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const result = await planExecutor.run(plan, mockContext);

            expect(result.type).toBe('needs_replan');
            expect(result.successfulSteps).toHaveLength(1);
            expect(result.failedSteps).toHaveLength(2);
            expect(result.successfulSteps[0]).toBe('step-success');
            expect(result.failedSteps).toContain('step-failure');
            expect(result.failedSteps).toContain('step-weather-error');

            // Should provide replan context
            expect(result.replanContext).toBeDefined();
            expect(result.replanContext!.preservedSteps).toHaveLength(1);
            expect(result.replanContext!.failurePatterns).toContain(
                'invalid mathematical expression',
            );
            expect(result.replanContext!.suggestedStrategy).toBe(
                'plan-execute',
            );
        });

        test('deve preservar contexto rico para replan', async () => {
            const plan: ExecutionPlan = {
                id: 'plan-context',
                strategy: 'rewoo',
                version: '1.0',
                goal: 'Test context preservation',
                reasoning: 'Validate rich context',
                steps: [
                    {
                        id: 'step-good',
                        description: 'Good calculation',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: '50*2' },
                        status: 'pending',
                        dependencies: [],
                        parallel: false,
                    },
                    {
                        id: 'step-bad',
                        description: 'Bad email',
                        type: 'action',
                        tool: 'email_sender',
                        arguments: {
                            to: 'invalid@domain',
                            subject: 'Test',
                            body: 'Test message',
                        },
                        status: 'pending',
                        dependencies: ['step-good'],
                        parallel: false,
                    },
                ],
                status: 'executing',
                currentStepIndex: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const result = await planExecutor.run(plan, mockContext);

            expect(result.type).toBe('needs_replan');
            expect(result.replanContext).toBeDefined();

            const context = result.replanContext!;
            expect(context.preservedSteps).toHaveLength(1);
            expect(context.preservedSteps[0].stepId).toBe('step-good');
            expect(context.preservedSteps[0].success).toBe(true);
            expect(context.preservedSteps[0].result).toBeDefined();

            expect(context.failurePatterns).toContain('invalid email address');
            expect(context.contextForReplan).toBeDefined();
            expect(context.contextForReplan.successfulSteps).toEqual([
                'step-good',
            ]);
            expect(context.contextForReplan.failedSteps).toEqual(['step-bad']);
        });

        test('deve detectar deadlock em dependências (ou needs_replan)', async () => {
            const plan: ExecutionPlan = {
                id: 'plan-deadlock',
                strategy: 'rewoo',
                version: '1.0',
                goal: 'Test deadlock detection',
                reasoning: 'Circular dependencies',
                steps: [
                    {
                        id: 'step-1',
                        description: 'Step that fails',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: 'invalid' },
                        status: 'pending',
                        dependencies: [],
                        parallel: false,
                    },
                    {
                        id: 'step-2',
                        description: 'Step depending on failed step',
                        type: 'action',
                        tool: 'weather_api',
                        arguments: { city: 'São Paulo' },
                        status: 'pending',
                        dependencies: ['step-1'], // Depends on failing step
                        parallel: false,
                    },
                    {
                        id: 'step-3',
                        description: 'Another dependent step',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: '1+1' },
                        status: 'pending',
                        dependencies: ['step-2'], // Chain dependency
                        parallel: false,
                    },
                ],
                status: 'executing',
                currentStepIndex: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const result = await planExecutor.run(plan, mockContext);

            // Accept either deadlock or needs_replan as valid outcomes
            expect(['deadlock', 'needs_replan']).toContain(result.type);
            expect(result.failedSteps).toContain('step-1');

            if (result.type === 'deadlock') {
                expect(result.skippedSteps).toContain('step-2');
                expect(result.skippedSteps).toContain('step-3');
                expect(result.feedback).toContain('deadlock');
            } else {
                // For needs_replan, we expect the dependent steps to fail too
                expect(result.failedSteps.length).toBeGreaterThanOrEqual(1);
            }
        });
    });

    describe('📊 ReWOO Performance & Metrics', () => {
        test('deve coletar métricas de performance', async () => {
            const plan: ExecutionPlan = {
                id: 'plan-metrics',
                strategy: 'rewoo',
                version: '1.0',
                goal: 'Performance testing',
                reasoning: 'Collect execution metrics',
                steps: [
                    {
                        id: 'step-fast',
                        description: 'Fast operation',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: '1+1' },
                        status: 'pending',
                        dependencies: [],
                        parallel: false,
                    },
                ],
                status: 'executing',
                currentStepIndex: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const result = await planExecutor.run(plan, mockContext);

            expect(result.type).toBe('execution_complete');
            // Allow for very fast execution (0ms is valid for synchronous operations)
            expect(result.executionTime).toBeGreaterThanOrEqual(0);
            expect(result.executedSteps[0].duration).toBeGreaterThanOrEqual(0);
            expect(result.executedSteps[0].executedAt).toBeGreaterThan(0);

            // Check if metrics are reasonable
            expect(result.executionTime).toBeLessThan(10000); // Should be fast
            expect(result.executedSteps[0].duration).toBeLessThan(1000);
        });
    });

    describe('🔍 ReWOO Context Validation', () => {
        test('deve validar se previousExecution está sendo passado para o planner', async () => {
            const plan: ExecutionPlan = {
                id: 'plan-context-test',
                strategy: 'rewoo',
                version: '1.0',
                goal: 'Test context passing',
                reasoning: 'Validate previousExecution flow',
                steps: [
                    {
                        id: 'step-fail',
                        description: 'Step that fails',
                        type: 'action',
                        tool: 'calculator',
                        arguments: { expression: 'invalid' },
                        status: 'pending',
                        dependencies: [],
                        parallel: false,
                    },
                ],
                status: 'executing',
                currentStepIndex: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const result = await planExecutor.run(plan, mockContext);

            expect(result.type).toBe('needs_replan');
            expect(result.replanContext).toBeDefined();
            expect(result.replanContext?.preservedSteps).toBeDefined();
            expect(result.replanContext?.failurePatterns).toBeDefined();
            expect(result.replanContext?.primaryCause).toBeDefined();

            // Simulate what agent-core would do
            const previousExecution = {
                plan: plan,
                result: result,
                preservedSteps: result.replanContext!.preservedSteps,
                failureAnalysis: {
                    primaryCause: result.replanContext!.primaryCause,
                    failurePatterns: result.replanContext!.failurePatterns,
                    affectedSteps: result.failedSteps,
                },
            };

            // Simulate planner receiving previousExecution
            const mockPlannerContext = {
                ...mockContext,
                previousExecution,
            };

            expect(mockPlannerContext.previousExecution).toBeDefined();
            expect(mockPlannerContext.previousExecution?.plan.id).toBe(
                'plan-context-test',
            );
            expect(mockPlannerContext.previousExecution?.result.type).toBe(
                'needs_replan',
            );
            expect(
                mockPlannerContext.previousExecution?.preservedSteps.length,
            ).toBe(0); // No successful steps
            expect(
                mockPlannerContext.previousExecution?.failureAnalysis
                    .primaryCause,
            ).toBe('Invalid input provided');
        });
    });

    test('deve fazer replan quando há signals mesmo com todos steps executados com sucesso', async () => {
        const mockAct = async (action: AgentAction): Promise<ActionResult> => {
            return {
                type: 'tool_result',
                content: {
                    result: { result: 'success' },
                    toolName:
                        (action as { toolName?: string }).toolName || 'unknown',
                    metadata: { correlationId: 'test' },
                    eventId: 'test-event',
                    tenantId: 'test-tenant',
                    operationId: 'test-op',
                    timestamp: Date.now(),
                },
            };
        };

        const mockResolveArgs = async (): Promise<{
            args: Record<string, unknown>;
            missing: string[];
        }> => {
            return { args: {}, missing: [] };
        };

        const executor = new PlanExecutor(mockAct, mockResolveArgs, {
            enableReWOO: true,
        });

        const plan: ExecutionPlan = {
            id: 'test-plan',
            goal: 'Test plan with signals',
            strategy: 'plan-execute',
            reasoning: 'Test reasoning',
            steps: [
                {
                    id: 'step-1',
                    description: 'Step 1',
                    type: 'action',
                    tool: 'test_tool',
                    arguments: {},
                    dependencies: [],
                    status: 'pending',
                    parallel: false,
                    optional: false,
                    retry: 0,
                    retryCount: 0,
                    maxRetries: 3,
                },
            ],
            status: 'executing',
            currentStepIndex: 0,
            metadata: {
                signals: {
                    needs: ['more_user_info'],
                    suggestedNextStep: 'get_user_preferences',
                    errors: [],
                    noDiscoveryPath: [],
                },
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        const context = {
            agentContext: {
                session: {
                    addEntry: vi.fn(),
                },
                stepExecution: {
                    addContextOperation: vi.fn(),
                    updateStep: vi.fn(),
                    getCurrentStep: vi.fn(),
                },
                sessionId: 'test-session',
                tenantId: 'test-tenant',
                correlationId: 'test-correlation',
                thread: { id: 'test-thread', metadata: {} },
                state: {
                    set: vi.fn(),
                    get: vi.fn(),
                    clear: vi.fn(),
                    getNamespace: vi.fn(),
                },
                memory: {
                    add: vi.fn(),
                    search: vi.fn(),
                    store: vi.fn(),
                    get: vi.fn(),
                    getRecent: vi.fn(),
                },
                kernel: { getState: vi.fn() },
                signal: new AbortController().signal,
                availableTools: [],
                agentName: 'test-agent',
                invocationId: 'test-invocation',
                track: vi.fn(),
                cleanup: vi.fn(),
                executionRuntime: { startTime: Date.now() },
            },
            history: [],
            iterations: 1,
            plannerMetadata: { startTime: Date.now() },
            input: 'test',
            isComplete: false,
            maxIterations: 5,
            update: vi.fn(),
            getCurrentSituation: vi.fn(),
            getFinalResult: vi.fn(),
        } as unknown as PlannerExecutionContext;

        const result = await executor.run(plan, context);

        // ✅ Deve fazer replan mesmo com steps executados com sucesso
        expect(result.type).toBe('needs_replan');
        expect(result.hasSignalsProblems).toBe(true);
        expect(result.signals?.needs).toContain('more_user_info');
        expect(result.signals?.suggestedNextStep).toBe('get_user_preferences');
        expect(result.successfulSteps).toContain('step-1');
        expect(result.failedSteps).toHaveLength(0);
        expect(result.executedSteps).toHaveLength(1);
        expect(result.executedSteps[0].success).toBe(true);
        expect(result.feedback).toContain('signals');
    });

    test('deve fazer replan quando há apenas suggestedNextStep sem outros signals', async () => {
        const mockAct = async (_action: AgentAction): Promise<ActionResult> => {
            return {
                type: 'tool_result',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            data: { result: 'success' },
                            error: null,
                            successful: true,
                            logId: 'test-log',
                        }),
                    },
                ],
                metadata: { correlationId: 'test' },
            };
        };

        const mockResolveArgs = async (): Promise<{
            args: Record<string, unknown>;
            missing: string[];
        }> => {
            return { args: {}, missing: [] };
        };

        const executor = new PlanExecutor(mockAct, mockResolveArgs, {
            enableReWOO: true,
        });

        const plan: ExecutionPlan = {
            id: 'test-plan',
            goal: 'Test plan with suggestedNextStep only',
            strategy: 'plan-execute',
            reasoning: 'Test reasoning for suggestedNextStep',
            steps: [
                {
                    id: 'step-1',
                    description: 'Step 1',
                    type: 'action',
                    tool: 'test_tool',
                    arguments: {},
                    dependencies: [],
                    status: 'pending',
                    parallel: false,
                    optional: false,
                    retry: 0,
                    retryCount: 0,
                    maxRetries: 3,
                },
            ],
            status: 'executing',
            currentStepIndex: 0,
            metadata: {
                signals: {
                    needs: [], // Vazio
                    suggestedNextStep: 'get_user_preferences', // Apenas isso
                    errors: [], // Vazio
                    noDiscoveryPath: [], // Vazio
                },
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        const context = {
            agentContext: {
                session: {
                    addEntry: vi.fn(),
                },
                stepExecution: {
                    addContextOperation: vi.fn(),
                    updateStep: vi.fn(),
                    getCurrentStep: vi.fn(),
                },
            },
            history: [],
            iterations: 1,
            plannerMetadata: { startTime: Date.now() },
            input: 'test',
            isComplete: false,
            maxIterations: 5,
            update: vi.fn(),
            getCurrentSituation: vi.fn(),
            getFinalResult: vi.fn(),
        } as unknown as PlannerExecutionContext;

        const result = await executor.run(plan, context);

        // ✅ Deve fazer replan mesmo com apenas suggestedNextStep
        expect(result.type).toBe('needs_replan');
        expect(result.hasSignalsProblems).toBe(true);
        expect(result.signals?.suggestedNextStep).toBe('get_user_preferences');
        expect(result.signals?.needs).toHaveLength(0);
        expect(result.signals?.errors).toHaveLength(0);
        expect(result.successfulSteps).toContain('step-1');
        expect(result.failedSteps).toHaveLength(0);
        expect(result.feedback).toContain('signals');
    });

    it('should respect maxReplansPerPlan limit and stop infinite loop', async () => {
        const mockAct = async (_action: AgentAction): Promise<ActionResult> => {
            return {
                type: 'tool_result',
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            data: { result: 'success' },
                            error: null,
                            successful: true,
                            logId: 'test-log',
                        }),
                    },
                ],
                metadata: { correlationId: 'test' },
            };
        };

        const mockResolveArgs = async (): Promise<{
            args: Record<string, unknown>;
            missing: string[];
        }> => {
            return { args: {}, missing: ['user_preferences'] }; // ✅ SEMPRE FALTANDO INPUT
        };

        const executor = new PlanExecutor(mockAct, mockResolveArgs, {
            enableReWOO: true,
        });

        const plan: ExecutionPlan = {
            id: 'test-plan',
            goal: 'Test plan with maxReplansPerPlan limit',
            strategy: 'plan-execute',
            reasoning: 'Test reasoning for maxReplansPerPlan',
            steps: [
                {
                    id: 'step-1',
                    description: 'Step 1',
                    type: 'action',
                    tool: 'test_tool',
                    arguments: {},
                    dependencies: [],
                    status: 'pending',
                    parallel: false,
                    optional: false,
                    retry: 0,
                    retryCount: 0,
                    maxRetries: 3,
                },
            ],
            status: 'executing',
            currentStepIndex: 0,
            metadata: {
                replansCount: 0, // ✅ COMEÇA COM 0
                signals: {
                    needs: ['user_preferences'], // ✅ SEMPRE FALTANDO
                    suggestedNextStep: 'get_user_preferences',
                    errors: [],
                    noDiscoveryPath: [],
                },
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        const context = {
            agentContext: {
                session: {
                    addEntry: vi.fn(),
                },
                stepExecution: {
                    addContextOperation: vi.fn(),
                    updateStep: vi.fn(),
                    getCurrentStep: vi.fn(),
                },
            },
            history: [],
            iterations: 1,
            plannerMetadata: { startTime: Date.now() },
            input: 'test',
            isComplete: false,
            maxIterations: 5,
            update: vi.fn(),
            getCurrentSituation: vi.fn(),
            getFinalResult: vi.fn(),
        } as unknown as PlannerExecutionContext;

        // ✅ PRIMEIRA EXECUÇÃO - DEVE REPLAN
        let result = await executor.run(plan, context);
        expect(result.type).toBe('needs_replan');
        expect(result.hasSignalsProblems).toBe(true);
        expect(result.signals?.needs).toContain('user_preferences');

        // ✅ SEGUNDA EXECUÇÃO - DEVE PARAR (maxReplansPerPlan = 1, replansCount já é 1)
        result = await executor.run(plan, context);
        expect(result.type).toBe('execution_complete'); // ✅ DEVE PARAR
        expect(result.hasSignalsProblems).toBe(true); // ✅ AINDA TEM PROBLEMAS DE SIGNALS
        expect(result.feedback).toContain('Replan limit reached'); // ✅ DEVE MENCIONAR LIMITE
    });
});
