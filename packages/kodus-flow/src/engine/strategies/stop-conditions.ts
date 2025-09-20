import type {
    StopCondition,
    ExecutionStep,
    StrategyExecutionContext,
} from './types.js';

// Stop Conditions (baseado em AI SDK Vercel/VoltAgent)
export const stopConditions = {
    // Maximum steps (like stepCountIs)
    maxSteps:
        (maxSteps: number): StopCondition =>
        ({ steps }) =>
            steps.length >= maxSteps,

    // Máximo de tool calls
    maxToolCalls:
        (maxToolCalls: number): StopCondition =>
        ({ steps }) =>
            steps.filter(
                (s) => s.type === 'act' && s.action?.type === 'tool_call',
            ).length >= maxToolCalls,

    // Tem resposta final
    hasFinalAnswer:
        (): StopCondition =>
        ({ currentStep }) =>
            currentStep.type === 'observe' &&
            currentStep.observation?.isComplete === true,

    // Máximo de tempo de execução
    maxExecutionTime:
        (maxTimeMs: number): StopCondition =>
        ({ context }) => {
            const startTime = context.metadata.startTime;
            return Date.now() - startTime >= maxTimeMs;
        },

    // Condição customizada
    custom:
        (
            predicate: (context: StrategyExecutionContext) => boolean,
        ): StopCondition =>
        ({ context }) =>
            predicate(context),

    // Combinação de condições (OR)
    any:
        (...conditions: StopCondition[]): StopCondition =>
        async (context) => {
            for (const condition of conditions) {
                if (await condition(context)) return true;
            }
            return false;
        },

    // Combinação de condições (AND)
    all:
        (...conditions: StopCondition[]): StopCondition =>
        async (context) => {
            for (const condition of conditions) {
                if (!(await condition(context))) return false;
            }
            return true;
        },

    // Para ReAct: Condições específicas
    react: {
        // Máximo de turns (iterações)
        maxTurns:
            (maxTurns: number): StopCondition =>
            ({ steps }) =>
                steps.filter((s) => s.type === 'think').length >= maxTurns,

        // Sem tool calls pendentes
        noPendingToolCalls:
            (): StopCondition =>
            ({ currentStep }) =>
                currentStep.type === 'observe' &&
                currentStep.observation?.shouldContinue === false,

        // Resposta final encontrada
        finalAnswerFound:
            (): StopCondition =>
            ({ currentStep }) =>
                currentStep.type === 'observe' &&
                currentStep.observation?.isComplete === true,
    },

    // Para ReWoo: Condições específicas
    rewoo: {
        // Plano completo executado
        planComplete:
            (): StopCondition =>
            ({ steps }) => {
                const planSteps = steps.filter((s) => s.type === 'plan');
                const executeSteps = steps.filter((s) => s.type === 'execute');
                const synthesizeSteps = steps.filter(
                    (s) => s.type === 'synthesize',
                );

                return (
                    planSteps.length > 0 &&
                    executeSteps.length > 0 &&
                    synthesizeSteps.length > 0
                );
            },

        // Máximo de steps do plano
        maxPlanSteps:
            (maxSteps: number): StopCondition =>
            ({ steps }) =>
                steps.filter((s) => s.type === 'execute').length >= maxSteps,

        // Síntese completa
        synthesisComplete:
            (): StopCondition =>
            ({ currentStep }) =>
                currentStep.type === 'synthesize' &&
                currentStep.observation?.isComplete === true,
    },
};

// Helper para verificar stop conditions
export async function isStopConditionMet(
    conditions: StopCondition[],
    context: {
        steps: ExecutionStep[];
        currentStep: ExecutionStep;
        context: StrategyExecutionContext;
    },
): Promise<boolean> {
    for (const condition of conditions) {
        if (await condition(context)) {
            return true;
        }
    }
    return false;
}

// Factory para criar stop conditions comuns
export const createStopConditions = {
    // Para ReAct
    react: (config: {
        maxTurns?: number;
        maxToolCalls?: number;
        maxTimeMs?: number;
    }) => {
        const conditions: StopCondition[] = [];

        if (config.maxTurns) {
            conditions.push(stopConditions.react.maxTurns(config.maxTurns));
        }

        if (config.maxToolCalls) {
            conditions.push(stopConditions.maxToolCalls(config.maxToolCalls));
        }

        if (config.maxTimeMs) {
            conditions.push(stopConditions.maxExecutionTime(config.maxTimeMs));
        }

        // Sempre incluir condições de finalização
        conditions.push(stopConditions.react.finalAnswerFound());
        conditions.push(stopConditions.react.noPendingToolCalls());

        return conditions;
    },

    // Para ReWoo
    rewoo: (config: {
        maxPlanSteps?: number;
        maxToolCalls?: number;
        maxTimeMs?: number;
    }) => {
        const conditions: StopCondition[] = [];

        if (config.maxPlanSteps) {
            conditions.push(
                stopConditions.rewoo.maxPlanSteps(config.maxPlanSteps),
            );
        }

        if (config.maxToolCalls) {
            conditions.push(stopConditions.maxToolCalls(config.maxToolCalls));
        }

        if (config.maxTimeMs) {
            conditions.push(stopConditions.maxExecutionTime(config.maxTimeMs));
        }

        // Sempre incluir condições de finalização
        conditions.push(stopConditions.rewoo.planComplete());
        conditions.push(stopConditions.rewoo.synthesisComplete());

        return conditions;
    },
};
