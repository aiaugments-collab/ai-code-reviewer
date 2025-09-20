import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PinoLoggerService } from '../../services/logger/pino.service';
import { wrapToolHandler } from '../utils/mcp-protocol.utils';
import { BaseResponse, McpToolDefinition } from '../types/mcp-tool.interface';
import {
    IKodyRulesService,
    KODY_RULES_SERVICE_TOKEN,
} from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import {
    IKodyRule,
    IKodyRulesExample,
    KodyRulesOrigin,
    KodyRulesScope,
    KodyRulesStatus,
} from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import {
    KodyRuleSeverity,
    CreateKodyRuleDto,
} from '@/core/infrastructure/http/dtos/create-kody-rule.dto';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';

type KodyRuleInput = Required<
    Omit<
        IKodyRule,
        | 'uuid'
        | 'createdAt'
        | 'updatedAt'
        | 'type'
        | 'label'
        | 'extendedContext'
        | 'reason'
        | 'severity'
        | 'sourcePath'
        | 'sourceAnchor'
    >
> & {
    severity: KodyRuleSeverity;
};

interface KodyRulesResponse extends BaseResponse {
    data: Partial<IKodyRule>[];
}

interface CreateKodyRuleResponse extends BaseResponse {
    data: Partial<IKodyRule>;
}

@Injectable()
export class KodyRulesTools {
    constructor(
        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,
        private readonly logger: PinoLoggerService,
    ) {}

    getKodyRules(): McpToolDefinition {
        const inputSchema = z.object({
            organizationId: z
                .string()
                .describe(
                    'Organization UUID - unique identifier for the organization in the system to get all organization-level rules',
                ),
        });

        type InputType = z.infer<typeof inputSchema>;

        return {
            name: 'KODUS_GET_KODY_RULES',
            description:
                'Get all active Kody Rules at organization level. Use this to see organization-wide coding standards, global rules that apply across all repositories, or when you need a complete overview of all active rules. Returns only ACTIVE status rules.',
            inputSchema,
            outputSchema: z.object({
                success: z.boolean(),
                count: z.number(),
                data: z.array(
                    z
                        .object({
                            uuid: z.string().optional(),
                            title: z.string().optional(),
                            rule: z.string().optional(),
                            path: z.string().optional(),
                            status: z.nativeEnum(KodyRulesStatus).optional(),
                            severity: z.string().optional(),
                            label: z.string().optional(),
                            type: z.string().optional(),
                            examples: z
                                .array(
                                    z.object({
                                        snippet: z.string(),
                                        isCorrect: z.boolean(),
                                    }),
                                )
                                .optional(),
                            repositoryId: z.string().optional(),
                            origin: z.nativeEnum(KodyRulesOrigin).optional(),
                            createdAt: z.date().optional(),
                            updatedAt: z.date().optional(),
                            reason: z.string().nullable().optional(),
                            scope: z.nativeEnum(KodyRulesScope).optional(),
                            directoryId: z.string().optional(),
                        })
                        .passthrough(),
                ),
            }),
            execute: wrapToolHandler(
                async (args: InputType): Promise<KodyRulesResponse> => {
                    const params = {
                        organizationAndTeamData: {
                            organizationId: args.organizationId,
                        },
                    };

                    const entity =
                        await this.kodyRulesService.findByOrganizationId(
                            params.organizationAndTeamData.organizationId,
                        );

                    const allRules: Partial<IKodyRule>[] = entity.rules || [];

                    const rules: Partial<IKodyRule>[] = allRules.filter(
                        (rule: Partial<IKodyRule>) =>
                            rule.status === KodyRulesStatus.ACTIVE,
                    );

                    return {
                        success: true,
                        count: rules.length,
                        data: rules,
                    };
                },
            ),
        };
    }

    getKodyRulesRepository(): McpToolDefinition {
        const inputSchema = z.object({
            organizationId: z
                .string()
                .describe(
                    'Organization UUID - unique identifier for the organization in the system',
                ),
            repositoryId: z
                .string()
                .describe(
                    'Repository unique identifier to get rules specific to this repository only (not organization-wide rules)',
                ),
        });

        type InputType = z.infer<typeof inputSchema>;

        return {
            name: 'KODUS_GET_KODY_RULES_REPOSITORY',
            description:
                'Get active Kody Rules specific to a particular repository. Use this to see repository-specific coding standards, rules that only apply to one codebase, or when analyzing rules for a specific project. More focused than get_kody_rules.',
            inputSchema,
            outputSchema: z.object({
                success: z.boolean(),
                count: z.number(),
                data: z.array(
                    z
                        .object({
                            uuid: z.string().optional(),
                            title: z.string().optional(),
                            rule: z.string().optional(),
                            path: z.string().optional(),
                            status: z.nativeEnum(KodyRulesStatus).optional(),
                            severity: z.string().optional(),
                            label: z.string().optional(),
                            type: z.string().optional(),
                            examples: z
                                .array(
                                    z.object({
                                        snippet: z.string(),
                                        isCorrect: z.boolean(),
                                    }),
                                )
                                .optional(),
                            repositoryId: z.string().optional(),
                            origin: z.nativeEnum(KodyRulesOrigin).optional(),
                            createdAt: z.date().optional(),
                            updatedAt: z.date().optional(),
                            reason: z.string().nullable().optional(),
                            scope: z.nativeEnum(KodyRulesScope).optional(),
                            directoryId: z.string().optional(),
                        })
                        .passthrough(),
                ),
            }),
            execute: wrapToolHandler(
                async (args: InputType): Promise<KodyRulesResponse> => {
                    const params = {
                        organizationAndTeamData: {
                            organizationId: args.organizationId,
                        },
                        repositoryId: args.repositoryId,
                    };

                    const entity =
                        await this.kodyRulesService.findByOrganizationId(
                            params.organizationAndTeamData.organizationId,
                        );

                    const allRules: Partial<IKodyRule>[] = entity.rules || [];

                    const repositoryRules: Partial<IKodyRule>[] =
                        allRules.filter(
                            (rule: Partial<IKodyRule>) =>
                                rule.repositoryId &&
                                rule.repositoryId === params.repositoryId &&
                                rule.status === KodyRulesStatus.ACTIVE,
                        );

                    return {
                        success: true,
                        count: repositoryRules?.length,
                        data: repositoryRules,
                    };
                },
            ),
        };
    }

    createKodyRule(): McpToolDefinition {
        const inputSchema = z.object({
            organizationId: z
                .string()
                .describe(
                    'Organization UUID - unique identifier for the organization in the system where the rule will be created',
                ),
            kodyRule: z
                .object({
                    title: z
                        .string()
                        .describe(
                            'Descriptive title for the rule (e.g., "Use arrow functions for components", "Avoid console.log in production")',
                        ),
                    rule: z
                        .string()
                        .describe(
                            'Detailed description of the coding rule/standard to enforce (e.g., "All React components should use arrow function syntax")',
                        ),
                    severity: z
                        .nativeEnum(KodyRuleSeverity)
                        .describe(
                            'Rule severity level: determines how violations are handled (ERROR, WARNING, INFO)',
                        ),
                    scope: z
                        .nativeEnum(KodyRulesScope)
                        .describe(
                            'Rule scope: pull_request (analyzes entire PR context), file (analyzes individual files one by one)',
                        ),
                    repositoryId: z
                        .string()
                        .optional()
                        .describe(
                            'Repository unique identifier - can be used with both scopes to limit rule to specific repository',
                        ),
                    path: z
                        .string()
                        .optional()
                        .describe(
                            'File path pattern - used with FILE scope to target specific files (e.g., "src/components/*.tsx")',
                        ),
                    examples: z
                        .array(
                            z
                                .object({
                                    snippet: z
                                        .string()
                                        .describe(
                                            'Code example snippet demonstrating the rule',
                                        ),
                                    isCorrect: z
                                        .boolean()
                                        .describe(
                                            'Whether this snippet follows the rule (true) or violates it (false)',
                                        ),
                                })
                                .describe(
                                    'Code example showing correct or incorrect usage of the rule',
                                ),
                        )
                        .optional()
                        .describe(
                            'Array of code examples to help understand and apply the rule',
                        ),
                    directoryId: z
                        .string()
                        .optional()
                        .describe(
                            'Directory unique identifier - used with FILE scope to target specific directory',
                        ),
                })
                .describe(
                    'Complete rule definition with title, description, scope, and examples',
                ),
        });

        type InputType = z.infer<typeof inputSchema>;

        return {
            name: 'KODUS_CREATE_KODY_RULE',
            description:
                'Create a new Kody Rule with custom scope and severity. pull_request scope: analyzes entire PR context for PR-level rules. file scope: analyzes individual files one by one for file-level rules. Rule starts in pending status.',
            inputSchema,
            outputSchema: z.object({
                success: z.boolean(),
                count: z.number(),
                data: z
                    .object({
                        uuid: z.string(),
                        title: z.string(),
                        rule: z.string(),
                    })
                    .passthrough(),
            }),
            execute: wrapToolHandler(
                async (args: InputType): Promise<CreateKodyRuleResponse> => {
                    const params: {
                        organizationAndTeamData: OrganizationAndTeamData;
                        kodyRule: KodyRuleInput;
                    } = {
                        organizationAndTeamData: {
                            organizationId: args.organizationId,
                        },
                        kodyRule: {
                            title: args.kodyRule.title,
                            rule: args.kodyRule.rule,
                            severity: args.kodyRule.severity,
                            scope: args.kodyRule.scope,
                            examples: (args.kodyRule.examples ||
                                []) as IKodyRulesExample[],
                            origin: KodyRulesOrigin.GENERATED,
                            status: KodyRulesStatus.PENDING,
                            repositoryId:
                                args.kodyRule.repositoryId || 'global',
                            path:
                                (args.kodyRule.scope === KodyRulesScope.FILE
                                    ? args.kodyRule.path
                                    : '') || '',
                            directoryId:
                                (args.kodyRule.scope === KodyRulesScope.FILE
                                    ? args.kodyRule.directoryId
                                    : '') || '',
                        },
                    };

                    const result: Partial<IKodyRule> =
                        await this.kodyRulesService.createOrUpdate(
                            params.organizationAndTeamData,
                            params.kodyRule,
                            {
                                userId: 'kody-system-tool',
                                userEmail: 'kody@kodus.io',
                            },
                        );

                    return {
                        success: true,
                        count: 1,
                        data: result,
                    };
                },
            ),
        };
    }

    updateKodyRule(): McpToolDefinition {
        const inputSchema = z.object({
            organizationId: z
                .string()
                .describe(
                    'Organization UUID - unique identifier for the organization in the system',
                ),
            ruleId: z
                .string()
                .describe(
                    'Rule UUID - unique identifier of the rule to be updated',
                ),
            kodyRule: z
                .object({
                    title: z
                        .string()
                        .optional()
                        .describe(
                            'Updated title for the rule (e.g., "Use arrow functions for components", "Avoid console.log in production")',
                        ),
                    rule: z
                        .string()
                        .optional()
                        .describe(
                            'Updated detailed description of the coding rule/standard to enforce',
                        ),
                    severity: z
                        .nativeEnum(KodyRuleSeverity)
                        .optional()
                        .describe(
                            'Updated rule severity level: determines how violations are handled (ERROR, WARNING, INFO)',
                        ),
                    scope: z
                        .nativeEnum(KodyRulesScope)
                        .optional()
                        .describe(
                            'Updated rule scope: pull_request (analyzes entire PR context), file (analyzes individual files one by one)',
                        ),
                    repositoryId: z
                        .string()
                        .optional()
                        .describe(
                            'Updated repository unique identifier - can be used with both scopes to limit rule to specific repository',
                        ),
                    path: z
                        .string()
                        .optional()
                        .describe(
                            'Updated file path pattern - used with FILE scope to target specific files (e.g., "src/components/*.tsx")',
                        ),
                    examples: z
                        .array(
                            z
                                .object({
                                    snippet: z
                                        .string()
                                        .describe(
                                            'Code example snippet demonstrating the rule',
                                        ),
                                    isCorrect: z
                                        .boolean()
                                        .describe(
                                            'Whether this snippet follows the rule (true) or violates it (false)',
                                        ),
                                })
                                .describe(
                                    'Code example showing correct or incorrect usage of the rule',
                                ),
                        )
                        .optional()
                        .describe(
                            'Updated array of code examples to help understand and apply the rule',
                        ),
                    directoryId: z
                        .string()
                        .optional()
                        .describe(
                            'Updated directory unique identifier - used with FILE scope to target specific directory',
                        ),
                    status: z
                        .nativeEnum(KodyRulesStatus)
                        .optional()
                        .describe(
                            'Updated rule status: active, pending, rejected, or deleted',
                        ),
                })
                .describe(
                    'Updated rule definition with fields to modify (only provided fields will be updated)',
                ),
        });

        type InputType = z.infer<typeof inputSchema>;

        return {
            name: 'KODUS_UPDATE_KODY_RULE',
            description:
                'Update an existing Kody Rule. Only the fields provided in kodyRule will be updated. Use this to modify rule details, change severity, scope, or status of existing rules.',
            inputSchema,
            outputSchema: z.object({
                success: z.boolean(),
                count: z.number(),
                data: z
                    .object({
                        uuid: z.string(),
                        title: z.string(),
                        rule: z.string(),
                        status: z.nativeEnum(KodyRulesStatus),
                    })
                    .passthrough(),
            }),
            execute: wrapToolHandler(
                async (args: InputType): Promise<CreateKodyRuleResponse> => {
                    const organizationAndTeamData = {
                        organizationId: args.organizationId,
                    };

                    const userInfo = {
                        userId: 'kody-update-mcp-tool',
                        userEmail: 'kody@kodus.io',
                    };

                    const kodyRule: CreateKodyRuleDto = {
                        uuid: args.ruleId,
                        origin: KodyRulesOrigin.USER, // Default origin for MCP tool updates
                        ...(args.kodyRule.title && {
                            title: args.kodyRule.title,
                        }),
                        ...(args.kodyRule.rule && { rule: args.kodyRule.rule }),
                        ...(args.kodyRule.severity && {
                            severity: args.kodyRule.severity,
                        }),
                        ...(args.kodyRule.scope && {
                            scope: args.kodyRule.scope,
                        }),
                        ...(args.kodyRule.repositoryId && {
                            repositoryId: args.kodyRule.repositoryId,
                        }),
                        ...(args.kodyRule.path && { path: args.kodyRule.path }),
                        ...(args.kodyRule.examples && {
                            examples: args.kodyRule.examples.map((example) => ({
                                snippet: example.snippet || '',
                                isCorrect: example.isCorrect || false,
                            })),
                        }),
                        ...(args.kodyRule.directoryId && {
                            directoryId: args.kodyRule.directoryId,
                        }),
                        ...(args.kodyRule.status && {
                            status: args.kodyRule.status,
                        }),
                    };

                    const result =
                        await this.kodyRulesService.updateRuleWithLogging(
                            organizationAndTeamData,
                            kodyRule,
                            userInfo,
                        );

                    return {
                        success: true,
                        count: 1,
                        data: result,
                    };
                },
            ),
        };
    }

    deleteKodyRule(): McpToolDefinition {
        const inputSchema = z.object({
            organizationId: z
                .string()
                .describe(
                    'Organization UUID - unique identifier for the organization in the system',
                ),
            ruleId: z
                .string()
                .describe(
                    'Rule UUID - unique identifier of the rule to be deleted',
                ),
        });

        type InputType = z.infer<typeof inputSchema>;

        return {
            name: 'KODUS_DELETE_KODY_RULE',
            description:
                'Delete a Kody Rule permanently from the system. This action cannot be undone. Use this to remove rules that are no longer needed or relevant.',
            inputSchema,
            outputSchema: z.object({
                success: z.boolean(),
                message: z.string().optional(),
            }),
            execute: wrapToolHandler(
                async (args: InputType): Promise<BaseResponse> => {
                    const organizationAndTeamData = {
                        organizationId: args.organizationId,
                    };

                    const userInfo = {
                        userId: 'kody-delete-mcp-tool',
                        userEmail: 'kody@kodus.io',
                    };

                    const result =
                        await this.kodyRulesService.deleteRuleWithLogging(
                            organizationAndTeamData,
                            args.ruleId,
                            userInfo,
                        );

                    return {
                        success: result,
                        ...(result
                            ? { message: 'Kody Rule deleted successfully' }
                            : { message: 'Failed to delete Kody Rule' }),
                    };
                },
            ),
        };
    }

    getAllTools(): McpToolDefinition[] {
        return [
            this.getKodyRules(),
            this.getKodyRulesRepository(),
            this.createKodyRule(),
            this.updateKodyRule(),
            this.deleteKodyRule(),
        ];
    }
}
