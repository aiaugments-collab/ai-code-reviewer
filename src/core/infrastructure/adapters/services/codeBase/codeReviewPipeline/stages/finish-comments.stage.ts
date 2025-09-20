import { Injectable, Inject } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import {
    COMMENT_MANAGER_SERVICE_TOKEN,
    ICommentManagerService,
} from '@/core/domain/codeBase/contracts/CommentManagerService.contract';
import { PinoLoggerService } from '../../../logger/pino.service';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { PullRequestMessageStatus } from '@/config/types/general/pullRequestMessages.type';
import { BehaviourForNewCommits } from '@/config/types/general/codeReview.type';

@Injectable()
export class UpdateCommentsAndGenerateSummaryStage extends BasePipelineStage<CodeReviewPipelineContext> {
    readonly stageName = 'UpdateCommentsAndGenerateSummaryStage';

    constructor(
        @Inject(COMMENT_MANAGER_SERVICE_TOKEN)
        private readonly commentManagerService: ICommentManagerService,

        private readonly logger: PinoLoggerService,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        const {
            lastExecution,
            codeReviewConfig,
            overallComments,
            repository,
            pullRequest,
            organizationAndTeamData,
            platformType,
            initialCommentData,
            lineComments,
        } = context;

        const isCommitRun = Boolean(lastExecution);
        const commitBehaviour =
            codeReviewConfig?.summary?.behaviourForNewCommits ??
            BehaviourForNewCommits.NONE;

        const shouldGenerateOrUpdateSummary =
            (!isCommitRun && codeReviewConfig?.summary?.generatePRSummary) ||
            (isCommitRun &&
                codeReviewConfig?.summary?.generatePRSummary &&
                commitBehaviour !== BehaviourForNewCommits.NONE);

        if (
            !initialCommentData &&
            !context.pullRequestMessagesConfig?.startReviewMessage
        ) {
            this.logger.warn({
                message: `Missing initialCommentData for PR#${pullRequest.number}`,
                context: this.stageName,
            });
            return context;
        }

        if (shouldGenerateOrUpdateSummary) {
            this.logger.log({
                message: `Generating summary for PR#${pullRequest.number}`,
                context: this.stageName,
                metadata: {
                        organizationAndTeamData,
                        prNumber: context.pullRequest.number,
                        repository: context.repository,
                    },
            });

            const changedFiles = context.changedFiles.map((file) => ({
                filename: file.filename,
                patch: file.patch,
                status: file.status,
            }));

            const summaryPR =
                await this.commentManagerService.generateSummaryPR(
                    pullRequest,
                    repository,
                    changedFiles,
                    organizationAndTeamData,
                    codeReviewConfig.languageResultPrompt,
                    codeReviewConfig.summary,
                    isCommitRun,
                );

            await this.commentManagerService.updateSummarizationInPR(
                organizationAndTeamData,
                pullRequest.number,
                repository,
                summaryPR,
            );
        }

        const endReviewMessage =
            context.pullRequestMessagesConfig?.endReviewMessage;

        if (
            !context.pullRequestMessagesConfig?.startReviewMessage &&
            !endReviewMessage
        ) {
            await this.commentManagerService.updateOverallComment(
                organizationAndTeamData,
                pullRequest.number,
                repository,
                initialCommentData.commentId,
                initialCommentData.noteId,
                platformType,
                lineComments,
                codeReviewConfig,
                initialCommentData.threadId,
            );
        } else {
            if (
                endReviewMessage &&
                endReviewMessage.status === PullRequestMessageStatus.INACTIVE
            ) {
                this.logger.log({
                    message: `Skipping comment for PR#${context.pullRequest.number} with finish review message because it is inactive`,
                    context: UpdateCommentsAndGenerateSummaryStage.name,
                    metadata: {
                        organizationAndTeamData,
                        prNumber: context.pullRequest.number,
                        repository: context.repository,
                    },
                });
                return context;
            }

            await this.commentManagerService.createComment(
                organizationAndTeamData,
                pullRequest.number,
                repository,
                platformType,
                context.changedFiles,
                context.codeReviewConfig?.languageResultPrompt ?? 'en-US',
                lineComments,
                codeReviewConfig,
                endReviewMessage,
            );
        }

        return context;
    }
}
