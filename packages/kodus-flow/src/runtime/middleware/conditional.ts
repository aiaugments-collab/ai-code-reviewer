import {
    ConditionalMiddleware,
    ConditionUtils,
    MiddlewareCondition,
    MiddlewareConfig,
    MiddlewareContext,
    MiddlewareFactory,
    MiddlewareFunction,
} from '../../core/types/allTypes.js';
import type { ObservabilitySystem } from '../../observability/index.js';

/**
 * Utilitários para criar condições de middleware
 */
export class ConditionUtilsImpl implements ConditionUtils {
    /**
     * Aplicar middleware apenas para tipos específicos de evento
     */
    forEventTypes(types: string[]): MiddlewareCondition {
        return (context: MiddlewareContext) => {
            return types.includes(context.event.type);
        };
    }

    /**
     * Aplicar middleware apenas para eventos com prioridade específica
     */
    forPriority(
        minPriority: number,
        maxPriority?: number,
    ): MiddlewareCondition {
        return (context: MiddlewareContext) => {
            const priority =
                ((context.event.data as Record<string, unknown>)
                    ?.priority as number) ||
                (context.metadata?.priority as number) ||
                0;
            if (maxPriority !== undefined) {
                return priority >= minPriority && priority <= maxPriority;
            }
            return priority >= minPriority;
        };
    }

    /**
     * Aplicar middleware apenas para eventos com tamanho específico
     */
    forEventSize(minSize: number, maxSize?: number): MiddlewareCondition {
        return (context: MiddlewareContext) => {
            const eventSize = JSON.stringify(context.event).length;
            if (maxSize !== undefined) {
                return eventSize >= minSize && eventSize <= maxSize;
            }
            return eventSize >= minSize;
        };
    }

    /**
     * Aplicar middleware apenas para eventos com metadata específica
     */
    forMetadata(key: string, value: unknown): MiddlewareCondition {
        return (context: MiddlewareContext) => {
            return context.metadata?.[key] === value;
        };
    }

    /**
     * Aplicar middleware apenas para eventos com contexto específico
     */
    forContext(
        predicate: (context: MiddlewareContext) => boolean,
    ): MiddlewareCondition {
        return predicate;
    }

    /**
     * Aplicar middleware apenas em horários específicos
     */
    forTimeWindow(startHour: number, endHour: number): MiddlewareCondition {
        return () => {
            const now = new Date();
            const currentHour = now.getHours();
            return currentHour >= startHour && currentHour <= endHour;
        };
    }

    /**
     * Aplicar middleware apenas para eventos com origem específica
     */
    forOrigin(origins: string[]): MiddlewareCondition {
        return (context: MiddlewareContext) => {
            const origin =
                ((context.event.data as Record<string, unknown>)
                    ?.origin as string) || (context.metadata?.origin as string);
            return Boolean(origin && origins.includes(origin));
        };
    }

    /**
     * Aplicar middleware apenas para eventos com tenant específico
     */
    forTenant(tenants: string[]): MiddlewareCondition {
        return (context: MiddlewareContext) => {
            const tenant =
                ((context.event.data as Record<string, unknown>)
                    ?.tenant as string) || (context.metadata?.tenant as string);
            return Boolean(tenant && tenants.includes(tenant));
        };
    }

    /**
     * Combinar múltiplas condições com AND
     */
    and(...conditions: MiddlewareCondition[]): MiddlewareCondition {
        return async (context: MiddlewareContext) => {
            for (const condition of conditions) {
                const result = await condition(context);
                if (!result) return false;
            }
            return true;
        };
    }

    /**
     * Combinar múltiplas condições com OR
     */
    or(...conditions: MiddlewareCondition[]): MiddlewareCondition {
        return async (context: MiddlewareContext) => {
            for (const condition of conditions) {
                const result = await condition(context);
                if (result) return true;
            }
            return false;
        };
    }

    /**
     * Negar uma condição
     */
    not(condition: MiddlewareCondition): MiddlewareCondition {
        return async (context: MiddlewareContext) => {
            const result = await condition(context);
            return !result;
        };
    }

    /**
     * Aplicar middleware com probabilidade específica
     */
    withProbability(probability: number): MiddlewareCondition {
        return () => {
            return Math.random() < probability;
        };
    }

    /**
     * Aplicar middleware apenas para eventos críticos
     */
    forCriticalEvents(): MiddlewareCondition {
        return (context: MiddlewareContext) => {
            const priority =
                ((context.event.data as Record<string, unknown>)
                    ?.priority as number) ||
                (context.metadata?.priority as number) ||
                0;
            const isCritical = context.metadata?.critical === true;
            return priority >= 8 || isCritical;
        };
    }

    /**
     * Aplicar middleware apenas para eventos de debug
     */
    forDebugEvents(): MiddlewareCondition {
        return (context: MiddlewareContext) => {
            return (
                context.event.type.includes('debug') ||
                context.metadata?.debug === true
            );
        };
    }

    /**
     * Aplicar middleware apenas para eventos de produção
     */
    forProductionEvents(): MiddlewareCondition {
        return (context: MiddlewareContext) => {
            const environment = context.metadata?.environment || 'development';
            return environment === 'production';
        };
    }
}

/**
 * Factory para middlewares condicionais
 */
export class ConditionalMiddlewareFactory implements MiddlewareFactory {
    private conditions: ConditionUtils;
    private observability: ObservabilitySystem;

    constructor(observability: ObservabilitySystem) {
        this.conditions = new ConditionUtilsImpl();
        this.observability = observability;
    }

    /**
     * Criar middleware de retry condicional
     */
    createRetryMiddleware(
        config?: MiddlewareConfig['retry'],
    ): ConditionalMiddleware {
        const retryMiddleware: MiddlewareFunction = async (context, next) => {
            const maxAttempts = config?.maxAttempts || 3;
            const backoffMs = config?.backoffMs || 1000;

            let lastError: Error;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    await next();
                    return;
                } catch (error) {
                    lastError = error as Error;

                    if (attempt === maxAttempts) {
                        throw lastError;
                    }

                    // Sempre retry (simplificado)

                    // Backoff exponencial simples
                    const delay = backoffMs * Math.pow(2, attempt - 1);
                    await new Promise((resolve) => setTimeout(resolve, delay));

                    this.observability.log('warn', 'Retry attempt', {
                        attempt,
                        maxAttempts,
                        delay,
                        error: lastError.message,
                        eventType: context.event.type,
                    });
                }
            }
        };

        return {
            middleware: retryMiddleware,
            condition: this.conditions.forCriticalEvents(),
            name: 'conditional-retry',
            priority: 1,
        };
    }

    /**
     * Criar middleware de timeout condicional
     */
    createTimeoutMiddleware(
        config?: MiddlewareConfig['timeout'],
    ): ConditionalMiddleware {
        const timeoutMiddleware: MiddlewareFunction = async (context, next) => {
            const timeoutMs = config?.ms || 30000;

            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Operation timed out'));
                }, timeoutMs);
            });

            try {
                await Promise.race([next(), timeoutPromise]);
            } catch (error) {
                this.observability.log('error', 'Timeout error', {
                    error: (error as Error).message,
                    eventType: context.event.type,
                    timeoutMs,
                });
                throw error;
            }
        };

        return {
            middleware: timeoutMiddleware,
            condition: this.conditions.forEventTypes(['api', 'external']),
            name: 'conditional-timeout',
            priority: 2,
        };
    }

    /**
     * Criar middleware de concorrência condicional
     */

    /**
     * Criar middleware de validação condicional
     */

    createConcurrencyMiddleware(
        config?: MiddlewareConfig['concurrency'],
    ): ConditionalMiddleware {
        const concurrencyMap = new Map<string, number>();
        const maxConcurrent = config?.maxConcurrent || 10;

        const concurrencyMiddleware: MiddlewareFunction = async (
            _context,
            next,
        ) => {
            const current = concurrencyMap.get('default') || 0;

            if (current >= maxConcurrent) {
                throw new Error('CONCURRENCY_LIMIT_EXCEEDED');
            }

            concurrencyMap.set('default', current + 1);

            try {
                await next();
            } finally {
                const current = concurrencyMap.get('default') || 0;
                concurrencyMap.set('default', Math.max(0, current - 1));
            }
        };

        return {
            middleware: concurrencyMiddleware,
            condition: this.conditions.forEventTypes(['database', 'external']),
            name: 'conditional-concurrency',
            priority: 3,
        };
    }

    /**
     * Criar middleware de observabilidade condicional
     */
    createObservabilityMiddleware(
        config?: MiddlewareConfig['observability'],
    ): ConditionalMiddleware {
        const observabilityMiddleware: MiddlewareFunction = async (
            context,
            next,
        ) => {
            const startTime = Date.now();
            const logLevel = config?.level || 'info';

            try {
                this.observability.log(
                    logLevel,
                    'Middleware execution started',
                );

                await next();

                this.observability.log(
                    logLevel,
                    'Middleware execution completed',
                );
            } catch (error) {
                const executionTime = Date.now() - startTime;
                this.observability.log('error', 'Middleware execution failed', {
                    error: (error as Error).message,
                    middleware: 'observability',
                    eventType: context.event.type,
                    executionTime,
                });
                throw error;
            }
        };

        return {
            middleware: observabilityMiddleware,
            condition: this.conditions.withProbability(0.1), // 10% dos eventos
            name: 'conditional-observability',
            priority: 10,
        };
    }

    /**
     * Criar middleware customizado condicional
     */
    createCustomMiddleware(
        middleware: MiddlewareFunction,
    ): ConditionalMiddleware {
        return {
            middleware,
            condition: () => true, // Sempre aplica
            name: 'custom-conditional',
            priority: 5,
        };
    }

    // ✅ SIMPLIFIED - Removidos middlewares complexos não essenciais
}

/**
 * Executor de middlewares condicionais
 */
export class ConditionalMiddlewareExecutor {
    private observability: ObservabilitySystem;
    private stats = new Map<
        string,
        { applied: number; skipped: number; errors: number }
    >();

    constructor(observability: ObservabilitySystem) {
        this.observability = observability;
    }

    /**
     * Executar pipeline de middlewares condicionais
     */
    async execute(
        middlewares: ConditionalMiddleware[],
        context: MiddlewareContext,
    ): Promise<void> {
        // Ordenar por prioridade (menor = maior prioridade)
        const sortedMiddlewares = [...middlewares].sort(
            (a, b) => (a.priority || 5) - (b.priority || 5),
        );

        let index = 0;
        const executeNext = async (): Promise<void> => {
            if (index >= sortedMiddlewares.length) {
                return;
            }

            const conditional = sortedMiddlewares[index++];
            if (!conditional) {
                return;
            }
            const middlewareName = conditional.name || 'anonymous';

            try {
                // Verificar condição
                const shouldApply = await conditional.condition(context);

                if (shouldApply) {
                    // Atualizar estatísticas
                    const stats = this.stats.get(middlewareName) || {
                        applied: 0,
                        skipped: 0,
                        errors: 0,
                    };
                    stats.applied++;
                    this.stats.set(middlewareName, stats);

                    this.observability.log(
                        'debug',
                        'Applying conditional middleware',
                        {
                            middleware: middlewareName,
                            eventType: context.event.type,
                            priority: conditional.priority,
                        },
                    );

                    // Executar middleware
                    await conditional.middleware(context, executeNext);
                } else {
                    // Atualizar estatísticas
                    const stats = this.stats.get(middlewareName) || {
                        applied: 0,
                        skipped: 0,
                        errors: 0,
                    };
                    stats.skipped++;
                    this.stats.set(middlewareName, stats);

                    this.observability.log(
                        'debug',
                        'Skipping conditional middleware',
                        {
                            middleware: middlewareName,
                            eventType: context.event.type,
                            reason: 'condition_not_met',
                        },
                    );

                    // Pular middleware e continuar
                    await executeNext();
                }
            } catch (error) {
                // Atualizar estatísticas
                const stats = this.stats.get(middlewareName) || {
                    applied: 0,
                    skipped: 0,
                    errors: 0,
                };
                stats.errors++;
                this.stats.set(middlewareName, stats);

                this.observability.log(
                    'error',
                    'Conditional middleware error',
                    {
                        error: (error as Error).message,
                        middleware: middlewareName,
                        eventType: context.event.type,
                    },
                );

                throw error;
            }
        };

        await executeNext();
    }

    /**
     * Obter estatísticas de execução
     */
    getStats() {
        return Object.fromEntries(this.stats);
    }

    /**
     * Limpar estatísticas
     */
    clearStats() {
        this.stats.clear();
    }
}

// Exportar instância global dos utilitários
export const conditionUtils = new ConditionUtilsImpl();
