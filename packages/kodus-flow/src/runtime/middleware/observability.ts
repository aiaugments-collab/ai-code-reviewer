import {
    EventHandler,
    Middleware,
    MiddlewareFactoryType,
    ObservabilityOptions,
    TEvent,
} from '../../core/types/allTypes.js';
import {
    getObservability,
    applyErrorToSpan,
    markSpanOk,
} from '../../observability/index.js';
import { SPAN_NAMES } from '../../observability/semantic-conventions.js';
import { isEnhancedError } from '../../core/error-unified.js';

/**
 * Middleware que cria um span por processamento de evento e registra erros
 */
export const withObservability: MiddlewareFactoryType<
    ObservabilityOptions | undefined,
    TEvent
> = (options: ObservabilityOptions | undefined) => {
    const include = options?.includeEventTypes?.length
        ? new Set(options.includeEventTypes)
        : undefined;
    const exclude = options?.excludeEventTypes?.length
        ? new Set(options.excludeEventTypes)
        : undefined;

    const middleware = (<T extends TEvent>(
        handler: EventHandler<T>,
    ): EventHandler<T> => {
        return async (event: T) => {
            const obs = getObservability();

            // Respeita filtros de tipo de evento
            if (include && !include.has(String(event.type))) {
                return handler(event);
            }
            if (exclude && exclude.has(String(event.type))) {
                return handler(event);
            }

            const attributes: Record<string, string | number> = {};
            attributes['runtime.event.type'] = String(event.type);
            attributes['tenant.id'] =
                (event.metadata?.tenantId as string) || 'unknown';
            const cid = (event.metadata?.correlationId as string) || 'unknown';
            attributes['correlation.id'] = cid;
            // Canonical attribute for filtering
            attributes['correlationId'] = cid;
            attributes['thread.id'] = event.threadId;
            attributes['event.ts'] = event.ts;

            const span = obs.startSpan(SPAN_NAMES.WORKFLOW_STEP, {
                attributes,
            });

            try {
                return await obs.withSpan(span, async () => {
                    try {
                        const result = await handler(event);
                        markSpanOk(span);
                        return result;
                    } catch (err) {
                        const errorAttributes: Record<
                            string,
                            string | number | boolean
                        > = {};
                        errorAttributes['runtime.event.type'] = String(
                            event.type,
                        );
                        if (isEnhancedError(err as Error)) {
                            try {
                                const e: any = err;
                                if (e?.context?.subcode) {
                                    span.setAttribute(
                                        'error.subcode',
                                        String(e.context.subcode),
                                    );
                                }
                                if (e?.code) {
                                    span.setAttribute(
                                        'error.code',
                                        String(e.code),
                                    );
                                }
                            } catch {}
                        }
                        applyErrorToSpan(
                            span,
                            err instanceof Error ? err : new Error(String(err)),
                        );
                        throw err;
                    }
                });
            } catch (error) {
                throw error;
            }
        };
    }) as Middleware<TEvent>;

    middleware.kind = 'handler';
    (middleware as unknown as { displayName?: string }).displayName =
        'withObservability';

    return middleware;
};
