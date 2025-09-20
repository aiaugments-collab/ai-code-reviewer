import { z } from 'zod';
import { ToolJSONSchema } from '../types/allTypes.js';

// Tipo para acessar propriedades internas do Zod
type ZodInternalDef = {
    type: string;
    checks?: unknown[];
    shape?: Record<string, z.ZodSchema>;
    values?: unknown[];
    value?: unknown;
    options?: z.ZodSchema[];
    innerType?: z.ZodSchema;
    defaultValue?: unknown | (() => unknown);
    valueType?: z.ZodSchema;
    entries?: Record<string, unknown>;
    description?: string;
    element?: z.ZodSchema;
};

/**
 * Converte um Zod schema para JSON Schema compatível com LLMs
 */
export function zodToJSONSchema(
    zodSchema: z.ZodSchema,
    name: string,
    description: string,
): ToolJSONSchema {
    const jsonSchema = zodSchemaToJsonSchemaObject(zodSchema);

    return {
        name,
        description,
        parameters: {
            type: 'object',
            properties:
                (jsonSchema.properties as Record<string, unknown>) || {},
            required: (jsonSchema.required as string[]) || [],
            additionalProperties:
                (jsonSchema.additionalProperties as boolean) ?? false,
        },
    };
}

/**
 * Verifica se um schema Zod é opcional
 */
function isOptional(schema: z.ZodSchema): boolean {
    // ✅ ADDED: Null/undefined check to prevent "_def" access error
    if (!schema || typeof schema !== 'object') {
        return false;
    }

    const zodType = schema._def as ZodInternalDef;

    // ✅ ADDED: Additional null check for _def
    if (!zodType) {
        return false;
    }

    // ✅ FIXED: Access the 'type' field correctly for Zod 4
    const type = zodType.type;

    // Direct optional types
    if (type === 'optional' || type === 'default') {
        return true;
    }

    // Check for nullable (which makes it optional in practice)
    if (type === 'nullable') {
        return true;
    }

    // Check for union with undefined/null
    if (type === 'union' && zodType.options) {
        const options = zodType.options as z.ZodSchema[];
        return options.some((option) => {
            // ✅ ADDED: Null check for option
            if (!option || typeof option !== 'object') {
                return false;
            }
            const optionDef = option._def as ZodInternalDef;
            // ✅ ADDED: Null check for optionDef
            if (!optionDef) {
                return false;
            }
            const optionType = optionDef.type;
            return optionType === 'undefined' || optionType === 'null';
        });
    }

    return false;
}

type ZodMaybeMeta = { meta?: () => { description?: string } };
type ZodMaybeDef = { _def?: { description?: string } };

/**
 * Extrai a descrição de um schema Zod (compatível com Zod 3 e 4)
 */
export function extractDescription(schema: z.ZodSchema): string | undefined {
    // ✅ ADDED: Null/undefined check
    if (!schema || typeof schema !== 'object') {
        return undefined;
    }

    // Tenta Zod 4
    const meta = (schema as ZodMaybeMeta).meta?.();
    if (meta?.description) return meta.description;
    // Fallback para Zod 3
    const def = (schema as ZodMaybeDef)._def;
    if (def && typeof def.description === 'string') return def.description;
    return undefined;
}

/**
 * Converte recursivamente um Zod schema para objeto JSON Schema
 */
function zodSchemaToJsonSchemaObject(
    schema: z.ZodSchema,
): Record<string, unknown> {
    // ✅ ADDED: Null/undefined check to prevent "_def" access error
    if (!schema || typeof schema !== 'object') {
        return { type: 'string' }; // Fallback to string type
    }

    const zodType = schema._def as ZodInternalDef;

    // ✅ ADDED: Null check for _def
    if (!zodType) {
        return { type: 'string' }; // Fallback to string type
    }

    // ✅ FIXED: Use 'type' instead of 'typeName' for Zod 4
    const typeName = zodType.type;

    // ✅ ADDED: Extract description
    const description = extractDescription(schema);

    // ✅ ADDED: Helper function to add description to schema
    const addDescription = (schemaObj: Record<string, unknown>) => {
        if (description) {
            schemaObj.description = description;
        }
        return schemaObj;
    };

    switch (typeName) {
        case 'ZodString':
        case 'string':
            const stringSchema: Record<string, unknown> = {
                type: 'string',
                ...(zodType.checks && getStringConstraints(zodType.checks)),
            };

            // ✅ ADDED: Preserve format information
            if (zodType.checks) {
                const format = extractFormatFromChecks(zodType.checks);
                if (format) {
                    stringSchema.format = format;
                }
            }

            return addDescription(stringSchema);

        case 'ZodNumber':
        case 'number':
            return addDescription({
                type: 'number',
                ...(zodType.checks && getNumberConstraints(zodType.checks)),
            });

        case 'ZodBoolean':
        case 'boolean':
            return addDescription({ type: 'boolean' });

        case 'ZodArray':
        case 'array':
            if (!zodType.element) {
                return addDescription({ type: 'array' });
            }
            const arrayItems = zodSchemaToJsonSchemaObject(
                zodType.element as unknown as z.ZodSchema,
            );
            return addDescription({
                type: 'array',
                items: arrayItems,
            });

        case 'ZodObject':
        case 'object':
            const properties: Record<string, Record<string, unknown>> = {};
            const required: string[] = [];

            if (!zodType.shape) {
                return addDescription({ type: 'object' });
            }

            // ✅ CORRIGIDO para Zod 4: shape é um objeto, não uma função
            const shape = zodType.shape;

            for (const [key, value] of Object.entries(shape)) {
                const valueSchema = value as z.ZodSchema;
                properties[key] = zodSchemaToJsonSchemaObject(valueSchema);

                // ✅ IMPROVED: Better required field detection
                if (!isOptional(valueSchema)) {
                    required.push(key);
                }
            }

            return addDescription({
                type: 'object',
                properties,
                required: required.length > 0 ? required : undefined,
                additionalProperties: false,
            });

        case 'ZodEnum':
        case 'enum':
            // ✅ FIXED: Handle Zod 4 enum structure correctly
            const enumValues =
                zodType.options || Object.values(zodType.entries || {});
            return addDescription({
                type: 'string',
                enum: enumValues,
            });

        case 'ZodLiteral':
        case 'literal':
            return addDescription({
                type: 'string',
                const: Array.from(zodType.values || [])[0],
            });

        case 'ZodUnion':
        case 'union':
            if (!zodType.options) {
                return addDescription({ type: 'string' });
            }

            const unionSchemas = zodType.options as z.ZodSchema[];
            if (unionSchemas.length === 0) {
                return addDescription({ type: 'string' });
            }

            // ✅ IMPROVED: Check if all union members are literals (convert to enum)
            const allLiterals = unionSchemas.every((unionSchema) => {
                // ✅ ADDED: Null check for unionSchema
                if (!unionSchema || typeof unionSchema !== 'object') {
                    return false;
                }
                const unionDef = unionSchema._def as ZodInternalDef;
                // ✅ ADDED: Null check for unionDef
                if (!unionDef) {
                    return false;
                }
                return unionDef.type === 'literal';
            });

            if (allLiterals) {
                const enumValues = unionSchemas
                    .map((unionSchema) => {
                        // ✅ ADDED: Null check for unionSchema
                        if (!unionSchema || typeof unionSchema !== 'object') {
                            return undefined;
                        }
                        const unionDef = unionSchema._def as ZodInternalDef;
                        // ✅ ADDED: Null check for unionDef
                        if (!unionDef) {
                            return undefined;
                        }
                        return Array.from(unionDef.values || [])[0];
                    })
                    .filter((value) => value !== undefined); // ✅ ADDED: Filter out undefined values

                return addDescription({
                    type: 'string',
                    enum: enumValues,
                });
            }

            // ✅ IMPROVED: Handle mixed unions with anyOf
            const anyOf = unionSchemas.map((unionSchema) =>
                zodSchemaToJsonSchemaObject(unionSchema),
            );

            return addDescription({
                anyOf,
            });

        case 'ZodRecord':
            return addDescription({
                type: 'object',
                additionalProperties: zodType.valueType
                    ? zodSchemaToJsonSchemaObject(zodType.valueType)
                    : true,
            });

        case 'ZodUnknown':
        case 'ZodAny':
            return addDescription({});

        case 'ZodOptional':
        case 'optional':
            if (!zodType.innerType) {
                return addDescription({ type: 'string' });
            }
            return addDescription(
                zodSchemaToJsonSchemaObject(zodType.innerType),
            );

        case 'ZodNullable':
        case 'nullable':
            if (!zodType.innerType) {
                return addDescription({ type: 'string' });
            }
            return addDescription({
                ...zodSchemaToJsonSchemaObject(zodType.innerType),
                nullable: true,
            });

        case 'ZodDefault':
        case 'default':
            if (!zodType.innerType) {
                return addDescription({ type: 'string' });
            }

            const innerSchema = zodSchemaToJsonSchemaObject(zodType.innerType);
            const defaultValue =
                typeof zodType.defaultValue === 'function'
                    ? (zodType.defaultValue as () => unknown)()
                    : zodType.defaultValue;

            return addDescription({
                ...innerSchema,
                default: defaultValue,
            });

        case 'ZodRecord':
            return addDescription({
                type: 'object',
                additionalProperties: zodType.valueType
                    ? zodSchemaToJsonSchemaObject(zodType.valueType)
                    : true,
            });

        case 'ZodUnknown':
        case 'ZodAny':
            return addDescription({});

        default:
            return addDescription({ type: 'string' });
    }
}

/**
 * Extrai constraints de string do Zod
 */
function getStringConstraints(checks: unknown[]): Record<string, unknown> {
    const constraints: Record<string, unknown> = {};

    for (const check of checks) {
        const typedCheck = check as {
            kind: string;
            value?: number;
            regex?: RegExp;
        };
        switch (typedCheck.kind) {
            case 'min':
                constraints.minLength = typedCheck.value;
                break;
            case 'max':
                constraints.maxLength = typedCheck.value;
                break;
            case 'length':
                constraints.minLength = typedCheck.value;
                constraints.maxLength = typedCheck.value;
                break;
            case 'email':
                constraints.format = 'email';
                break;
            case 'url':
                constraints.format = 'uri';
                break;
            case 'uuid':
                constraints.format = 'uuid';
                break;
            case 'regex':
                constraints.pattern = typedCheck.regex?.source;
                break;
        }
    }

    return constraints;
}

/**
 * Extrai constraints de número do Zod
 */
function getNumberConstraints(checks: unknown[]): Record<string, unknown> {
    const constraints: Record<string, unknown> = {};

    for (const check of checks) {
        const typedCheck = check as { kind: string; value?: number };
        switch (typedCheck.kind) {
            case 'min':
                constraints.minimum = typedCheck.value;
                break;
            case 'max':
                constraints.maximum = typedCheck.value;
                break;
            case 'int':
                constraints.type = 'integer';
                break;
        }
    }

    return constraints;
}

/**
 * Extract format information from Zod string checks
 */
function extractFormatFromChecks(checks: unknown[]): string | undefined {
    for (const check of checks) {
        const checkObj = check as Record<string, unknown>;

        // Check for email format
        if (checkObj.kind === 'email') {
            return 'email';
        }

        // Check for URL format
        if (checkObj.kind === 'url') {
            return 'uri';
        }

        // Check for UUID format
        if (checkObj.kind === 'uuid') {
            return 'uuid';
        }

        // Check for date format
        if (checkObj.kind === 'datetime') {
            return 'date-time';
        }
    }

    return undefined;
}

/**
 * Valida se um valor está conforme o schema Zod
 */
export function validateWithZod<T>(
    schema: z.ZodSchema<T>,
    value: unknown,
): { success: true; data: T } | { success: false; error: string } {
    // ✅ Zod v4: safeParse() é mais performático que parse() + try/catch
    const result = schema.safeParse(value);

    if (result.success) {
        return { success: true, data: result.data };
    } else {
        // ✅ MELHORADO: Tratamento de erro mais robusto
        try {
            const errors = (
                result.error as unknown as {
                    errors?: Array<{ path: string[]; message: string }>;
                }
            ).errors;

            const message =
                Array.isArray(errors) && errors.length > 0
                    ? errors
                          .map((err) => `${err.path.join('.')}: ${err.message}`)
                          .join(', ')
                    : result.error?.message ||
                      'Validation failed with unknown error structure';

            return { success: false, error: message };
        } catch {
            // ✅ FALLBACK: Se não conseguir extrair erros, usar mensagem genérica
            return {
                success: false,
                error: `Validation failed: ${result.error?.message || 'Unknown validation error'}`,
            };
        }
    }
}

/**
 * Valida entrada de tool usando schema Zod
 */
export function validateToolInput<T>(
    schema: z.ZodSchema<T>,
    input: unknown,
): T {
    // ✅ Zod v4: safeParse() é mais performático que parse() + try/catch
    const result = schema.safeParse(input);

    if (result.success) {
        return result.data;
    } else {
        // ✅ MELHORADO: Tratamento de erro mais robusto
        try {
            const errors = (
                result.error as unknown as {
                    errors?: Array<{ path: string[]; message: string }>;
                }
            ).errors;

            const message =
                Array.isArray(errors) && errors.length > 0
                    ? errors
                          .map((err) => `${err.path.join('.')}: ${err.message}`)
                          .join(', ')
                    : result.error?.message ||
                      'Tool input validation failed with unknown error structure';

            throw new Error(`Tool input validation failed: ${message}`);
        } catch {
            // ✅ FALLBACK: Se não conseguir extrair erros, usar mensagem genérica
            throw new Error(
                `Tool input validation failed: ${result.error?.message || 'Unknown validation error'}`,
            );
        }
    }
}
