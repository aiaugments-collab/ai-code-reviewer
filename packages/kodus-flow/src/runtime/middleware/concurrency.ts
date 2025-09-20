import {
    ConcurrencyOptions,
    DEFAULT_OPTS,
    Middleware,
    TEvent,
} from '../../core/types/allTypes.js';

/* ───── ConcurrencyManager singleton ───── */
class ConcurrencyManager {
    private active = new Map<string, number>();
    private queues = new Map<string, Array<() => void>>();

    getCurrentCount(key: string) {
        return this.active.get(key) ?? 0;
    }
    stats() {
        return [...this.active.entries()];
    }

    async acquire(key: string, max: number, timeout = 0): Promise<() => void> {
        if (this.getCurrentCount(key) < max) {
            this.active.set(key, this.getCurrentCount(key) + 1);
            return () => this.release(key);
        }

        if (!timeout) throw new Error('CONCURRENCY_DROP');

        return new Promise<() => void>((resolve, reject) => {
            const queue = this.queues.get(key) ?? [];
            const continuation = () => {
                /* ocupa o slot e entrega o liberador */
                this.active.set(key, this.getCurrentCount(key) + 1);
                resolve(() => this.release(key));
            };
            queue.push(continuation);
            this.queues.set(key, queue);

            const tid = setTimeout(() => {
                const idx = queue.indexOf(continuation);
                if (idx !== -1) queue.splice(idx, 1);
                reject(new Error('CONCURRENCY_TIMEOUT'));
            }, timeout);
            if ('unref' in tid) (tid as NodeJS.Timeout).unref();
        });
    }

    private release(key: string) {
        const curr = this.getCurrentCount(key);
        if (curr <= 1) this.active.delete(key);
        else this.active.set(key, curr - 1);

        const queue = this.queues.get(key);
        if (queue?.length) queue.shift()!(); // acorda próximo
    }
}
const manager = new ConcurrencyManager();

/* ───── Middleware factory ───── */
export function withConcurrency(opts: Partial<ConcurrencyOptions> = {}) {
    const cfg = { ...DEFAULT_OPTS, ...opts };

    const middleware = function <E extends TEvent, R = TEvent | void>(
        handler: (ev: E) => Promise<R> | R,
    ) {
        const withConcurrencyWrapped = async function wrapped(
            ev: E,
        ): Promise<R | void> {
            const key = cfg.getKey ? cfg.getKey(ev) : ev.type;
            let release: () => void;

            try {
                release = await manager.acquire(
                    key,
                    cfg.maxConcurrent,
                    cfg.queueTimeoutMs,
                );
            } catch (err) {
                if (cfg.emitMetrics) {
                    if (!cfg.context) {
                        cfg.context = {};
                    }
                    if (!cfg.context.cost) {
                        cfg.context.cost = { concurrencyDrops: 0 };
                    }
                    cfg.context.cost.concurrencyDrops++;
                }
                throw err;
            }

            try {
                return await handler(ev);
            } finally {
                release();
            }
        };

        return withConcurrencyWrapped;
    } as Middleware<TEvent>;

    middleware.kind = 'pipeline';
    (middleware as unknown as { displayName?: string }).displayName =
        'withConcurrency';

    return middleware;
}
