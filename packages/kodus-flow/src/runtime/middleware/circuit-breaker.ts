import { CircuitBreaker } from '../core/circuit-breaker.js';
import { createLogger } from '../../observability/index.js';
import {
    CircuitBreakerConfig,
    CircuitBreakerMiddlewareConfig,
    CircuitResult,
    EventHandler,
    Middleware,
    MiddlewareFactoryType,
    TEvent,
} from '../../core/types/allTypes.js';
import { ObservabilitySystem } from '../../observability/observability.js';

export class CircuitBreakerManager {
    private circuits = new Map<string, CircuitBreaker>();

    constructor(private observability: ObservabilitySystem) {}

    getCircuit(config: CircuitBreakerConfig): CircuitBreaker {
        const key = config.name;

        if (!this.circuits.has(key)) {
            this.circuits.set(
                key,
                new CircuitBreaker(this.observability, config),
            );
        }

        return this.circuits.get(key)!;
    }

    /**
     * Obter todos os circuitos
     */
    getAllCircuits(): Map<string, CircuitBreaker> {
        return this.circuits;
    }

    /**
     * Resetar todos os circuitos
     */
    resetAll(): void {
        for (const circuit of this.circuits.values()) {
            circuit.reset();
        }
    }

    /**
     * Obter métricas de todos os circuitos
     */
    getAllMetrics(): Record<string, ReturnType<CircuitBreaker['getMetrics']>> {
        const metrics: Record<
            string,
            ReturnType<CircuitBreaker['getMetrics']>
        > = {};

        for (const [key, circuit] of this.circuits.entries()) {
            metrics[key] = circuit.getMetrics();
        }

        return metrics;
    }
}

/**
 * Factory para middleware de Circuit Breaker
 */
export const circuitBreakerMiddleware: MiddlewareFactoryType<
    CircuitBreakerMiddlewareConfig,
    TEvent
> = (config: CircuitBreakerMiddlewareConfig) => {
    const middleware = (<T extends TEvent>(
        handler: EventHandler<T>,
    ): EventHandler<T> => {
        // Criar observability mock simples
        const mockObservability = {
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {},
            },
            monitoring: {
                recordMetric: () => {},
                recordHistogram: () => {},
                incrementCounter: () => {},
            },
            telemetry: {
                startSpan: () => ({
                    end: () => {},
                    setAttribute: () => ({ end: () => {} }),
                    setAttributes: () => ({ end: () => {} }),
                    setStatus: () => ({ end: () => {} }),
                    recordException: () => ({ end: () => {} }),
                    addEvent: () => ({ end: () => {} }),
                    updateName: () => ({ end: () => {} }),
                }),
                recordException: () => {},
            },
        } as unknown as ObservabilitySystem;

        const manager = new CircuitBreakerManager(mockObservability);

        return async (event: T) => {
            // Determinar se deve proteger este evento
            if (config.shouldProtect && !config.shouldProtect(event)) {
                const result = await handler(event);
                return result;
            }

            // Gerar chave do circuito
            const circuitKey =
                config.circuitKey ||
                (config.keyGenerator
                    ? config.keyGenerator(event)
                    : event && typeof event === 'object' && 'type' in event
                      ? String(event.type)
                      : 'default');

            // Obter ou criar circuito
            const circuit = manager.getCircuit({
                ...config,
                name: circuitKey,
            });

            // Executar operação protegida
            const result = await circuit.execute(
                () => Promise.resolve(handler(event)),
                {
                    event,
                },
            );

            // Tratar rejeição
            if (result.rejected && config.onRejected) {
                config.onRejected(event, result);
            }

            // Se foi rejeitada, retornar erro
            if (result.rejected) {
                throw result.error;
            }

            // Se falhou, retornar erro
            if (result.error) {
                throw result.error;
            }

            // Retornar resultado
            return result.result;
        };
    }) as Middleware<TEvent>;

    middleware.kind = 'pipeline';
    (middleware as unknown as { displayName?: string }).displayName =
        'circuitBreaker';

    return middleware;
};

/**
 * Utilitários para Circuit Breaker
 */
export const circuitBreakerUtils = {
    /**
     * Gerar chave baseada no tipo de evento
     */
    keyByEventType: (event: unknown): string => {
        if (event && typeof event === 'object' && 'type' in event) {
            return String(event.type);
        }
        return 'default';
    },

    /**
     * Gerar chave baseada em múltiplos campos
     */
    keyByFields:
        (fields: string[]) =>
        (event: unknown): string => {
            if (!event || typeof event !== 'object') return 'default';

            const values = fields
                .map((field) => (event as Record<string, unknown>)[field])
                .filter((value) => value !== undefined)
                .map(String);

            return values.length > 0 ? values.join(':') : 'default';
        },

    /**
     * Proteger apenas eventos específicos
     */
    protectByType:
        (types: string[]) =>
        (event: unknown): boolean => {
            if (!event || typeof event !== 'object' || !('type' in event)) {
                return false;
            }
            return types.includes(String(event.type));
        },

    /**
     * Proteger eventos com latência alta
     */
    protectByLatency:
        (threshold: number) =>
        (event: unknown): boolean => {
            if (!event || typeof event !== 'object' || !('latency' in event)) {
                return false;
            }
            const latency = Number((event as Record<string, unknown>).latency);
            return !isNaN(latency) && latency > threshold;
        },

    /**
     * Callback padrão para rejeições
     */
    defaultOnRejected: (event: unknown, result: CircuitResult<unknown>) => {
        const logger = createLogger('circuit-breaker');
        logger.warn('Circuit breaker rejected operation', {
            event,
            circuit: result.state,
            error: result.error?.message,
        });
    },
};
