import { Inject, Injectable } from '@nestjs/common';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { RULE_FILE_PATTERNS } from '@/shared/utils/kody-rules/file-patterns';
import { isFileMatchingGlob } from '@/shared/utils/glob-utils';
import { CreateOrUpdateKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/create-or-update.use-case';
import {
    KodyRulesOrigin,
    KodyRulesScope,
    IKodyRule,
} from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import {
    CreateKodyRuleDto,
    KodyRuleSeverity,
} from '@/core/infrastructure/http/dtos/create-kody-rule.dto';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import {
    IKodyRulesService,
    KODY_RULES_SERVICE_TOKEN,
} from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import {
    PromptRunnerService,
    ParserType,
    PromptRole,
    LLMModelProvider,
} from '@kodus/kodus-common/llm';
import { createHash } from 'crypto';
import { UpdateOrCreateCodeReviewParameterUseCase } from '@/core/application/use-cases/parameters/update-or-create-code-review-parameter-use-case';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import * as path from 'path';

type SyncTarget = {
    organizationAndTeamData: OrganizationAndTeamData;
    repository: {
        id: string;
        name: string;
        fullName?: string;
        defaultBranch?: string;
    };
};

@Injectable()
export class KodyRulesSyncService {
    constructor(
        private readonly codeManagementService: CodeManagementService,
        private readonly promptRunner: PromptRunnerService,
        private readonly logger: PinoLoggerService,
        @Inject(CreateOrUpdateKodyRulesUseCase)
        private readonly upsertRule: CreateOrUpdateKodyRulesUseCase,
        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,
        private readonly updateOrCreateCodeReviewParameterUseCase: UpdateOrCreateCodeReviewParameterUseCase,
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,
    ) {}

    /**
     * Find the configured directory (if any) that contains a given repository-relative file path.
     * Returns the most specific matching directory (longest path prefix) to support nested configs.
     */
    private async resolveDirectoryForFile(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repositoryId: string;
        filePath: string; // repository-relative, posix path
    }): Promise<{ id: string; path: string } | null> {
        try {
            const { organizationAndTeamData, repositoryId, filePath } = params;
            const cfg = await this.parametersService.findByKey(
                ParametersKey.CODE_REVIEW_CONFIG,
                organizationAndTeamData,
            );

            const repos = cfg?.configValue?.repositories;
            if (!repositoryId || !Array.isArray(repos) || !repos.length) {
                return null;
            }

            // Normalize path for safe prefix checks (posix style)
            const normalizedFile = path.posix.normalize(
                filePath.startsWith('/') ? filePath.slice(1) : filePath,
            );

            const repoCfg = repos.find(
                (r: any) =>
                    r &&
                    (r.id === repositoryId || r.id === repositoryId.toString()),
            );
            const directories: Array<{ id: string; path: string }> = (
                repoCfg?.directories || []
            )
                .filter((d: any) => d && typeof d.path === 'string' && d.id)
                .map((d: any) => ({
                    id: d.id,
                    path: d.path,
                }));

            if (!directories.length) return null;

            // Choose the most specific directory whose path is a prefix of the file path
            let best: { id: string; path: string } | null = null;
            for (const d of directories) {
                const normalizedDir = path.posix.normalize(
                    (d.path || '').replace(/^\/*/, ''),
                );
                if (!normalizedDir || normalizedDir === '.') continue;

                // Ensure exact segment boundary (e.g., 'apps/app' should not match 'apps/app1')
                const isPrefix =
                    normalizedFile === normalizedDir ||
                    normalizedFile.startsWith(normalizedDir + '/');
                if (!isPrefix) continue;

                if (
                    !best ||
                    normalizedDir.length >
                        path.posix.normalize(
                            (best.path || '').replace(/^\/*/, ''),
                        ).length
                ) {
                    best = d;
                }
            }

            return best;
        } catch (error) {
            this.logger.warn({
                message: 'Failed to resolve directory for file',
                context: KodyRulesSyncService.name,
                error,
                metadata: params,
            });
            return null;
        }
    }

    private async findRuleBySourcePath(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repositoryId: string;
        sourcePath: string;
    }): Promise<Partial<{ uuid: string }> | null> {
        try {
            const { organizationAndTeamData, repositoryId, sourcePath } =
                params;
            const existing = await this.kodyRulesService.findByOrganizationId(
                organizationAndTeamData.organizationId,
            );
            const found = existing?.rules?.find(
                (r) =>
                    r?.repositoryId === repositoryId &&
                    r?.sourcePath === sourcePath,
            );
            return found ? { uuid: found.uuid } : null;
        } catch (error) {
            this.logger.error({
                message: 'Failed to find rule by sourcePath',
                context: KodyRulesSyncService.name,
                error,
                metadata: params,
            });
            return null;
        }
    }

    private async deleteRuleBySourcePath(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repositoryId: string;
        sourcePath: string;
    }): Promise<void> {
        try {
            const { organizationAndTeamData, repositoryId, sourcePath } =
                params;
            const entity = await this.kodyRulesService.findByOrganizationId(
                organizationAndTeamData.organizationId,
            );
            if (!entity) return;

            const toDelete = entity.rules?.find(
                (r) =>
                    r?.repositoryId === repositoryId &&
                    (r?.sourcePath || '').split('#')[0] === sourcePath,
            );
            if (!toDelete?.uuid) return;

            await this.kodyRulesService.deleteRuleLogically(
                entity.uuid,
                toDelete.uuid,
            );
        } catch (error) {
            this.logger.error({
                message: 'Failed to delete rule by sourcePath',
                context: KodyRulesSyncService.name,
                error,
                metadata: params,
            });
        }
    }

    async syncFromChangedFiles(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repository: { id: string; name: string; fullName?: string };
        pullRequestNumber: number;
        files: Array<{
            filename: string;
            previous_filename?: string;
            status: string;
        }>;
    }): Promise<void> {
        const {
            organizationAndTeamData,
            repository,
            pullRequestNumber,
            files,
        } = params;
        try {
            const syncEnabled = await this.isIdeRulesSyncEnabled(
                organizationAndTeamData,
                repository.id,
            );

            // If the sync is disabled, we need to force sync the files that have @kody-sync
            let forceSyncFiles: string[] = [];
            if (!syncEnabled) {
                // First, we need to check which files can be rule files
                const directoryPatterns = await this.getDirectoryPatterns(
                    organizationAndTeamData,
                    repository.id,
                );
                const patterns = [...RULE_FILE_PATTERNS, ...directoryPatterns];
                const isRuleFile = (fp?: string) =>
                    !!fp && isFileMatchingGlob(fp, patterns);

                const ruleChanges = files.filter(
                    (f) =>
                        isRuleFile(f.filename) ||
                        isRuleFile(f.previous_filename),
                );

                // Get the PR details once
                const prDetails =
                    await this.codeManagementService.getPullRequestByNumber({
                        organizationAndTeamData,
                        repository: {
                            id: repository.id,
                            name: repository.name,
                        },
                        prNumber: pullRequestNumber,
                    });

                const { head, base } =
                    this.extractRefsFromPullRequest(prDetails);
                const pullRequestParam: any = {
                    number: pullRequestNumber,
                    head: head ? { ref: head } : undefined,
                    base: base ? { ref: base } : undefined,
                };

                // Now we need to check which files have @kody-sync in the content
                for (const f of ruleChanges) {
                    if (f.status === 'removed') continue;

                    const content = await this.getFileContent({
                        organizationAndTeamData,
                        repository: {
                            id: repository.id,
                            name: repository.name,
                        },
                        filename: f.filename,
                        pullRequest: pullRequestParam,
                    });

                    if (content && this.shouldForceSync(content)) {
                        forceSyncFiles.push(f.filename);
                        this.logger.log({
                            message:
                                'File marked for force sync with @kody-sync',
                            context: KodyRulesSyncService.name,
                            metadata: {
                                filename: f.filename,
                                repositoryId: repository.id,
                                organizationAndTeamData,
                            },
                        });
                    }
                }

                if (forceSyncFiles.length === 0) {
                    this.logger.log({
                        message:
                            'IDE rules sync disabled and no files marked with @kody-sync',
                        context: KodyRulesSyncService.name,
                        metadata: {
                            repositoryId: repository.id,
                            organizationAndTeamData,
                        },
                    });
                    return;
                }

                this.logger.log({
                    message: `Found ${forceSyncFiles.length} files marked for force sync`,
                    context: KodyRulesSyncService.name,
                    metadata: {
                        repositoryId: repository.id,
                        organizationAndTeamData,
                        forceSyncFiles,
                    },
                });
            }

            const prDetails =
                await this.codeManagementService.getPullRequestByNumber({
                    organizationAndTeamData,
                    repository: { id: repository.id, name: repository.name },
                    prNumber: pullRequestNumber,
                });

            const { head, base } = this.extractRefsFromPullRequest(prDetails);
            const pullRequestParam: any = {
                number: pullRequestNumber,
                head: head ? { ref: head } : undefined,
                base: base ? { ref: base } : undefined,
            };

            const directoryPatterns = await this.getDirectoryPatterns(
                organizationAndTeamData,
                repository.id,
            );

            const patterns = [...RULE_FILE_PATTERNS, ...directoryPatterns];
            const isRuleFile = (fp?: string) =>
                !!fp && isFileMatchingGlob(fp, patterns);

            let ruleChanges = files.filter(
                (f) =>
                    isRuleFile(f.filename) || isRuleFile(f.previous_filename),
            );

            // Se o sync não estiver habilitado, filtrar apenas os arquivos marcados para force sync
            if (!syncEnabled && forceSyncFiles.length > 0) {
                ruleChanges = ruleChanges.filter((f) =>
                    forceSyncFiles.includes(f.filename),
                );
            }

            if (!ruleChanges.length) return;

            for (const f of ruleChanges) {
                if (f.status === 'removed') {
                    // Delete rule corresponding to removed file
                    await this.deleteRuleBySourcePath({
                        organizationAndTeamData,
                        repositoryId: repository.id,
                        sourcePath: f.filename,
                    });
                    continue;
                }

                const sourcePathLookup =
                    f.status === 'renamed' && f.previous_filename
                        ? f.previous_filename
                        : f.filename;

                const contentResp =
                    await this.codeManagementService.getRepositoryContentFile({
                        organizationAndTeamData,
                        repository: {
                            id: repository.id,
                            name: repository.name,
                        },
                        file: { filename: f.filename },
                        pullRequest: pullRequestParam,
                    });
                // Fallbacks if the source branch was deleted on merge (e.g., GitLab):
                // 1) Try with base as head
                // 2) Try with default branch as head
                let effectiveContent = contentResp;
                if (!effectiveContent?.data?.content) {
                    // Try base ref as head
                    const baseRef = pullRequestParam.base?.ref;
                    if (baseRef) {
                        try {
                            const baseAsHead =
                                await this.codeManagementService.getRepositoryContentFile(
                                    {
                                        organizationAndTeamData,
                                        repository: {
                                            id: repository.id,
                                            name: repository.name,
                                        },
                                        file: { filename: f.filename },
                                        pullRequest: { head: { ref: baseRef } },
                                    },
                                );
                            if (baseAsHead?.data?.content) {
                                effectiveContent = baseAsHead;
                            }
                        } catch {}
                    }
                }
                if (!effectiveContent?.data?.content) {
                    // Try repository default branch as head
                    try {
                        const defaultBranch =
                            await this.codeManagementService.getDefaultBranch({
                                organizationAndTeamData,
                                repository: {
                                    id: repository.id,
                                    name: repository.name,
                                },
                            });
                        if (defaultBranch) {
                            const defAsHead =
                                await this.codeManagementService.getRepositoryContentFile(
                                    {
                                        organizationAndTeamData,
                                        repository: {
                                            id: repository.id,
                                            name: repository.name,
                                        },
                                        file: { filename: f.filename },
                                        pullRequest: {
                                            head: { ref: defaultBranch },
                                        },
                                    },
                                );
                            if (defAsHead?.data?.content) {
                                effectiveContent = defAsHead;
                            }
                        }
                    } catch {}
                }

                const rawContent = effectiveContent?.data?.content;
                if (!rawContent) continue;

                const decoded =
                    contentResp?.data?.encoding === 'base64'
                        ? Buffer.from(rawContent, 'base64').toString('utf-8')
                        : rawContent;

                //Verify if the file should be ignored due to the @kody-ignore marker
                if (this.shouldIgnoreFile(decoded)) {
                    this.logger.log({
                        message:
                            'File ignored due to @kody-ignore marker - removing existing rules',
                        context: KodyRulesSyncService.name,
                        metadata: {
                            file: f.filename,
                            repositoryId: repository.id,
                            pullRequestNumber,
                            organizationAndTeamData,
                        },
                    });

                    // Remove existing rules for this file
                    await this.deleteRuleBySourcePath({
                        organizationAndTeamData,
                        repositoryId: repository.id,
                        sourcePath: f.filename,
                    });
                    continue;
                }

                const rules = await this.convertFileToKodyRules({
                    filePath: f.filename,
                    repositoryId: repository.id,
                    content: decoded,
                });

                if (!Array.isArray(rules) || rules.length === 0) {
                    this.logger.warn({
                        message: 'No rules parsed from changed file',
                        context: KodyRulesSyncService.name,
                        metadata: { file: f.filename },
                    });
                    continue;
                }

                const oneRule = rules.find(
                    (r) => r && typeof r === 'object' && r.title && r.rule,
                );

                if (!oneRule) continue;

                const existing = sourcePathLookup
                    ? await this.findRuleBySourcePath({
                          organizationAndTeamData,
                          repositoryId: repository.id,
                          sourcePath: sourcePathLookup,
                      })
                    : null;

                const dto: CreateKodyRuleDto = {
                    uuid: existing?.uuid,
                    title: oneRule.title as string,
                    rule: oneRule.rule as string,
                    path: (oneRule.path as string) ?? f.filename,
                    sourcePath: f.filename,
                    severity:
                        ((
                            oneRule.severity as any
                        )?.toLowerCase?.() as KodyRuleSeverity) ||
                        KodyRuleSeverity.MEDIUM,
                    repositoryId: repository.id,
                    // If the rule file is inside a configured directory (monorepo folder), attach directoryId
                    directoryId: (
                        await this.resolveDirectoryForFile({
                            organizationAndTeamData,
                            repositoryId: repository.id,
                            filePath: f.filename,
                        })
                    )?.id,
                    origin: KodyRulesOrigin.USER,
                    status: oneRule.status as any,
                    scope:
                        (oneRule.scope as KodyRulesScope) ||
                        KodyRulesScope.FILE,
                    examples: Array.isArray(oneRule.examples)
                        ? (oneRule.examples as any)
                        : [],
                } as CreateKodyRuleDto;

                const result = await this.upsertRule.execute(
                    dto,
                    organizationAndTeamData.organizationId,
                );

                try {
                    await this.updateOrCreateCodeReviewParameterUseCase.execute(
                        {
                            organizationAndTeamData,
                            configValue: {
                                kodyRules: [],
                            } as any,
                            repositoryId: repository.id,
                        },
                    );
                } catch (paramError) {
                    this.logger.error({
                        message:
                            'Failed to ensure CODE_REVIEW_CONFIG after rule sync (PR files)',
                        context: KodyRulesSyncService.name,
                        error: paramError,
                        metadata: {
                            repositoryId: repository.id,
                            file: f.filename,
                        },
                    });
                }
            }
        } catch (error) {
            this.logger.error({
                message: 'Failed to sync Kody Rules from changed files',
                context: KodyRulesSyncService.name,
                error,
                metadata: params,
            });
        }
    }

    async syncRepositoryMain(params: SyncTarget): Promise<void> {
        const { organizationAndTeamData, repository } = params;
        try {
            const syncEnabled = await this.isIdeRulesSyncEnabled(
                organizationAndTeamData,
                repository.id,
            );

            const branch = await this.codeManagementService.getDefaultBranch({
                organizationAndTeamData,
                repository,
            });

            const directoryPatterns = await this.getDirectoryPatterns(
                organizationAndTeamData,
                repository.id,
            );

            const patterns = [...RULE_FILE_PATTERNS, ...directoryPatterns];

            // List only rule files
            const allFiles =
                await this.codeManagementService.getRepositoryAllFiles({
                    organizationAndTeamData,
                    repository: { id: repository.id, name: repository.name },
                    filters: {
                        branch,
                        filePatterns: patterns,
                    },
                });

            // Se o sync não estiver habilitado, verificar quais arquivos têm @kody-sync
            let filesToSync = allFiles;
            if (!syncEnabled) {
                const forceSyncFiles: string[] = [];

                for (const file of allFiles) {
                    const content = await this.getFileContent({
                        organizationAndTeamData,
                        repository: {
                            id: repository.id,
                            name: repository.name,
                        },
                        filename: file.path,
                        branch,
                    });

                    if (content && this.shouldForceSync(content)) {
                        forceSyncFiles.push(file.path);
                        this.logger.log({
                            message:
                                'File marked for force sync with @kody-sync',
                            context: KodyRulesSyncService.name,
                            metadata: {
                                filename: file.path,
                                repositoryId: repository.id,
                                organizationAndTeamData,
                            },
                        });
                    }
                }

                if (forceSyncFiles.length === 0) {
                    this.logger.log({
                        message:
                            'IDE rules sync disabled and no files marked with @kody-sync',
                        context: KodyRulesSyncService.name,
                        metadata: {
                            repositoryId: repository.id,
                            organizationAndTeamData,
                        },
                    });
                    return;
                }

                filesToSync = allFiles.filter((file) =>
                    forceSyncFiles.includes(file.path),
                );

                this.logger.log({
                    message: `Found ${forceSyncFiles.length} files marked for force sync`,
                    context: KodyRulesSyncService.name,
                    metadata: {
                        repositoryId: repository.id,
                        organizationAndTeamData,
                        forceSyncFiles,
                    },
                });
            }

            for (const file of filesToSync) {
                const contentResp =
                    await this.codeManagementService.getRepositoryContentFile({
                        organizationAndTeamData,
                        repository: {
                            id: repository.id,
                            name: repository.name,
                        },
                        file: { filename: file.path },
                        pullRequest: {
                            head: { ref: branch },
                            base: { ref: branch },
                        },
                    });

                const rawContent = contentResp?.data?.content;
                if (!rawContent) continue;

                const decoded =
                    contentResp?.data?.encoding === 'base64'
                        ? Buffer.from(rawContent, 'base64').toString('utf-8')
                        : rawContent;

                // Verify if the file should be ignored due to the @kody-ignore marker
                if (this.shouldIgnoreFile(decoded)) {
                    this.logger.log({
                        message:
                            'File ignored due to @kody-ignore marker - removing existing rules',
                        context: KodyRulesSyncService.name,
                        metadata: {
                            file: file.path,
                            repositoryId: repository.id,
                            syncType: 'main',
                            organizationAndTeamData,
                        },
                    });

                    // Remove existing rules for this file
                    await this.deleteRuleBySourcePath({
                        organizationAndTeamData,
                        repositoryId: repository.id,
                        sourcePath: file.path,
                    });
                    continue;
                }

                const rules = await this.convertFileToKodyRules({
                    filePath: file.path,
                    repositoryId: repository.id,
                    content: decoded,
                });

                const oneRule = rules.find(
                    (r) => r && typeof r === 'object' && r.title && r.rule,
                );
                if (!oneRule) continue;

                const existing = await this.findRuleBySourcePath({
                    organizationAndTeamData,
                    repositoryId: repository.id,
                    sourcePath: file.path,
                });

                const dto: CreateKodyRuleDto = {
                    uuid: existing?.uuid,
                    title: oneRule.title as string,
                    rule: oneRule.rule as string,
                    path: (oneRule.path as string) ?? file.path,
                    sourcePath: file.path,
                    severity:
                        ((
                            oneRule.severity as any
                        )?.toLowerCase?.() as KodyRuleSeverity) ||
                        KodyRuleSeverity.MEDIUM,
                    repositoryId: repository.id,
                    directoryId: (
                        await this.resolveDirectoryForFile({
                            organizationAndTeamData,
                            repositoryId: repository.id,
                            filePath: file.path,
                        })
                    )?.id,
                    origin: KodyRulesOrigin.USER,
                    status: oneRule.status as any,
                    scope:
                        (oneRule.scope as KodyRulesScope) ||
                        KodyRulesScope.FILE,
                    examples: Array.isArray(oneRule.examples)
                        ? (oneRule.examples as any)
                        : [],
                } as CreateKodyRuleDto;

                const result = await this.upsertRule.execute(
                    dto,
                    organizationAndTeamData.organizationId,
                );

                try {
                    await this.updateOrCreateCodeReviewParameterUseCase.execute(
                        {
                            organizationAndTeamData,
                            configValue: {
                                kodyRules: [],
                            } as any,
                            repositoryId: repository.id,
                        },
                    );
                } catch (paramError) {
                    this.logger.error({
                        message:
                            'Failed to ensure CODE_REVIEW_CONFIG after rule sync (main)',
                        context: KodyRulesSyncService.name,
                        error: paramError,
                        metadata: {
                            repositoryId: repository.id,
                            file: file.path,
                        },
                    });
                }
            }
        } catch (error) {
            this.logger.error({
                message: 'Failed to sync Kody Rules from main',
                context: KodyRulesSyncService.name,
                error,
                metadata: params,
            });
        }
    }

    private async isIdeRulesSyncEnabled(
        organizationAndTeamData: OrganizationAndTeamData,
        repositoryId?: string,
    ): Promise<boolean> {
        try {
            const cfg = await this.parametersService.findByKey(
                ParametersKey.CODE_REVIEW_CONFIG,
                organizationAndTeamData,
            );

            // Must have repository context and repository-specific config
            if (!repositoryId || !cfg?.configValue?.repositories) {
                return false;
            }

            const repoConfig = cfg.configValue.repositories.find(
                (repo: any) =>
                    repo.id === repositoryId ||
                    repo.id === repositoryId.toString(),
            );

            return repoConfig?.ideRulesSyncEnabled === true;
        } catch {
            return false;
        }
    }

    private extractRefsFromPullRequest(pr: any): {
        head?: string;
        base?: string;
    } {
        const normalize = (ref?: string): string | undefined => {
            if (!ref) return undefined;
            return ref.startsWith('refs/heads/')
                ? ref.replace('refs/heads/', '')
                : ref;
        };

        const head = normalize(
            pr?.head?.ref || // GitHub
                pr?.source?.branch?.name || // Bitbucket
                pr?.sourceRefName || // Azure
                pr?.source_branch || // GitLab
                pr?.fromRef?.displayId, // Bitbucket Server
        );

        const base = normalize(
            pr?.base?.ref || // GitHub
                pr?.destination?.branch?.name || // Bitbucket
                pr?.targetRefName || // Azure
                pr?.target_branch || // GitLab
                pr?.toRef?.displayId, // Bitbucket Server
        );

        return { head, base };
    }

    private async convertFileToKodyRules(params: {
        filePath: string;
        repositoryId: string;
        content: string;
    }): Promise<Array<Partial<CreateKodyRuleDto>>> {
        try {
            const result = await this.promptRunner
                .builder()
                .setProviders({
                    main: LLMModelProvider.NOVITA_MOONSHOTAI_KIMI_K2_INSTRUCT,
                    fallback:
                        LLMModelProvider.NOVITA_QWEN3_235B_A22B_THINKING_2507,
                })
                .setParser<Array<Partial<CreateKodyRuleDto>>>(ParserType.JSON)
                .setLLMJsonMode(true)
                .setPayload({
                    filePath: params.filePath,
                    repositoryId: params.repositoryId,
                    content: params.content,
                })
                .addPrompt({
                    role: PromptRole.SYSTEM,
                    prompt: [
                        'Convert repository rule files (Cursor, Claude, GitHub rules, coding standards, etc.) into a JSON array of Kody Rules. IMPORTANT: Enforce exactly one rule per file. If multiple candidate rules exist, merge them concisely into one or pick the most representative. Return an array with a single item or [].',
                        'Output ONLY a valid JSON array. If none, output []. No comments or explanations.',
                        'Each item MUST match exactly:',
                        '{"title": string, "rule": string, "path": string, "sourcePath": string, "severity": "low"|"medium"|"high"|"critical", "scope"?: "file"|"pull-request", "status"?: "active"|"pending"|"rejected"|"deleted", "examples": [{ "snippet": string, "isCorrect": boolean }], "sourceSnippet"?: string}',
                        'Detection: extract a rule only if the text imposes a requirement/restriction/convention/standard.',
                        'Severity map: must/required/security/blocker → "high" or "critical"; should/warn → "medium"; tip/info/optional → "low".',
                        'Scope: "file" for code/content; "pull-request" for PR titles/descriptions/commits/reviewers/labels.',
                        'Status: "active" if mandatory; "pending" if suggestive; "deleted" if deprecated.',
                        'path (target GLOB): use declared globs/paths when present (frontmatter like "globs:" or explicit sections). If none, set "**/*". If multiple, join with commas (e.g., "services/**,api/**").',
                        'sourcePath: ALWAYS set to the exact file path provided in input.',
                        'sourceSnippet: when possible, include an EXACT copy (verbatim) of the bullet/line/paragraph from the file that led to this rule. Do NOT paraphrase. If none is suitable, omit this key.',
                        'Examples: prefer 1 incorrect and 1 correct (minimal snippets).',
                        'Language: keep the rule language consistent with the source (EN or PT-BR).',
                        'Do NOT include keys like repositoryId, origin, createdAt, updatedAt, uuid, or any extra keys.',
                        'Keep strings concise and strictly typed.',
                    ].join(' '),
                })
                .addPrompt({
                    role: PromptRole.USER,
                    prompt: `File: ${params.filePath}\n\nContent:\n${params.content}`,
                })
                .setRunName('kodyRulesFileToRules')
                .execute();

            if (!Array.isArray(result)) return [];

            return result.map((r) => ({
                ...r,
                severity:
                    (r?.severity?.toString?.().toLowerCase?.() as any) ||
                    KodyRuleSeverity.MEDIUM,
                scope: (r?.scope as any) || KodyRulesScope.FILE,
                path: r?.path || params.filePath,
                origin: KodyRulesOrigin.USER,
            }));
        } catch (error) {
            try {
                const raw = await this.promptRunner
                    .builder()
                    .setProviders({
                        main: LLMModelProvider.GEMINI_2_5_FLASH,
                        fallback: LLMModelProvider.GEMINI_2_5_PRO,
                    })
                    .setParser(ParserType.STRING)
                    .setPayload({
                        filePath: params.filePath,
                        repositoryId: params.repositoryId,
                        content: params.content,
                    })
                    .addPrompt({
                        role: PromptRole.SYSTEM,
                        prompt: 'Return ONLY the JSON array for the rules, without code fences. Include a "sourceSnippet" field when you can copy an exact excerpt from the file for each rule. No explanations.',
                    })
                    .addPrompt({
                        role: PromptRole.USER,
                        prompt: `File: ${params.filePath}\n\nContent:\n${params.content}`,
                    })
                    .setRunName('kodyRulesFileToRulesRaw')
                    .execute();

                const parsed = this.extractJsonArray(raw);
                if (!Array.isArray(parsed)) return [];

                return parsed.map((r) => ({
                    ...r,
                    severity:
                        (r?.severity?.toString?.().toLowerCase?.() as any) ||
                        KodyRuleSeverity.MEDIUM,
                    scope: (r?.scope as any) || KodyRulesScope.FILE,
                    path: r?.path || params.filePath,
                    sourcePath: r?.sourcePath || params.filePath,
                    origin: KodyRulesOrigin.USER,
                }));
            } catch (fallbackError) {
                this.logger.error({
                    message: 'LLM conversion failed for rule file',
                    context: KodyRulesSyncService.name,
                    metadata: params,
                    error: fallbackError,
                });
                return [];
            }
        }
    }

    private extractJsonArray(text: string | null | undefined): any[] | null {
        if (!text || typeof text !== 'string') return null;
        let s = text.trim();
        const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenceMatch && fenceMatch[1]) s = fenceMatch[1].trim();
        if (s.startsWith('"') && s.endsWith('"')) {
            try {
                s = JSON.parse(s);
            } catch {}
        }
        const start = s.indexOf('[');
        const end = s.lastIndexOf(']');
        if (start >= 0 && end > start) s = s.slice(start, end + 1);
        try {
            const parsed = JSON.parse(s);
            return Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    /**
     * Verifica se um arquivo deve ser sincronizado forçadamente baseado na marcação @kody-sync
     * A marcação pode estar no início ou final do arquivo
     */
    private shouldForceSync(content: string): boolean {
        if (!content || typeof content !== 'string') {
            return false;
        }

        const trimmedContent = content.trim();
        if (!trimmedContent) {
            return false;
        }

        // Verifica as primeiras 10 linhas do arquivo
        const lines = trimmedContent.split('\n');
        const totalLines = lines.length;

        // Se o arquivo tem 20 linhas ou menos, verifica apenas as primeiras e últimas sem sobreposição
        let firstLines: string[];
        let lastLines: string[];

        if (totalLines <= 20) {
            const halfPoint = Math.floor(totalLines / 2);
            firstLines = lines.slice(0, halfPoint);
            lastLines = lines.slice(halfPoint);
        } else {
            firstLines = lines.slice(0, 10);
            lastLines = lines.slice(-10);
        }

        // Padrão para detectar @kody-sync (case insensitive, com word boundary)
        // Deve ter uma quebra de palavra antes do @ E depois de "sync" para evitar falsos positivos
        const syncPattern = /(?:^|[^a-zA-Z0-9._-])@kody-sync(?![a-zA-Z0-9_-])/i;

        // Verifica no início do arquivo
        const hasSyncAtStart = firstLines.some((line) =>
            syncPattern.test(line.trim()),
        );

        // Verifica no final do arquivo
        const hasSyncAtEnd = lastLines.some((line) =>
            syncPattern.test(line.trim()),
        );

        return hasSyncAtStart || hasSyncAtEnd;
    }

    /**
     * Busca e decodifica o conteúdo de um arquivo do repositório
     */
    private async getFileContent(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repository: { id: string; name: string };
        filename: string;
        pullRequest?: any;
        branch?: string;
    }): Promise<string | null> {
        try {
            const {
                organizationAndTeamData,
                repository,
                filename,
                pullRequest,
                branch,
            } = params;

            const requestParams: any = {
                organizationAndTeamData,
                repository,
                file: { filename },
            };

            if (pullRequest) {
                requestParams.pullRequest = pullRequest;
            } else if (branch) {
                requestParams.pullRequest = {
                    head: { ref: branch },
                    base: { ref: branch },
                };
            }

            const contentResp =
                await this.codeManagementService.getRepositoryContentFile(
                    requestParams,
                );
            const rawContent = contentResp?.data?.content;

            if (!rawContent) return null;

            const decoded =
                contentResp?.data?.encoding === 'base64'
                    ? Buffer.from(rawContent, 'base64').toString('utf-8')
                    : rawContent;

            return decoded;
        } catch (error) {
            this.logger.warn({
                message: 'Failed to get file content',
                context: KodyRulesSyncService.name,
                metadata: {
                    filename: params.filename,
                    organizationAndTeamData: params.organizationAndTeamData,
                },
                error,
            });
            return null;
        }
    }

    /**
     * Verifica se um arquivo deve ser ignorado baseado na marcação @kody-ignore
     * A marcação pode estar no início ou final do arquivo
     */
    private shouldIgnoreFile(content: string): boolean {
        if (!content || typeof content !== 'string') {
            return false;
        }

        const trimmedContent = content.trim();
        if (!trimmedContent) {
            return false;
        }

        // Verifica as primeiras 10 linhas do arquivo
        const lines = trimmedContent.split('\n');
        const firstLines = lines.slice(0, 10);
        const lastLines = lines.slice(-10);

        // Padrão para detectar @kody-ignore (case insensitive, com possíveis comentários)
        const ignorePattern = /@kody-ignore\b/i;

        // Verifica no início do arquivo
        const hasIgnoreAtStart = firstLines.some((line) =>
            ignorePattern.test(line.trim()),
        );

        // Verifica no final do arquivo
        const hasIgnoreAtEnd = lastLines.some((line) =>
            ignorePattern.test(line.trim()),
        );

        return hasIgnoreAtStart || hasIgnoreAtEnd;
    }

    private async getConfiguredDirectories(
        organizationAndTeamData: OrganizationAndTeamData,
        repositoryId?: string,
    ): Promise<string[]> {
        try {
            const cfg = await this.parametersService.findByKey(
                ParametersKey.CODE_REVIEW_CONFIG,
                organizationAndTeamData,
            );

            // Must have repository context and repository-specific config
            if (!repositoryId || !cfg?.configValue?.repositories) {
                return [];
            }

            const repoConfig = cfg.configValue.repositories.find(
                (repo: any) =>
                    repo.id === repositoryId ||
                    repo.id === repositoryId.toString(),
            );

            if (
                !repoConfig ||
                !repoConfig.directories ||
                repoConfig.directories.length === 0
            ) {
                return [];
            }

            return repoConfig.directories
                .filter(
                    (d): d is { path: string } =>
                        d && typeof d.path === 'string',
                )
                .map((d) => d.path);
        } catch {
            return [];
        }
    }

    private async getDirectoryPatterns(
        organizationAndTeamData: OrganizationAndTeamData,
        repositoryId: string,
    ): Promise<string[]> {
        try {
            const dirs = await this.getConfiguredDirectories(
                organizationAndTeamData,
                repositoryId,
            );

            return dirs.flatMap((d) =>
                RULE_FILE_PATTERNS.map((p) =>
                    path.posix.join(d.startsWith('/') ? d.slice(1) : d, p),
                ),
            );
        } catch {
            return [];
        }
    }
}
