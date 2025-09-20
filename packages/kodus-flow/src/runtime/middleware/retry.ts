import {
    DEFAULT,
    HasCostCtx,
    Middleware,
    MiddlewareFactoryType,
    RetryOptions,
    TEvent,
} from '../../core/types/allTypes.js';
import { KernelError } from '../../core/errors.js';
import { getObservability } from '../../observability/index.js';

function backoff(attempt: number, opt: RetryOptions) {
    const { initialDelayMs, backoffFactor, jitter, maxDelayMs } = opt;
    const base = initialDelayMs * Math.pow(backoffFactor, attempt);
    const full = jitter ? Math.random() * base : base; // full-jitter
    return Math.min(full, maxDelayMs);
}

function isRetryable(err: unknown, opt: RetryOptions): boolean {
    // 1) predicado custom
    if (opt.retryPredicate?.(err)) return true;

    /* ---------- error.code ---------- */
    if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        typeof (err as { code?: unknown }).code === 'string'
    ) {
        const code = (err as { code: string }).code;
        // cast do array p/ readonly string[]  ➔ aceita qualquer string
        if ((opt.retryableErrorCodes as readonly string[]).includes(code)) {
            return true;
        }
    }

    /* ---------- error.status ---------- */
    if (
        err &&
        typeof err === 'object' &&
        'status' in err &&
        typeof (err as { status?: unknown }).status === 'number'
    ) {
        const st = (err as { status: number }).status;
        if (opt.retryableStatusCodes.includes(st)) return true;
    }

    return false;
}

function hasCostCtx(x: unknown): x is HasCostCtx {
    return typeof x === 'object' && x !== null && 'ctx' in x;
}

export const withRetry: MiddlewareFactoryType<Partial<RetryOptions>, TEvent> = (
    opts = {},
) => {
    const cfg: RetryOptions = { ...DEFAULT, ...opts };

    const middleware = function <E extends TEvent, R = TEvent | void>(
        handler: (ev: E, signal?: AbortSignal) => Promise<R> | R,
    ) {
        const wrapped = async function withRetryWrapped(
            ev: E,
            signal?: AbortSignal,
        ): Promise<R> {
            const span = getObservability().getCurrentSpan();
            let attempt = 0;
            const started = Date.now();

            while (true) {
                try {
                    if (handler.length === 1) {
                        return await (handler as (ev: E) => Promise<R> | R)(ev);
                    } else {
                        return await handler(ev, signal);
                    }
                } catch (err) {
                    attempt++;
                    span?.setAttribute('retry.attempt', attempt);

                    if (
                        attempt > cfg.maxRetries ||
                        Date.now() - started > cfg.maxTotalMs
                    ) {
                        throw new KernelError(
                            'RETRY_EXCEEDED',
                            'Max attempts exceeded',
                            {
                                cause: err as Error,
                                context: { eventType: ev.type, attempt },
                            },
                        );
                    }

                    if (!isRetryable(err, cfg)) throw err;

                    if (hasCostCtx(ev)) {
                        const cost =
                            ev.ctx!.cost ?? (ev.ctx!.cost = { retries: 0 });
                        cost.retries += 1;
                    }

                    const delay = backoff(attempt, cfg);
                    await new Promise<void>((res, rej) => {
                        const t = setTimeout(res, delay);
                        if (signal) {
                            signal.addEventListener(
                                'abort',
                                () => {
                                    clearTimeout(t);
                                    rej(new Error('ABORTED'));
                                },
                                { once: true },
                            );
                        }
                        if ('unref' in t) (t as NodeJS.Timeout).unref();
                    });
                }
            }
        };

        return wrapped;
    } as Middleware<TEvent>;

    middleware.kind = 'pipeline';
    (middleware as unknown as { displayName?: string }).displayName =
        'withRetry';

    return middleware;
};
