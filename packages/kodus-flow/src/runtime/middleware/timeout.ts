import {
    AnyEvent,
    DEFAULT_TIMEOUT_MS,
    EventHandler,
    Middleware,
    MiddlewareFactoryType,
    TEvent,
    TimeoutOptions,
} from '../../core/types/allTypes.js';
import { KernelError } from '../../core/errors.js';

/**
 * Options for the timeout middleware
 */

export const withTimeout: MiddlewareFactoryType<
    TimeoutOptions | undefined,
    TEvent
> = (options: TimeoutOptions | undefined) => {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const middleware = (<T extends TEvent>(
        handler: EventHandler<T>,
    ): EventHandler<T> => {
        const withTimeoutWrapped = (event: T): Promise<void | AnyEvent> => {
            return new Promise<void | AnyEvent>((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(
                        new KernelError(
                            'TIMEOUT_EXCEEDED',
                            `Handler timed out after ${timeoutMs}ms`,
                        ),
                    );
                }, timeoutMs);

                Promise.resolve(handler(event))
                    .then((result) => {
                        clearTimeout(timeoutId);
                        resolve(result);
                    })
                    .catch((error) => {
                        clearTimeout(timeoutId);
                        reject(error);
                    });
            });
        };

        return withTimeoutWrapped;
    }) as Middleware<TEvent>;

    middleware.kind = 'pipeline';
    (middleware as unknown as { displayName?: string }).displayName =
        'withTimeout';

    return middleware;
};
