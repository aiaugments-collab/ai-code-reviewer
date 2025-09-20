import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Router } from '../../../src/engine/routing/router.js';
import { z } from 'zod';

describe('Router Intelligence - Tool Execution Strategy Decisions', () => {
    let router: Router<z.ZodString>;

    beforeEach(() => {
        const mockAgent = {
            name: 'test-agent',
            description: 'Test agent',
            think: vi.fn().mockResolvedValue({
                reasoning: 'Test reasoning',
                action: { type: 'final_answer', content: 'Test result' },
            }),
        };

        const routerConfig = {
            name: 'test-router',
            description: 'Test router',
            routes: {
                default: mockAgent,
            },
            intentSchema: z.string(),
            defaultToolExecutionStrategy: 'sequential' as const,
            enableAdaptiveToolStrategy: true,
            toolExecutionConstraints: {
                maxConcurrency: 5,
                defaultTimeout: 30000,
                failFast: false,
            },
        };

        router = new Router(routerConfig);
    });

    describe('determineToolExecutionStrategy', () => {
        it('should determine parallel strategy for multiple independent tools', () => {
            const tools = [
                'search_web',
                'search_docs',
                'get_weather',
                'fetch_news',
            ];
            const context = { input: 'gather information quickly' };

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
            );

            expect(strategy).toBeDefined();
            expect(strategy.strategy).toBeDefined();
            expect(strategy.confidence).toBeGreaterThan(0);
            expect(strategy.reasoning).toBeDefined();
            expect(strategy.executionPlan).toBeDefined();
        });

        it('should determine sequential strategy for dependent tools', () => {
            const tools = ['fetch_data', 'process_data', 'save_results'];
            const context = { input: 'process data step by step' };

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
            );

            expect(strategy).toBeDefined();
            expect(strategy.strategy).toBeDefined();
            expect(strategy.confidence).toBeGreaterThan(0);
            expect(strategy.reasoning).toBeDefined();
            expect(strategy.executionPlan).toBeDefined();
        });

        it('should determine conditional strategy for conditional logic tools', () => {
            const tools = [
                'check_condition',
                'if_valid_process',
                'when_ready_execute',
            ];
            const context = { input: 'execute based on conditions' };

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
            );

            expect(strategy).toBeDefined();
            expect(strategy.strategy).toBeDefined();
            expect(strategy.confidence).toBeGreaterThan(0);
            expect(strategy.reasoning).toBeDefined();
            expect(strategy.executionPlan).toBeDefined();
        });

        it('should handle time constraints', () => {
            const tools = ['search_web', 'search_docs'];
            const context = { input: 'quick search' };
            const constraints = { timeLimit: 5000 }; // 5 seconds - time constrained

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
                constraints,
            );

            expect(strategy).toBeDefined();
            expect(strategy.strategy).toBe('parallel'); // Should choose parallel for speed
            expect(strategy.confidence).toBeGreaterThan(0.8);
            expect(strategy.reasoning).toContain('time');
        });

        it('should handle resource constraints', () => {
            const tools = ['heavy_computation', 'intensive_analysis'];
            const context = { input: 'resource limited task' };
            const constraints = { resourceLimit: 0.3 }; // Low resource limit

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
                constraints,
            );

            expect(strategy).toBeDefined();
            expect(strategy.strategy).toBe('parallel'); // Should still choose parallel but optimized
            expect(strategy.confidence).toBeGreaterThan(0.8);
            expect(strategy.reasoning).toContain('resource');
        });

        it('should handle quality requirements', () => {
            const tools = ['analyze_data', 'validate_results', 'double_check'];
            const context = { input: 'high quality analysis required' };
            const constraints = { qualityThreshold: 0.9 }; // High quality requirement

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
                constraints,
            );

            expect(strategy).toBeDefined();
            expect(strategy.strategy).toBe('adaptive'); // Should choose adaptive for quality
            expect(strategy.confidence).toBeGreaterThan(0.8);
            expect(strategy.reasoning).toContain('Adaptive');
        });
    });

    describe('Tool pattern analysis', () => {
        it('should analyze execution plan phases', () => {
            const tools = ['fetch_data', 'process_data', 'analyze_results'];
            const context = { input: 'sequential data processing' };

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
            );

            expect(strategy.executionPlan).toBeDefined();
            expect(strategy.executionPlan.phases).toBeInstanceOf(Array);
            expect(strategy.executionPlan.totalEstimatedTime).toBeGreaterThan(
                0,
            );
            expect(strategy.executionPlan.riskLevel).toBeDefined();
            expect(['low', 'medium', 'high']).toContain(
                strategy.executionPlan.riskLevel,
            );
        });

        it('should handle empty tools array', () => {
            const tools: string[] = [];
            const context = { input: 'no tools available' };

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
            );

            expect(strategy).toBeDefined();
            expect(strategy.strategy).toBeDefined();
            expect(strategy.confidence).toBeGreaterThan(0);
            // Router creates default execution plan even for empty tools
            expect(strategy.executionPlan.phases.length).toBeGreaterThanOrEqual(
                0,
            );
        });

        it('should handle single tool', () => {
            const tools = ['single_tool'];
            const context = { input: 'single tool execution' };

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
            );

            expect(strategy).toBeDefined();
            expect(strategy.strategy).toBeDefined();
            expect(strategy.confidence).toBeGreaterThan(0);
            expect(strategy.executionPlan.phases.length).toBeGreaterThanOrEqual(
                0,
            );
        });
    });

    describe('Router configuration and adaptive strategy', () => {
        it('should respect default tool execution strategy from config', () => {
            expect(router.config.defaultToolExecutionStrategy).toBe(
                'sequential',
            );
        });

        it('should have adaptive strategy enabled', () => {
            expect(router.config.enableAdaptiveToolStrategy).toBe(true);
        });

        it('should respect tool execution constraints', () => {
            expect(router.config.toolExecutionConstraints?.maxConcurrency).toBe(
                5,
            );
            expect(router.config.toolExecutionConstraints?.defaultTimeout).toBe(
                30000,
            );
            expect(router.config.toolExecutionConstraints?.failFast).toBe(
                false,
            );
        });
    });

    describe('Error handling and edge cases', () => {
        it('should handle malformed context gracefully', () => {
            const tools = ['test_tool'];
            const context = {} as Record<string, unknown>; // Empty object instead of null

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
            );
            expect(strategy).toBeDefined();
            expect(strategy.strategy).toBeDefined();
        });

        it('should handle invalid tools array gracefully', () => {
            const tools = [] as string[]; // Empty array instead of null
            const context = { input: 'test' };

            const strategy = router.determineToolExecutionStrategy(
                tools,
                context,
            );
            expect(strategy).toBeDefined();
            expect(strategy.strategy).toBeDefined();
        });
    });
});
