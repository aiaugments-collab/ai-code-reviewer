import { KernelError } from '../../core/errors.js';
import {
    TEvent,
    EventHandler,
    KernelErrorCode,
    Middleware,
    SchemaLike,
    ValidateOptions,
} from '../../core/types/allTypes.js';

export function withValidateMiddleware(
    schema: SchemaLike,
    options?: ValidateOptions,
) {
    const middleware = function <E extends TEvent>(
        handler: EventHandler<E>,
    ): EventHandler<E> {
        return withValidate(schema, handler, options);
    } as Middleware<TEvent>;

    middleware.kind = 'handler';
    (middleware as unknown as { displayName?: string }).displayName =
        'withValidate';

    return middleware;
}

export function withValidate<T extends TEvent>(
    schema: SchemaLike,
    handler: EventHandler<T>,
    options?: ValidateOptions,
): EventHandler<T> {
    const throwOnError = options?.throwOnError ?? true;
    // Usar KernelErrorCode válido
    const errorCode =
        options?.errorCode ?? ('VALIDATION_ERROR' as KernelErrorCode);

    return async (event: T) => {
        try {
            // Validate the event data (não payload)
            const result = schema.safeParse(event.data);

            if (!result.success) {
                if (throwOnError) {
                    throw new KernelError(
                        errorCode,
                        `Validation failed for event ${event.type}`,
                        { context: { validationError: result.error } },
                    );
                }
                // Se não lançar erro, apenas retorna undefined e NÃO chama o handler
                return undefined;
            }

            // Continue with handler
            return await handler(event);
        } catch (error) {
            // Re-throw KernelErrors
            if (error instanceof KernelError) {
                throw error;
            }

            // Wrap other errors
            throw new KernelError(
                'VALIDATION_ERROR',
                `Validation error: ${error instanceof Error ? error.message : String(error)}`,
                {
                    cause:
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                },
            );
        }
    };
}
