import z from 'zod';

export interface IKodyRules {
    uuid?: string;
    organizationId: string;
    rules: Partial<IKodyRule>[];
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IKodyRule {
    uuid?: string;
    title: string;
    rule: string;
    path?: string;
    sourcePath?: string;
    sourceAnchor?: string;
    status: KodyRulesStatus;
    severity: string;
    label?: string;
    type?: string;
    extendedContext?: IKodyRulesExtendedContext;
    examples?: IKodyRulesExample[];
    repositoryId: string;
    origin?: KodyRulesOrigin;
    createdAt?: Date;
    updatedAt?: Date;
    reason?: string | null;
    scope?: KodyRulesScope;
    directoryId?: string;
}

export interface IKodyRulesExtendedContext {
    todo: string;
}

export interface IKodyRulesExample {
    snippet: string;
    isCorrect: boolean;
}

export enum KodyRulesOrigin {
    USER = 'user',
    LIBRARY = 'library',
    GENERATED = 'generated',
}

export enum KodyRulesStatus {
    ACTIVE = 'active',
    REJECTED = 'rejected',
    PENDING = 'pending',
    DELETED = 'deleted',
}

export enum KodyRulesScope {
    PULL_REQUEST = 'pull-request',
    FILE = 'file',
}

export const kodyRulesExtendedContextSchema = z.object({
    todo: z.string(),
});

export const kodyRulesExampleSchema = z.object({
    snippet: z.string(),
    isCorrect: z.boolean(),
});

const kodyRulesOriginSchema = z.enum([...Object.values(KodyRulesOrigin)] as [
    KodyRulesOrigin,
    ...KodyRulesOrigin[],
]);

const kodyRulesStatusSchema = z.enum([...Object.values(KodyRulesStatus)] as [
    KodyRulesStatus,
    ...KodyRulesStatus[],
]);

const kodyRulesScopeSchema = z.enum([...Object.values(KodyRulesScope)] as [
    KodyRulesScope,
    ...KodyRulesScope[],
]);

export const kodyRuleSchema = z.object({
    uuid: z.string().optional(),
    title: z.string(),
    rule: z.string(),
    path: z.string().optional(),
    sourcePath: z.string().optional(),
    sourceAnchor: z.string().optional(),
    status: kodyRulesStatusSchema,
    severity: z.string(),
    label: z.string().optional(),
    type: z.string().optional(),
    extendedContext: kodyRulesExtendedContextSchema.optional(),
    examples: z.array(kodyRulesExampleSchema).optional(),
    repositoryId: z.string(),
    origin: kodyRulesOriginSchema.optional(),
    createdAt: z.date().optional(),
    updatedAt: z.date().optional(),
    reason: z.string().nullable().optional(),
    scope: kodyRulesScopeSchema.optional(),
    directoryId: z.string().optional(),
});
