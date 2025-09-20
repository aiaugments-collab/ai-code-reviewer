import {
    AnyEvent,
    EVENT_TYPES,
    EventStream,
} from '../../core/types/allTypes.js';

export class StreamManager {
    private generators = new Map<
        AsyncGenerator<AnyEvent>,
        {
            lastAccess: number;
            isActive: boolean;
        }
    >();

    /**
     * Criar stream a partir de generator
     */
    createStream<S extends AnyEvent>(
        generator: () => AsyncGenerator<S>,
    ): EventStream<S> {
        const gen = generator();
        this.trackGenerator(gen);

        const stream: EventStream<S> = {
            [Symbol.asyncIterator]: () => this.wrapGenerator(gen),
            filter: (pred: (e: S) => boolean) =>
                this.createFilter(stream, pred),
            map: <T extends AnyEvent>(m: (e: S) => T) =>
                this.createMap(stream, m),
            until: (p: (e: S) => boolean) => this.createUntil(stream, p),
            takeUntil: (p: (e: S) => boolean) =>
                this.createTakeUntil(stream, p),
            toArray: () => this.createToArray(stream),
            withMiddleware: (_middleware: unknown) =>
                this.createWithMiddleware(stream),
            debounce: (delayMs: number) => this.createDebounce(stream, delayMs),
            throttle: (intervalMs: number) =>
                this.createThrottle(stream, intervalMs),
            batch: (size: number, timeoutMs?: number) =>
                this.createBatch(stream, size, timeoutMs),
            merge: (...streams: EventStream<S>[]) =>
                this.createMerge(stream, ...streams),
            combineLatest: (...streams: EventStream<S>[]) =>
                this.createCombineLatest(stream, ...streams),
        };

        return stream;
    }

    /**
     * Rastrear generator para cleanup
     */
    private trackGenerator(generator: AsyncGenerator<AnyEvent>): void {
        this.generators.set(generator, {
            lastAccess: Date.now(),
            isActive: true,
        });
    }

    /**
     * Wrapper do generator com cleanup
     */
    private async *wrapGenerator<T extends AnyEvent>(
        generator: AsyncGenerator<T>,
    ): AsyncGenerator<T> {
        try {
            for await (const value of generator) {
                // Atualizar último acesso
                const info = this.generators.get(generator);
                if (info) {
                    info.lastAccess = Date.now();
                }
                yield value;
            }
        } finally {
            // Marcar como inativo
            const info = this.generators.get(generator);
            if (info) {
                info.isActive = false;
            }

            try {
                await generator.return(undefined);
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * Criar operador filter
     */
    private createFilter<S extends AnyEvent>(
        base: EventStream<S>,
        pred: (e: S) => boolean,
        options?: { signal?: AbortSignal },
    ): EventStream<S> {
        return this.createStream(async function* () {
            for await (const ev of base) {
                if (options?.signal?.aborted) {
                    break;
                }
                if (pred(ev)) yield ev;
            }
        });
    }

    /**
     * Criar operador map
     */
    private createMap<S extends AnyEvent, T extends AnyEvent>(
        base: EventStream<S>,
        m: (e: S) => T,
        options?: { signal?: AbortSignal },
    ): EventStream<T> {
        return this.createStream(async function* () {
            for await (const ev of base) {
                if (options?.signal?.aborted) {
                    break;
                }
                yield m(ev);
            }
        });
    }

    /**
     * Criar operador until
     */
    private createUntil<S extends AnyEvent>(
        base: EventStream<S>,
        p: (e: S) => boolean,
        options?: { signal?: AbortSignal },
    ): EventStream<S> {
        return this.createStream(async function* () {
            for await (const ev of base) {
                if (options?.signal?.aborted) {
                    break;
                }
                yield ev;
                if (p(ev)) break;
            }
        });
    }

    /**
     * Criar operador takeUntil
     */
    private createTakeUntil<S extends AnyEvent>(
        base: EventStream<S>,
        p: (e: S) => boolean,
        options?: { signal?: AbortSignal },
    ): EventStream<S> {
        return this.createStream(async function* () {
            for await (const ev of base) {
                if (options?.signal?.aborted) {
                    break;
                }
                if (p(ev)) break;
                yield ev;
            }
        });
    }

    /**
     * Criar operador toArray
     */
    private createToArray<S extends AnyEvent>(
        base: EventStream<S>,
        options?: { signal?: AbortSignal },
    ): Promise<S[]> {
        return (async () => {
            const out: S[] = [];
            for await (const ev of base) {
                if (options?.signal?.aborted) {
                    break;
                }
                out.push(ev);
            }
            return out;
        })();
    }

    /**
     * Criar operador withMiddleware
     */
    private createWithMiddleware<S extends AnyEvent>(
        base: EventStream<S>,
        options?: { signal?: AbortSignal },
    ): EventStream<S> {
        return this.createStream(async function* () {
            for await (const ev of base) {
                if (options?.signal?.aborted) {
                    break;
                }
                try {
                    yield ev;
                } catch (error) {
                    throw error;
                }
            }
        });
    }

    /**
     * Criar operador debounce
     */
    private createDebounce<S extends AnyEvent>(
        base: EventStream<S>,
        delayMs: number,
        options?: { signal?: AbortSignal },
    ): EventStream<S> {
        return this.createStream(async function* () {
            let lastEvent: S | null = null;
            let lastEmitTime = 0;

            for await (const ev of base) {
                if (options?.signal?.aborted) {
                    break;
                }

                lastEvent = ev;
                const now = Date.now();

                // Se passou tempo suficiente desde o último emit, emitir imediatamente
                if (now - lastEmitTime >= delayMs) {
                    lastEmitTime = now;
                    yield ev;
                }
            }

            // Se não emitiu o último evento, aguardar o delay e emitir
            if (lastEvent && Date.now() - lastEmitTime < delayMs) {
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, delayMs);
                });
                yield lastEvent;
            }
        });
    }

    /**
     * Criar operador throttle
     */
    private createThrottle<S extends AnyEvent>(
        base: EventStream<S>,
        intervalMs: number,
        options?: { signal?: AbortSignal },
    ): EventStream<S> {
        return this.createStream(async function* () {
            let lastEmitTime = 0;

            for await (const ev of base) {
                if (options?.signal?.aborted) {
                    break;
                }
                const now = Date.now();
                if (now - lastEmitTime >= intervalMs) {
                    lastEmitTime = now;
                    yield ev;
                }
            }
        });
    }

    /**
     * Criar operador batch
     */
    private createBatch<S extends AnyEvent>(
        base: EventStream<S>,
        size: number,
        timeoutMs?: number,
        options?: { signal?: AbortSignal },
    ): EventStream<AnyEvent> {
        return this.createStream(async function* () {
            let buffer: S[] = [];
            let batchStartTime = Date.now();

            for await (const ev of base) {
                if (options?.signal?.aborted) {
                    break;
                }
                buffer.push(ev);
                const now = Date.now();

                // Verificar se deve emitir batch
                const hasReachedSize = buffer.length >= size;
                const hasReachedTimeout =
                    timeoutMs && now - batchStartTime >= timeoutMs;
                const hasMinimumSize = buffer.length > 0;

                if ((hasReachedSize || hasReachedTimeout) && hasMinimumSize) {
                    yield {
                        type: EVENT_TYPES.STREAM_BATCH,
                        data: {
                            events: [...buffer],
                            size: buffer.length,
                            timestamp: now,
                            batchStartTime,
                            batchDuration: now - batchStartTime,
                        },
                        ts: now,
                    } as AnyEvent;

                    buffer = [];
                    batchStartTime = now; // Reset timer para próximo batch
                }
            }

            // Emitir eventos restantes se houver
            if (buffer.length > 0) {
                const now = Date.now();
                yield {
                    type: EVENT_TYPES.STREAM_BATCH,
                    data: {
                        events: [...buffer],
                        size: buffer.length,
                        timestamp: now,
                        batchStartTime,
                        batchDuration: now - batchStartTime,
                    },
                    ts: now,
                } as AnyEvent;
            }
        });
    }

    /**
     * Cleanup de recursos
     */
    async cleanup(): Promise<void> {
        const generators = Array.from(this.generators.entries());

        for (const [generator] of generators) {
            try {
                await generator.return(undefined);
            } catch {
                // Ignore cleanup errors
            }
        }

        this.generators.clear();
    }

    /**
     * Obter estatísticas
     */
    getStats() {
        const now = Date.now();
        const staleThreshold = 5 * 60 * 1000; // 5 minutos

        let activeCount = 0;
        let staleCount = 0;

        for (const [, info] of this.generators.entries()) {
            // Verificar se está ativo
            if (info.isActive) {
                activeCount++;
            }

            // Verificar se está obsoleto
            if (now - info.lastAccess > staleThreshold) {
                staleCount++;
            }
        }

        return {
            activeGenerators: activeCount,
            staleGenerators: staleCount,
            totalTracked: this.generators.size,
        };
    }

    /**
     * Criar operador merge
     */
    createMerge<S extends AnyEvent>(
        base: EventStream<S>,
        ...streams: EventStream<S>[]
    ): EventStream<S> {
        return this.createStream(async function* () {
            const allStreams = [base, ...streams];
            const iterators = allStreams.map((stream) =>
                stream[Symbol.asyncIterator](),
            );
            const pending = new Map<number, Promise<IteratorResult<S>>>();

            // Start all iterators
            iterators.forEach((iterator, index) => {
                pending.set(index, iterator.next());
            });

            while (pending.size > 0) {
                // Wait for any iterator to produce a value
                const entries = Array.from(pending.entries());
                const promises = entries.map(([index, promise]) =>
                    promise.then((result) => ({ index, result })),
                );

                const { index, result } = await Promise.race(promises);

                if (result.done) {
                    // This iterator is finished
                    pending.delete(index);
                } else {
                    // Yield the value and continue with this iterator
                    yield result.value;
                    const iterator = iterators[index];
                    if (iterator) {
                        pending.set(index, iterator.next());
                    }
                }
            }
        });
    }

    /**
     * Criar operador combineLatest
     */
    createCombineLatest<S extends AnyEvent>(
        base: EventStream<S>,
        ...streams: EventStream<S>[]
    ): EventStream<AnyEvent> {
        return this.createStream(async function* () {
            const allStreams = [base, ...streams];
            const latest = new Map<number, S>();
            const iterators = allStreams.map((stream) =>
                stream[Symbol.asyncIterator](),
            );
            const pending = new Map<number, Promise<IteratorResult<S>>>();

            // Start all iterators
            iterators.forEach((iterator, index) => {
                pending.set(index, iterator.next());
            });

            while (pending.size > 0) {
                const entries = Array.from(pending.entries());
                const promises = entries.map(([index, promise]) =>
                    promise.then((result) => ({ index, result })),
                );

                const { index, result } = await Promise.race(promises);

                if (result.done) {
                    pending.delete(index);
                } else {
                    // Update latest value for this stream
                    latest.set(index, result.value);

                    // If we have at least one value from each stream, emit combined
                    if (latest.size === allStreams.length) {
                        const combined: S[] = [];
                        for (let i = 0; i < allStreams.length; i++) {
                            const value = latest.get(i);
                            if (value !== undefined) {
                                combined.push(value);
                            }
                        }

                        // Emitir como evento combinado
                        yield {
                            type: EVENT_TYPES.STREAM_BATCH,
                            data: {
                                events: combined,
                                count: combined.length,
                                timestamp: Date.now(),
                            },
                            ts: Date.now(),
                        } as AnyEvent;
                    }

                    // Continue with this iterator
                    const iterator = iterators[index];
                    if (iterator) {
                        pending.set(index, iterator.next());
                    }
                }
            }
        });
    }
}
