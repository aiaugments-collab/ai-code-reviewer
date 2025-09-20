import type {
    StrategyExecutionContext,
    ExecutionResult,
    ExecutionStep,
    StopCondition,
} from './types.js';

/**
 * Base class para estratégias de execução
 * Implementa funcionalidade comum e define interface
 */
export abstract class BaseExecutionStrategy {
    /**
     * Executa a estratégia com o contexto fornecido
     */
    abstract execute(
        context: StrategyExecutionContext,
    ): Promise<ExecutionResult>;

    /**
     * Executa estratégia com stop conditions
     */
    protected async executeWithStopConditions(
        context: StrategyExecutionContext,
        stopConditions: StopCondition[],
        stepExecutor: (stepIndex: number) => Promise<ExecutionStep>,
    ): Promise<ExecutionStep[]> {
        const steps: ExecutionStep[] = [];
        let stepIndex = 0;

        while (true) {
            // Executa step
            const step = await stepExecutor(stepIndex);
            steps.push(step);

            // Verifica stop conditions
            const shouldStop = await this.checkStopConditions(
                stopConditions,
                steps,
                step,
                context,
            );
            if (shouldStop) {
                break;
            }

            stepIndex++;
        }

        return steps;
    }

    /**
     * Verifica se alguma stop condition foi atingida
     */
    protected async checkStopConditions(
        stopConditions: StopCondition[],
        steps: ExecutionStep[],
        currentStep: ExecutionStep,
        context: StrategyExecutionContext,
    ): Promise<boolean> {
        for (const condition of stopConditions) {
            const shouldStop = await condition({
                steps,
                currentStep,
                context,
            });

            if (shouldStop) {
                return true;
            }
        }

        return false;
    }

    /**
     * Cria um step de execução
     */
    protected createStep(
        type: ExecutionStep['type'],
        metadata: Partial<ExecutionStep['metadata']> = {},
    ): ExecutionStep {
        return {
            id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type,
            type2: 'organize',
            timestamp: Date.now(),
            status: 'pending',
            metadata: {
                ...metadata,
                strategy: this.constructor.name,
            },
        };
    }

    /**
     * Cria resultado de execução
     */
    protected createExecutionResult(
        strategy: string,
        steps: ExecutionStep[],
        output: unknown,
        startTime: number,
        success = true,
        error?: string,
    ): ExecutionResult {
        const endTime = Date.now();
        const executionTime = endTime - startTime;

        return {
            output,
            strategy: strategy as any,
            complexity: steps.length, // Simplificado: complexidade = número de steps
            executionTime,
            steps,
            success,
            error,
        };
    }
}
