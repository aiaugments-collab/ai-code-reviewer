import { withRetry } from './retry.js';
import { withTimeout } from './timeout.js';
import { withConcurrency } from './concurrency.js';
import {
    AnyEvent,
    composeMiddleware,
    EventHandler,
    Middleware,
    StandardMiddlewareOptions,
    TEvent,
} from '../../core/types/allTypes.js';

export function createStandardMiddleware(
    options: StandardMiddlewareOptions = {},
): Middleware<TEvent> {
    const middlewares: Array<Middleware<TEvent>> = [];

    // Add monitoring first to capture all metrics
    if (options.monitoring !== false) {
        // Monitoring middleware removed - not implemented yet
        // middlewares.push(withMonitoring() as Middleware<TEvent>);
    }

    // Add concurrency control
    if (options.concurrency) {
        middlewares.push(
            withConcurrency({
                maxConcurrent: options.concurrency,
            }) as unknown as Middleware<TEvent>,
        );
    }

    // Add timeout
    if (options.timeout) {
        middlewares.push(
            withTimeout({
                timeoutMs: options.timeout,
            }) as unknown as Middleware<TEvent>,
        );
    }

    // Add retry last so it retries the entire stack
    if (options.retry !== false) {
        const retryOptions =
            typeof options.retry === 'object' ? options.retry : {};
        middlewares.push(
            withRetry(retryOptions) as unknown as Middleware<TEvent>,
        );
    }

    return composeMiddleware(...middlewares);
}

/**
 * Create a resilient handler with error handling and retries
 */
export function createResilientHandler<TEvent extends AnyEvent = AnyEvent>(
    handler: EventHandler<TEvent>,
    options: {
        maxRetries?: number;
        timeout?: number;
        fallback?: EventHandler<TEvent>;
    } = {},
): EventHandler<TEvent> {
    const middleware = composeMiddleware<TEvent>(
        withTimeout({
            timeoutMs: options.timeout,
        }) as unknown as Middleware<TEvent>,
        withRetry({
            maxRetries: options.maxRetries,
        }) as unknown as Middleware<TEvent>,
    );

    const enhancedHandler = middleware(handler);

    if (options.fallback) {
        return async (event: TEvent) => {
            try {
                return await enhancedHandler(event);
            } catch {
                // Use fallback handler on error
                return await options.fallback!(event);
            }
        };
    }

    return enhancedHandler;
}

/**
 * Create a rate-limited handler
 */
export function createRateLimitedHandler<TEvent extends AnyEvent = AnyEvent>(
    handler: EventHandler<TEvent>,
    options: {
        maxPerSecond: number;
        burstSize?: number;
    },
): EventHandler<TEvent> {
    const intervalMs = 1000 / options.maxPerSecond;
    const burstSize = options.burstSize || options.maxPerSecond;

    let tokens = burstSize;
    let lastRefill = Date.now();

    return async (event: TEvent) => {
        const now = Date.now();
        const elapsed = now - lastRefill;
        const refillTokens = Math.floor(elapsed / intervalMs);

        if (refillTokens > 0) {
            tokens = Math.min(burstSize, tokens + refillTokens);
            lastRefill = now;
        }

        if (tokens <= 0) {
            throw new Error('Rate limit exceeded');
        }

        tokens--;
        return await handler(event);
    };
}

/**
 * Create a cached handler that memoizes results
 */
export function createCachedHandler<TEvent extends AnyEvent = AnyEvent>(
    handler: EventHandler<TEvent>,
    options: {
        ttl?: number;
        keyFn?: (event: TEvent) => string;
        maxSize?: number;
    } = {},
): EventHandler<TEvent> {
    const cache = new Map<
        string,
        { result: Awaited<ReturnType<typeof handler>>; timestamp: number }
    >();
    const ttl = options.ttl || 60000; // 1 minute default
    const maxSize = options.maxSize || 1000;
    const keyFn =
        options.keyFn || ((event: TEvent) => JSON.stringify(event.data));

    return async (event: TEvent) => {
        const key = keyFn(event);
        const cached = cache.get(key);

        if (cached && Date.now() - cached.timestamp < ttl) {
            return cached.result;
        }

        const result = await handler(event);

        // Evict oldest entries if cache is full
        if (cache.size >= maxSize) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey) {
                cache.delete(oldestKey);
            }
        }

        cache.set(key, { result, timestamp: Date.now() });
        return result;
    };
}

/**
 * Create a handler with circuit breaker pattern
 */
export function createCircuitBreakerHandler<TEvent extends AnyEvent = AnyEvent>(
    handler: EventHandler<TEvent>,
    options: {
        failureThreshold?: number;
        resetTimeout?: number;
        halfOpenRequests?: number;
    } = {},
): EventHandler<TEvent> {
    const failureThreshold = options.failureThreshold || 5;
    const resetTimeout = options.resetTimeout || 60000; // 1 minute
    const halfOpenRequests = options.halfOpenRequests || 1;

    let failures = 0;
    let lastFailureTime = 0;
    let state: 'closed' | 'open' | 'half-open' = 'closed';
    let halfOpenAttempts = 0;

    return async (event: TEvent) => {
        // Check if circuit should be reset
        if (state === 'open' && Date.now() - lastFailureTime > resetTimeout) {
            state = 'half-open';
            halfOpenAttempts = 0;
        }

        // Reject if circuit is open
        if (state === 'open') {
            throw new Error('Circuit breaker is open');
        }

        // Limit requests in half-open state
        if (state === 'half-open') {
            halfOpenAttempts++;
            if (halfOpenAttempts > halfOpenRequests) {
                state = 'open';
                throw new Error('Circuit breaker is open');
            }
        }

        try {
            const result = await handler(event);

            // Success: reset failures and close circuit
            failures = 0;
            if (state === 'half-open') {
                state = 'closed';
            }

            return result;
        } catch (error) {
            failures++;
            lastFailureTime = Date.now();

            if (failures >= failureThreshold) {
                state = 'open';
            }

            throw error;
        }
    };
}
