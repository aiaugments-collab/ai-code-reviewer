import { Inject, Injectable } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import {
    processExpression,
    shouldReviewBranches,
    mergeBaseBranches,
} from '../../branchReview.service';
import {
    AUTOMATION_EXECUTION_SERVICE_TOKEN,
    IAutomationExecutionService,
} from '@/core/domain/automation/contracts/automation-execution.service';
import {
    AutomaticReviewStatus,
    ReviewCadenceType,
    ReviewCadenceState,
} from '@/config/types/general/codeReview.type';
import { PinoLoggerService } from '../../../logger/pino.service';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import {
    AutomationMessage,
    AutomationStatus,
} from '@/core/domain/automation/enums/automation-status';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';

@Injectable()
export class ValidateConfigStage extends BasePipelineStage<CodeReviewPipelineContext> {
    stageName = 'ValidateConfigStage';

    constructor(
        @Inject(AUTOMATION_EXECUTION_SERVICE_TOKEN)
        private automationExecutionService: IAutomationExecutionService,
        private codeManagementService: CodeManagementService,
        private logger: PinoLoggerService,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        try {
            if (!context.codeReviewConfig) {
                this.logger.error({
                    message: 'No config found in context',
                    context: this.stageName,
                    metadata: {
                        prNumber: context?.pullRequest?.number,
                        repositoryName: context?.repository?.name,
                    },
                });

                return this.updateContext(context, (draft) => {
                    draft.statusInfo = {
                        status: AutomationStatus.SKIPPED,
                        message: AutomationMessage.NO_CONFIG_IN_CONTEXT,
                    };
                });
            }

            const cadenceResult = await this.evaluateReviewCadence(context);

            if (!cadenceResult.shouldProcess) {
                this.logger.warn({
                    message: cadenceResult.reason,
                    serviceName: ValidateConfigStage.name,
                    context: this.stageName,
                    metadata: {
                        prNumber: context?.pullRequest?.number,
                        repositoryName: context?.repository?.name,
                        id: context?.repository?.id,
                        organizationAndTeamData:
                            context?.organizationAndTeamData,
                        reviewCadence:
                            context.codeReviewConfig?.reviewCadence?.type ||
                            ReviewCadenceType.AUTOMATIC,
                    },
                });

                return this.updateContext(context, (draft) => {
                    draft.statusInfo = {
                        status: AutomationStatus.SKIPPED,
                        message: cadenceResult.reason,
                    };

                    if (cadenceResult.shouldSaveSkipped) {
                        draft.automaticReviewStatus =
                            cadenceResult.automaticReviewStatus;
                    }
                });
            }

            return this.updateContext(context, (draft) => {
                draft.automaticReviewStatus =
                    cadenceResult.automaticReviewStatus;
            });
        } catch (error) {
            this.logger.error({
                message: `Error in ValidateConfigStage for PR#${context?.pullRequest?.number}`,
                error,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context?.organizationAndTeamData,
                    prNumber: context?.pullRequest?.number,
                    repositoryId: context?.repository?.id,
                },
            });

            return this.updateContext(context, (draft) => {
                draft.statusInfo = {
                    status: AutomationStatus.SKIPPED,
                    message: AutomationMessage.CONFIG_VALIDATION_ERROR,
                };
            });
        }
    }

    private async evaluateReviewCadence(
        context: CodeReviewPipelineContext,
    ): Promise<{
        shouldProcess: boolean;
        reason: string;
        shouldSaveSkipped: boolean;
        automaticReviewStatus?: AutomaticReviewStatus;
    }> {
        const config = context.codeReviewConfig!;

        // Validações básicas primeiro
        const basicValidation = this.shouldExecuteReview(
            context.pullRequest.title,
            context.pullRequest.base.ref, // TARGET (base branch - para onde vai o PR)
            context.pullRequest.head.ref, // SOURCE (head branch - de onde vem o PR)
            context.pullRequest.isDraft,
            config,
            context.origin || '',
            context.organizationAndTeamData,
            config.baseBranchDefault, // API base branch from repository
        );

        if (!basicValidation) {
            return {
                shouldProcess: false,
                reason: AutomationMessage.SKIPPED_BY_BASIC_RULES,
                shouldSaveSkipped: false,
            };
        }

        const cadenceType =
            config?.reviewCadence?.type || ReviewCadenceType.AUTOMATIC;

        // Se é comando manual, sempre processa
        if (context.origin === 'command') {
            const currentStatus = await this.getCurrentPRStatus(context);

            let automaticReviewStatus: AutomaticReviewStatus;
            if (currentStatus === ReviewCadenceState.PAUSED) {
                automaticReviewStatus = {
                    previousStatus: ReviewCadenceState.PAUSED,
                    currentStatus: ReviewCadenceState.COMMAND,
                    reasonForChange: 'Review triggered by start-review command',
                };
            } else {
                automaticReviewStatus = {
                    previousStatus: currentStatus,
                    currentStatus: ReviewCadenceState.COMMAND,
                    reasonForChange: 'Review triggered by start-review command',
                };
            }

            return {
                shouldProcess: true,
                reason: AutomationMessage.PROCESSING_MANUAL,
                shouldSaveSkipped: false,
                automaticReviewStatus,
            };
        }

        // Lógica específica por tipo de cadência
        switch (cadenceType) {
            case ReviewCadenceType.AUTOMATIC:
                return await this.handleAutomaticMode(context);

            case ReviewCadenceType.MANUAL:
                return await this.handleManualMode(context);

            case ReviewCadenceType.AUTO_PAUSE:
                return await this.handleAutoPauseMode(context, config);

            default:
                return await this.handleAutomaticMode(context);
        }
    }

    private async handleAutomaticMode(
        context: CodeReviewPipelineContext,
    ): Promise<{
        shouldProcess: boolean;
        reason: string;
        shouldSaveSkipped: boolean;
        automaticReviewStatus?: AutomaticReviewStatus;
    }> {
        return {
            shouldProcess: true,
            reason: AutomationMessage.PROCESSING_AUTOMATIC,
            shouldSaveSkipped: false,
            automaticReviewStatus: {
                previousStatus: ReviewCadenceState.AUTOMATIC,
                currentStatus: ReviewCadenceState.AUTOMATIC,
            },
        };
    }

    private async handleManualMode(
        context: CodeReviewPipelineContext,
    ): Promise<{
        shouldProcess: boolean;
        reason: string;
        shouldSaveSkipped: boolean;
        automaticReviewStatus?: AutomaticReviewStatus;
    }> {
        const hasExistingReview =
            await this.hasExistingSuccessfulReview(context);

        if (!hasExistingReview) {
            return {
                shouldProcess: true,
                reason: AutomationMessage.FIRST_REVIEW_MANUAL,
                shouldSaveSkipped: false,
                automaticReviewStatus: {
                    previousStatus: ReviewCadenceState.AUTOMATIC,
                    currentStatus: ReviewCadenceState.AUTOMATIC,
                },
            };
        }

        const currentStatus = await this.getCurrentPRStatus(context);

        return {
            shouldProcess: false,
            reason: AutomationMessage.MANUAL_REQUIRED_TO_START,
            shouldSaveSkipped: true,
            automaticReviewStatus: {
                previousStatus: currentStatus,
                currentStatus: ReviewCadenceState.PAUSED,
            },
        };
    }

    private async handleAutoPauseMode(
        context: CodeReviewPipelineContext,
        config: any,
    ): Promise<{
        shouldProcess: boolean;
        reason: string;
        shouldSaveSkipped: boolean;
        automaticReviewStatus?: AutomaticReviewStatus;
    }> {
        const hasExistingReview =
            await this.hasExistingSuccessfulReview(context);

        if (!hasExistingReview) {
            return {
                shouldProcess: true,
                reason: AutomationMessage.FIRST_REVIEW_AUTO_PAUSE,
                shouldSaveSkipped: false,
                automaticReviewStatus: {
                    previousStatus: ReviewCadenceState.AUTOMATIC,
                    currentStatus: ReviewCadenceState.AUTOMATIC,
                },
            };
        }

        const currentStatus = await this.getCurrentPRStatus(context);
        if (currentStatus === ReviewCadenceState.PAUSED) {
            return {
                shouldProcess: false,
                reason: AutomationMessage.PR_PAUSED_NEED_RESUME,
                shouldSaveSkipped: true,
                automaticReviewStatus: {
                    previousStatus: ReviewCadenceState.PAUSED,
                    currentStatus: ReviewCadenceState.PAUSED,
                },
            };
        }

        const shouldPause = await this.shouldPauseForBurst(context, config);

        if (shouldPause) {
            const pauseCommentId = await this.createPauseComment(context);

            return {
                shouldProcess: false,
                reason: AutomationMessage.PR_PAUSED_BURST_PUSHES,
                shouldSaveSkipped: true,
                automaticReviewStatus: {
                    previousStatus: ReviewCadenceState.AUTOMATIC,
                    currentStatus: ReviewCadenceState.PAUSED,
                    reasonForChange:
                        'Multiple pushes detected in short time window',
                    pauseCommentId: pauseCommentId || undefined,
                },
            };
        }

        return {
            shouldProcess: true,
            reason: AutomationMessage.PROCESSING_AUTO_PAUSE,
            shouldSaveSkipped: false,
            automaticReviewStatus: {
                previousStatus: ReviewCadenceState.AUTOMATIC,
                currentStatus: ReviewCadenceState.AUTOMATIC,
            },
        };
    }

    private async hasExistingSuccessfulReview(
        context: CodeReviewPipelineContext,
    ): Promise<boolean> {
        const executions =
            await this.automationExecutionService.findLatestExecutionByFilters({
                status: AutomationStatus.SUCCESS,
                teamAutomation: { uuid: context.teamAutomationId },
                pullRequestNumber: context.pullRequest.number,
                repositoryId: context?.repository?.id,
            });

        return !!executions;
    }

    private async getCurrentPRStatus(
        context: CodeReviewPipelineContext,
    ): Promise<ReviewCadenceState> {
        const latestExecution =
            await this.automationExecutionService.findLatestExecutionByFilters({
                teamAutomation: { uuid: context.teamAutomationId },
                pullRequestNumber: context.pullRequest.number,
                repositoryId: context?.repository?.id,
            });

        if (!latestExecution?.dataExecution?.automaticReviewStatus) {
            return ReviewCadenceState.AUTOMATIC;
        }

        return (
            latestExecution.dataExecution.automaticReviewStatus.currentStatus ||
            ReviewCadenceState.AUTOMATIC
        );
    }

    private async shouldPauseForBurst(
        context: CodeReviewPipelineContext,
        config: any,
    ): Promise<boolean> {
        const pushesToTrigger = config.reviewCadence?.pushesToTrigger || 3;
        const timeWindowMinutes = config.reviewCadence?.timeWindow || 15;

        const timeWindowStart = new Date();
        timeWindowStart.setMinutes(
            timeWindowStart.getMinutes() - timeWindowMinutes,
        );

        const recentExecutions = await this.getRecentSuccessfulExecutions(
            context,
            timeWindowStart,
        );

        return recentExecutions.length >= pushesToTrigger;
    }

    private async getRecentSuccessfulExecutions(
        context: CodeReviewPipelineContext,
        since: Date,
    ): Promise<any[]> {
        try {
            const now = new Date();
            const executions =
                await this.automationExecutionService.findByPeriodAndTeamAutomationId(
                    since,
                    now,
                    context.teamAutomationId,
                );

            if (
                !executions ||
                !context?.repository?.id ||
                !context?.pullRequest?.number
            ) {
                return [];
            }

            return executions?.filter(
                (execution) =>
                    execution.status === AutomationStatus.SUCCESS &&
                    execution.pullRequestNumber ===
                        context.pullRequest.number &&
                    execution.repositoryId === context?.repository?.id,
            );
        } catch (error) {
            this.logger.error({
                message: `Failed to get recent executions for PR #${context.pullRequest.number}`,
                context: ValidateConfigStage.name,
                error,
            });
            return [];
        }
    }

    private async createPauseComment(
        context: CodeReviewPipelineContext,
    ): Promise<string | null> {
        try {
            const commentBody =
                "Auto-paused – comment @kody start-review when you're ready.";

            const comment =
                await this.codeManagementService.createSingleIssueComment({
                    organizationAndTeamData: context.organizationAndTeamData,
                    repository: context.repository,
                    prNumber: context.pullRequest.number,
                    body: commentBody,
                });

            return comment?.id || null;
        } catch (error) {
            this.logger.error({
                message: `Failed to create pause comment for PR #${context.pullRequest.number}`,
                context: ValidateConfigStage.name,
                error,
            });
            return null;
        }
    }

    private shouldExecuteReview(
        title: string,
        targetBranch: string, // TARGET (base branch - para onde vai o PR)
        sourceBranch: string, // SOURCE (head branch - de onde vem o PR)
        isDraft: boolean,
        config: any,
        origin: string,
        organizationAndTeamData: OrganizationAndTeamData,
        apiBaseBranch?: string,
    ): boolean {
        if (origin === 'command') {
            return true;
        }

        if (!config?.automatedReviewActive) {
            return false;
        }

        if (
            config?.ignoredTitleKeywords?.some((keyword: string) =>
                title?.toLowerCase().includes(keyword.toLowerCase()),
            )
        ) {
            return false;
        }

        if (config?.baseBranches && Array.isArray(config.baseBranches)) {
            const mergedBranches = mergeBaseBranches(
                config.baseBranches,
                apiBaseBranch || targetBranch,
            );
            const expression = mergedBranches.join(', ');
            const reviewConfig = processExpression(expression);

            const resultValidation = shouldReviewBranches(
                sourceBranch,
                targetBranch,
                reviewConfig,
            );

            // Log das configurações usadas para gerar o resultValidation
            this.logger.log({
                message: '🔍 Branch Review Validation',
                context: 'ValidateConfigStage',
                metadata: {
                    originalConfig: config.baseBranches,
                    apiBaseBranch,
                    mergedBranches,
                    expression,
                    sourceBranch,
                    targetBranch,
                    reviewConfig,
                    result: resultValidation ? 'REVIEW' : 'NO_REVIEW',
                    organizationAndTeamData,
                },
            });

            return resultValidation;
        }

        if (!config.baseBranches?.includes(targetBranch)) {
            return false;
        }

        if (isDraft && !config?.runOnDraft) {
            return false;
        }

        return true;
    }
}
