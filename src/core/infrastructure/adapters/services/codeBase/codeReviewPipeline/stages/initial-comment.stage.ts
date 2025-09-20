import { Inject, Injectable } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import {
    COMMENT_MANAGER_SERVICE_TOKEN,
    ICommentManagerService,
} from '@/core/domain/codeBase/contracts/CommentManagerService.contract';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import {
    ConfigLevel,
    PullRequestMessageStatus,
    PullRequestMessageType,
} from '@/config/types/general/pullRequestMessages.type';
import {
    PULL_REQUEST_MESSAGES_SERVICE_TOKEN,
    IPullRequestMessagesService,
} from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { GLOBAL_MODULE_METADATA } from '@nestjs/common/constants';
import { IPullRequestMessages } from '@/core/domain/pullRequestMessages/interfaces/pullRequestMessages.interface';

@Injectable()
export class InitialCommentStage extends BasePipelineStage<CodeReviewPipelineContext> {
    stageName = 'InitialCommentStage';

    constructor(
        @Inject(COMMENT_MANAGER_SERVICE_TOKEN)
        private commentManagerService: ICommentManagerService,

        @Inject(PULL_REQUEST_MESSAGES_SERVICE_TOKEN)
        private readonly pullRequestMessagesService: IPullRequestMessagesService,

        private readonly logger: PinoLoggerService,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        const pullRequestMessagesConfig =
            await this.setPullRequestMessagesConfig(context);

        if (
            context.lastExecution &&
            context.platformType === PlatformType.GITHUB
        ) {
            this.logger.log({
                message: `Minimizing previous review comment for subsequent review on PR#${context.pullRequest.number}`,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                    repository: context.repository.name,
                    lastExecution: context.lastExecution,
                },
            });

            try {
                await this.commentManagerService.minimizeLastReviewComment(
                    context.organizationAndTeamData,
                    context.pullRequest.number,
                    context.repository,
                    context.platformType,
                );
            } catch (error) {
                this.logger.warn({
                    message: `Failed to minimize previous review comment for PR#${context.pullRequest.number}, continuing with new review`,
                    context: this.stageName,
                    error: error.message,
                    metadata: {
                        organizationAndTeamData:
                            context.organizationAndTeamData,
                        prNumber: context.pullRequest.number,
                    },
                });
            }
        }

        const startReviewMessage =
            pullRequestMessagesConfig?.startReviewMessage;

        if (
            startReviewMessage &&
            startReviewMessage.status === PullRequestMessageStatus.INACTIVE
        ) {
            this.logger.log({
                message: `Skipping initial comment for PR#${context.pullRequest.number} with start review message because it is inactive`,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                    repository: context.repository.name,
                },
            });

            return this.updateContext(context, (draft) => {
                draft.pullRequestMessagesConfig = pullRequestMessagesConfig;
            });
        }

        const result = await this.commentManagerService.createInitialComment(
            context.organizationAndTeamData,
            context.pullRequest.number,
            context.repository,
            context.changedFiles,
            context.codeReviewConfig?.languageResultPrompt ?? 'en-US',
            context.platformType,
            context.codeReviewConfig,
            startReviewMessage?.content,
        );

        return this.updateContext(context, (draft) => {
            draft.initialCommentData = result;
            draft.pullRequestMessagesConfig = pullRequestMessagesConfig;
        });
    }

    private async setPullRequestMessagesConfig(
        context: CodeReviewPipelineContext,
    ): Promise<IPullRequestMessages | null> {
        const repositoryId = context.repository.id;
        const organizationId = context.organizationAndTeamData.organizationId;

        let pullRequestMessagesConfig = null;

        if (context.codeReviewConfig?.configLevel === ConfigLevel.DIRECTORY) {
            pullRequestMessagesConfig =
                await this.pullRequestMessagesService.findOne({
                    organizationId,
                    repositoryId,
                    directoryId: context.codeReviewConfig?.directoryId,
                    configLevel: ConfigLevel.DIRECTORY,
                });
        }

        if (!pullRequestMessagesConfig) {
            pullRequestMessagesConfig =
                await this.pullRequestMessagesService.findOne({
                    organizationId,
                    repositoryId,
                    configLevel: ConfigLevel.REPOSITORY,
                });
        }

        if (!pullRequestMessagesConfig) {
            pullRequestMessagesConfig =
                await this.pullRequestMessagesService.findOne({
                    organizationId,
                    configLevel: ConfigLevel.GLOBAL,
                });
        }

        return pullRequestMessagesConfig;
    }
}
