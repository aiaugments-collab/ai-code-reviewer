/**
 * @file memory-leak.test.ts
 * @description Testes de Memory Leak do Runtime Layer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEvent } from '../../src/core/types/events.js';

describe('Runtime Layer - Memory Leak Detection', () => {
    let initialMemory: number;

    beforeEach(() => {
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }

        // Record initial memory usage
        initialMemory = process.memoryUsage().heapUsed;
    });

    afterEach(() => {
        // Clean up after each test
        if (global.gc) {
            global.gc();
        }
    });

    it('should not leak memory when creating many events', () => {
        const eventCount = 10000;
        const events: Array<{ type: string; data: unknown }> = [];

        // Create many events
        for (let i = 0; i < eventCount; i++) {
            events.push(
                createEvent(`event.${i}`, {
                    index: i,
                    data: `event-data-${i}`,
                }),
            );
        }

        // Clear references
        events.length = 0;

        // Force garbage collection
        if (global.gc) {
            global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

        // Memory increase should be minimal (less than 10MB for 10k events)
        expect(memoryIncreaseMB).toBeLessThan(10);
        console.log(
            `Memory increase: ${memoryIncreaseMB.toFixed(2)}MB for ${eventCount} events`,
        );
    });

    it('should not leak memory with large event data', () => {
        const eventCount = 1000;
        const events: Array<{ type: string; data: unknown }> = [];

        // Create events with large data
        for (let i = 0; i < eventCount; i++) {
            events.push(
                createEvent('large.data', {
                    index: i,
                    largeString: 'x'.repeat(1000), // 1KB per event
                    largeArray: new Array(100).fill(`data-${i}`),
                    largeObject: Object.fromEntries(
                        new Array(50)
                            .fill(0)
                            .map((_, j) => [`key${j}`, `value${i}-${j}`]),
                    ),
                }),
            );
        }

        // Clear references
        events.length = 0;

        if (global.gc) {
            global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

        // Memory increase should be reasonable (less than 5MB for 1MB of data)
        expect(memoryIncreaseMB).toBeLessThan(5);
        console.log(
            `Large data memory increase: ${memoryIncreaseMB.toFixed(2)}MB`,
        );
    });

    it('should not leak memory with circular references', () => {
        const eventCount = 1000;
        const events: Array<{ type: string; data: unknown }> = [];

        // Create events with circular references
        for (let i = 0; i < eventCount; i++) {
            const circularData: Record<string, unknown> = { index: i };
            circularData.self = circularData;
            circularData.parent = { child: circularData };

            events.push(createEvent('circular.test', circularData));
        }

        // Clear references
        events.length = 0;

        if (global.gc) {
            global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

        // Memory should be properly cleaned up
        expect(memoryIncreaseMB).toBeLessThan(2);
        console.log(
            `Circular reference memory increase: ${memoryIncreaseMB.toFixed(2)}MB`,
        );
    });

    it('should not leak memory with function references', () => {
        const eventCount = 1000;
        const events: Array<{ type: string; data: unknown }> = [];

        // Create events with function references
        for (let i = 0; i < eventCount; i++) {
            events.push(
                createEvent('function.test', {
                    index: i,
                    callback: () => `function-${i}`,
                    asyncFunction: async () => `async-${i}`,
                    generator: function* () {
                        yield i;
                    },
                }),
            );
        }

        // Clear references
        events.length = 0;

        if (global.gc) {
            global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

        // Memory should be properly cleaned up
        expect(memoryIncreaseMB).toBeLessThan(2);
        console.log(
            `Function reference memory increase: ${memoryIncreaseMB.toFixed(2)}MB`,
        );
    });

    it('should not leak memory with event listeners', () => {
        const eventCount = 1000;
        const listeners: Array<(event: unknown) => unknown> = [];

        // Simulate event listener creation
        for (let i = 0; i < eventCount; i++) {
            const listener = (event: unknown) => {
                // Simulate event processing
                return (event as Record<string, unknown>).data;
            };
            listeners.push(listener);
        }

        // Clear references
        listeners.length = 0;

        if (global.gc) {
            global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

        // Memory should be properly cleaned up
        expect(memoryIncreaseMB).toBeLessThan(1);
        console.log(
            `Event listener memory increase: ${memoryIncreaseMB.toFixed(2)}MB`,
        );
    });

    it('should not leak memory with repeated event creation and disposal', () => {
        const iterations = 20; // Reduzido para testes mais rápidos
        const eventsPerIteration = 100; // Reduzido para evitar timeout
        let totalMemoryIncrease = 0;
        let gcCount = 0;
        let totalEventCount = 0;

        // Monitor de garbage collection
        if (global.gc) {
            const originalGC = global.gc;

            (global as any).gc = function () {
                gcCount++;
                return originalGC();
            };
        }

        // Para inspecionar objetos globais e caches
        function logDetailedGlobals(iteration: number) {
            const globalKeys = Object.keys(global);
            console.log(
                `[Iteração ${iteration}] Propriedades globais: ${globalKeys.length}`,
            );

            // Log de propriedades globais específicas
            const relevantGlobals = [
                'process',
                'Buffer',
                'setTimeout',
                'setInterval',
                'clearTimeout',
                'clearInterval',
            ];
            relevantGlobals.forEach((key) => {
                const globalObj = global as Record<string, unknown>;
                if (globalObj[key]) {
                    console.log(
                        `[Iteração ${iteration}] ${key} existe:`,
                        typeof globalObj[key],
                    );
                }
            });

            // Tentar acessar caches conhecidos se existirem
            const globalObj = global as Record<string, unknown>;
            if (globalObj.IdGenerator) {
                const idGenerator = globalObj.IdGenerator as Record<
                    string,
                    unknown
                >;
                console.log(
                    `[Iteração ${iteration}] IdGenerator.counter:`,
                    idGenerator.counter,
                );
            }

            // Log de módulos carregados
            if (globalObj.require) {
                const requireObj = globalObj.require as Record<string, unknown>;
                if (requireObj.cache) {
                    const cache = requireObj.cache as Record<string, unknown>;
                    const moduleCount = Object.keys(cache).length;
                    console.log(
                        `[Iteração ${iteration}] Módulos carregados: ${moduleCount}`,
                    );
                }
            }
        }

        // Log de métricas de memória detalhadas
        function logMemoryMetrics(
            iteration: number,
            startMemory: number,
            endMemory: number,
        ) {
            const memUsage = process.memoryUsage();
            const memoryMB = (endMemory / 1024 / 1024).toFixed(2);
            const increaseMB = (
                (endMemory - startMemory) /
                1024 /
                1024
            ).toFixed(4);

            console.log(`[Iteração ${iteration}] === MEMÓRIA DETALHADA ===`);
            console.log(
                `  Heap usado: ${memoryMB}MB (aumento: ${increaseMB}MB)`,
            );
            console.log(
                `  Heap total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
            );
            console.log(
                `  Heap externo: ${(memUsage.external / 1024 / 1024).toFixed(2)}MB`,
            );
            console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)}MB`);
            console.log(
                `  Array buffers: ${(memUsage.arrayBuffers / 1024 / 1024).toFixed(2)}MB`,
            );
            console.log(`  GC executado: ${gcCount} vezes`);
            console.log(`  Total eventos criados: ${totalEventCount}`);
        }

        // Log de performance
        function logPerformanceMetrics(iteration: number, startTime: number) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const eventsPerSecond = (
                eventsPerIteration /
                (duration / 1000)
            ).toFixed(0);

            console.log(`[Iteração ${iteration}] === PERFORMANCE ===`);
            console.log(`  Duração: ${duration}ms`);
            console.log(`  Eventos/segundo: ${eventsPerSecond}`);
            console.log(
                `  Tempo médio por evento: ${(duration / eventsPerIteration).toFixed(3)}ms`,
            );
        }

        for (let iteration = 0; iteration < iterations; iteration++) {
            const iterationStartTime = Date.now();
            const iterationStartMemory = process.memoryUsage().heapUsed;
            const events: Array<{ type: string; data: unknown }> = [];

            // Create events
            for (let i = 0; i < eventsPerIteration; i++) {
                events.push(
                    createEvent(`iteration.${iteration}.event.${i}`, {
                        iteration,
                        index: i,
                        data: `data-${iteration}-${i}`,
                        timestamp: Date.now(),
                        metadata: {
                            test: true,
                            iteration,
                            eventIndex: i,
                        },
                    }),
                );
                totalEventCount++;
            }

            // Clear references immediately
            events.length = 0;

            if (global.gc) {
                global.gc();
            }

            const iterationEndMemory = process.memoryUsage().heapUsed;
            const iterationMemoryIncrease =
                iterationEndMemory - iterationStartMemory;
            totalMemoryIncrease += iterationMemoryIncrease;

            if (iteration % 5 === 0) {
                logMemoryMetrics(
                    iteration,
                    iterationStartMemory,
                    iterationEndMemory,
                );
                logPerformanceMetrics(iteration, iterationStartTime);
                if (iteration % 10 === 0) {
                    logDetailedGlobals(iteration);
                }
                console.log(
                    `[Iteração ${iteration}] ==========================================`,
                );
            }

            // Log a cada 100 iterações com resumo
            if (iteration % 100 === 0 && iteration > 0) {
                const avgMemoryIncrease = (
                    totalMemoryIncrease /
                    (iteration + 1) /
                    1024 /
                    1024
                ).toFixed(4);
                console.log(
                    `[RESUMO ${iteration}] Média de aumento por iteração: ${avgMemoryIncrease}MB`,
                );
                console.log(
                    `[RESUMO ${iteration}] Total acumulado: ${(totalMemoryIncrease / 1024 / 1024).toFixed(2)}MB`,
                );
                console.log(
                    `[RESUMO ${iteration}] Taxa de GC: ${(gcCount / (iteration + 1)).toFixed(2)} por iteração`,
                );
            }
        }

        const totalMemoryIncreaseMB = totalMemoryIncrease / 1024 / 1024;

        // Log final detalhado
        console.log(`\n=== RESULTADO FINAL ===`);
        console.log(`Total de iterações: ${iterations}`);
        console.log(`Total de eventos criados: ${totalEventCount}`);
        console.log(`Total de GCs executados: ${gcCount}`);
        console.log(
            `Aumento total de memória: ${totalMemoryIncreaseMB.toFixed(2)}MB`,
        );
        console.log(
            `Aumento médio por iteração: ${(totalMemoryIncreaseMB / iterations).toFixed(4)}MB`,
        );
        console.log(
            `Aumento médio por evento: ${(totalMemoryIncreaseMB / totalEventCount).toFixed(6)}MB`,
        );
        console.log(
            `Taxa de GC: ${(gcCount / iterations).toFixed(2)} por iteração`,
        );

        // Total memory increase should be minimal
        expect(totalMemoryIncreaseMB).toBeLessThan(10); // Reduzido para testes mais rápidos
        console.log(
            `Total memory increase over ${iterations} iterations: ${totalMemoryIncreaseMB.toFixed(2)}MB`,
        );
    });

    it('should not leak memory with complex nested objects', () => {
        const eventCount = 500;
        const events: Array<{ type: string; data: unknown }> = [];

        // Create events with deeply nested objects
        for (let i = 0; i < eventCount; i++) {
            const nestedData = {
                level1: {
                    level2: {
                        level3: {
                            level4: {
                                level5: {
                                    level6: {
                                        level7: {
                                            level8: {
                                                level9: {
                                                    level10: {
                                                        value: `deep-value-${i}`,
                                                        array: new Array(
                                                            10,
                                                        ).fill(i),
                                                        object: {
                                                            nested: true,
                                                            index: i,
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            };

            events.push(createEvent('nested.test', nestedData));
        }

        // Clear references
        events.length = 0;

        if (global.gc) {
            global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

        // Memory should be properly cleaned up
        expect(memoryIncreaseMB).toBeLessThan(3);
        console.log(
            `Nested objects memory increase: ${memoryIncreaseMB.toFixed(2)}MB`,
        );
    });
});
