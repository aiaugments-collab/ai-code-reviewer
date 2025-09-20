import { ReActStrategy } from './react-strategy.js';
import { ReWooStrategy } from './rewoo-strategy.js';
import { PlanExecuteStrategy } from './plan-execute-strategy.js';
import { createLogger } from '../../observability/index.js';
import { LLMAdapter } from '@/core/types/allTypes.js';

/**
 * Tipos de estratégia disponíveis
 */
export type StrategyType = 'react' | 'rewoo' | 'plan-execute';

/**
 * Configuração base para todas as estratégias
 */
export interface BaseStrategyConfig {
    maxIterations?: number;
    maxToolCalls?: number;
    maxExecutionTime?: number;
    enableLogging?: boolean;
    enableMetrics?: boolean;
    llmDefaults?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        maxReasoningTokens?: number;
        stop?: string[];
    };
}

/**
 * Factory melhorada para criar instâncias de estratégias de execução
 * Usa apenas as versões melhoradas com arquitetura limpa
 */
export class StrategyFactory {
    private static logger = createLogger('strategy-factory');
    private static strategies = new Map<
        string,
        ReActStrategy | ReWooStrategy | PlanExecuteStrategy
    >();

    /**
     * Cria estratégia baseada no tipo solicitado
     * Todas as estratégias usam as versões "improved" com arquitetura limpa
     */
    static create(
        strategyType: StrategyType,
        llmAdapter: LLMAdapter,
        config?: Record<string, unknown>,
    ): ReActStrategy | ReWooStrategy | PlanExecuteStrategy {
        const strategyKey = config
            ? `${strategyType}-${JSON.stringify(config)}`
            : strategyType;

        // Check if already registered
        if (this.strategies.has(strategyKey)) {
            return this.strategies.get(strategyKey)!;
        }

        let strategy: ReActStrategy | ReWooStrategy | PlanExecuteStrategy;

        switch (strategyType) {
            case 'react':
                strategy = new ReActStrategy(llmAdapter, config);
                break;
            case 'rewoo':
                strategy = new ReWooStrategy(llmAdapter, config);
                break;
            case 'plan-execute':
                strategy = new PlanExecuteStrategy(llmAdapter, config);
                break;
            default:
                throw new Error(`Unknown strategy type: ${strategyType}`);
        }

        // Register for reuse
        this.strategies.set(strategyKey, strategy);

        this.logger.info('Strategy created', {
            strategyType,
            hasConfig: !!config,
        });
        return strategy;
    }

    /**
     * Register custom strategy
     */
    static register(
        name: string,
        strategy: ReActStrategy | ReWooStrategy | PlanExecuteStrategy,
    ): void {
        this.strategies.set(name, strategy);
        this.logger.info('Custom strategy registered', { name });
    }

    /**
     * Get available strategies
     */
    static getAvailableStrategies(): StrategyType[] {
        return ['react', 'rewoo', 'plan-execute'];
    }

    /**
     * Check if strategy exists
     */
    static hasStrategy(name: string): boolean {
        return (
            this.strategies.has(name) ||
            this.getAvailableStrategies().includes(name as StrategyType)
        );
    }

    /**
     * Remove strategy
     */
    static removeStrategy(name: string): boolean {
        const removed = this.strategies.delete(name);
        if (removed) {
            this.logger.info('Strategy removed', { name });
        }
        return removed;
    }

    /**
     * Get strategy statistics
     */
    static getStats(): {
        totalStrategies: number;
        availableTypes: StrategyType[];
    } {
        return {
            totalStrategies: this.strategies.size,
            availableTypes: this.getAvailableStrategies(),
        };
    }

    /**
     * Clear all registered strategies
     */
    static clear(): void {
        this.strategies.clear();
        this.logger.info('All strategies cleared');
    }
}
