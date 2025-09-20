import { Injectable } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { CodeManagementService } from '../../../platformIntegration/codeManagement.service';
import { PinoLoggerService } from '../../../logger/pino.service';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { CommentResult } from '@/config/types/general/codeReview.type';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { PullRequestReviewState } from '@/core/domain/platformIntegrations/types/codeManagement/pullRequests.type';

@Injectable()
export class RequestChangesOrApproveStage extends BasePipelineStage<CodeReviewPipelineContext> {
    readonly stageName = 'RequestChangesOrApproveStage';

    constructor(
        private readonly codeManagementService: CodeManagementService,
        private readonly logger: PinoLoggerService,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        const {
            lineComments,
            pullRequest,
            organizationAndTeamData,
            repository,
            codeReviewConfig,
        } = context;

        if (!lineComments) {
            this.logger.warn({
                message: `No line comments available for PR#${pullRequest.number}, skipping request changes/approve`,
                context: this.stageName,
            });
            return context;
        }

        // Solicitar mudanças se houver comentários críticos
        await this.requestChangesIfCritical(
            codeReviewConfig.isRequestChangesActive,
            pullRequest.number,
            organizationAndTeamData,
            repository,
            lineComments,
        );

        // Aprovar PR se não houver comentários
        await this.approvePullRequest(
            codeReviewConfig.pullRequestApprovalActive,
            lineComments.length,
            organizationAndTeamData,
            pullRequest.number,
            repository,
        );

        this.logger.log({
            message: `Finished processing PR#${pullRequest.number}`,
            context: this.stageName,
            metadata: {
                lineCommentsCount: lineComments.length,
                organizationId: organizationAndTeamData.organizationId,
                teamId: organizationAndTeamData.teamId,
            },
        });

        return context;
    }

    /**
     * Solicita mudanças no PR se houver comentários críticos
     */
    private async requestChangesIfCritical(
        isRequestChanges: boolean,
        prNumber: number,
        organizationAndTeamData: OrganizationAndTeamData,
        repository: { id: string; name: string },
        lineComments: CommentResult[],
    ): Promise<void> {
        try {
            if (!isRequestChanges) {
                return;
            }

            const criticalComments = lineComments.filter(
                (comment) =>
                    comment.comment.suggestion?.severity ===
                    SeverityLevel.CRITICAL,
            );

            if (criticalComments.length === 0) {
                return;
            }

            this.logger.log({
                message: `Requesting changes for PR#${prNumber} due to ${criticalComments.length} critical comments`,
                context: this.stageName,
            });

            await this.codeManagementService.requestChangesPullRequest({
                organizationAndTeamData,
                prNumber,
                repository,
                criticalComments,
            });
        } catch (error) {
            this.logger.error({
                message: `Error requesting changes for PR#${prNumber}`,
                error,
                context: this.stageName,
            });
        }
    }

    /**
     * Aprova o PR se não houver comentários
     */
    private async approvePullRequest(
        pullRequestApprovalActive: boolean,
        lineCommentsLength: number,
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        repository: { id: string; name: string },
    ): Promise<void> {
        try {
            if (!pullRequestApprovalActive || lineCommentsLength > 0) return;

            const status =
                await this.codeManagementService.getReviewStatusByPullRequest({
                    organizationAndTeamData,
                    prNumber,
                    repository,
                });

            if (status === PullRequestReviewState.APPROVED) {
                this.logger.log({
                    message: `PR#${prNumber} is already approved, skipping approval`,
                    metadata: { currentStatus: status, prNumber, repository },
                    context: this.stageName,
                });
                return;
            }

            if (status === PullRequestReviewState.CHANGES_REQUESTED) {
                this.logger.log({
                    message: `PR#${prNumber} has changes requested, cannot approve`,
                    metadata: { currentStatus: status, prNumber, repository },
                    context: this.stageName,
                });
                return;
            }

            this.logger.log({
                message: `Approving PR#${prNumber} as no new issues were found and status is clear.`,
                metadata: { currentStatus: status, prNumber, repository },
                context: this.stageName,
            });

            await this.codeManagementService.approvePullRequest({
                organizationAndTeamData,
                prNumber,
                repository,
            });
        } catch (error) {
            this.logger.error({
                message: `Error approving PR#${prNumber}`,
                error,
                context: this.stageName,
            });
        }
    }
}
