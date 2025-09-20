import { Inject, Injectable } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import {
    CODE_BASE_CONFIG_SERVICE_TOKEN,
    ICodeBaseConfigService,
} from '@/core/domain/codeBase/contracts/CodeBaseConfigService.contract';
import {
    PULL_REQUEST_MANAGER_SERVICE_TOKEN,
    IPullRequestManagerService,
} from '@/core/domain/codeBase/contracts/PullRequestManagerService.contract';
import { PinoLoggerService } from '../../../logger/pino.service';
import {
    AutomationMessage,
    AutomationStatus,
} from '@/core/domain/automation/enums/automation-status';

@Injectable()
export class ResolveConfigStage extends BasePipelineStage<CodeReviewPipelineContext> {
    readonly stageName = 'ResolveConfigStage';

    constructor(
        @Inject(CODE_BASE_CONFIG_SERVICE_TOKEN)
        private readonly codeBaseConfigService: ICodeBaseConfigService,
        @Inject(PULL_REQUEST_MANAGER_SERVICE_TOKEN)
        private readonly pullRequestHandlerService: IPullRequestManagerService,
        private readonly logger: PinoLoggerService,
    ) {
        super();
    }

    protected override async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        try {
            // Verificar se existem configurações por diretório no repositório específico
            const directoryConfigsResult =
                await this.codeBaseConfigService.getDirectoryConfigs(
                    context.organizationAndTeamData,
                    context.repository,
                );

            if (!directoryConfigsResult.hasConfigs) {
                // Não há configs por diretório, usar lógica tradicional
                this.logger.log({
                    message:
                        'No directory configs found, using traditional config resolution',
                    context: this.stageName,
                    metadata: {
                        organizationAndTeamData:
                            context.organizationAndTeamData,
                        repository: context.repository.name,
                        pullRequestNumber: context.pullRequest.number,
                    },
                });

                const config = await this.codeBaseConfigService.getConfig(
                    context.organizationAndTeamData,
                    context.repository,
                );

                return this.updateContext(context, (draft) => {
                    draft.codeReviewConfig = config;
                });
            }

            // Existem configs por diretório, buscar arquivos para identificar diretórios afetados
            this.logger.log({
                message:
                    'Directory configs found, analyzing affected directories',
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    repository: context.repository.name,
                    pullRequestNumber: context.pullRequest.number,
                },
            });

            const preliminaryFiles =
                await this.pullRequestHandlerService.getChangedFiles(
                    context.organizationAndTeamData,
                    context.repository,
                    context.pullRequest,
                    [], // Sem ignorePaths ainda, vamos aplicar depois
                    context?.lastExecution?.lastAnalyzedCommit,
                );

            if (!preliminaryFiles || preliminaryFiles.length === 0) {
                this.logger.warn({
                    message: 'No files found in PR',
                    context: this.stageName,
                    metadata: {
                        organizationAndTeamData:
                            context.organizationAndTeamData,
                        repository: context.repository.name,
                        pullRequestNumber: context.pullRequest.number,
                    },
                });

                return this.updateContext(context, (draft) => {
                    draft.statusInfo = {
                        status: AutomationStatus.SKIPPED,
                        message: AutomationMessage.NO_FILES_IN_PR,
                    };
                });
            }

            // Extrair caminhos únicos dos arquivos
            const affectedPaths =
                this.codeBaseConfigService.extractUniqueDirectoryPaths(
                    preliminaryFiles,
                );

            this.logger.log({
                message: `Extracted ${affectedPaths.length} unique directory paths`,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    repository: context.repository.name,
                    pullRequestNumber: context.pullRequest.number,
                },
            });

            // Resolver configuração baseada nos diretórios afetados
            const resolvedConfig =
                await this.codeBaseConfigService.resolveConfigByDirectories(
                    context.organizationAndTeamData,
                    context.repository,
                    affectedPaths,
                    directoryConfigsResult.repoConfig,
                );

            this.logger.log({
                message:
                    'Config resolved successfully based on affected directories',
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    repository: context.repository.name,
                    pullRequestNumber: context.pullRequest.number,
                },
            });

            return this.updateContext(context, (draft) => {
                draft.codeReviewConfig = resolvedConfig;
            });
        } catch (error) {
            this.logger.error({
                message: `Error in ResolveConfigStage for PR#${context?.pullRequest?.number}`,
                error,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context?.organizationAndTeamData,
                    prNumber: context?.pullRequest?.number,
                    repositoryId: context?.repository?.id,
                },
            });

            // Fallback para config tradicional
            try {
                const fallbackConfig =
                    await this.codeBaseConfigService.getConfig(
                        context.organizationAndTeamData,
                        context.repository,
                    );

                return this.updateContext(context, (draft) => {
                    draft.codeReviewConfig = fallbackConfig;
                });
            } catch (fallbackError) {
                this.logger.error({
                    message: `Fallback config also failed for PR#${context?.pullRequest?.number}`,
                    error: fallbackError,
                    context: this.stageName,
                    metadata: {
                        organizationAndTeamData:
                            context?.organizationAndTeamData,
                        prNumber: context?.pullRequest?.number,
                        repositoryId: context?.repository?.id,
                    },
                });

                return this.updateContext(context, (draft) => {
                    draft.statusInfo = {
                        status: AutomationStatus.SKIPPED,
                        message: AutomationMessage.FAILED_RESOLVE_CONFIG,
                    };
                });
            }
        }
    }
}
