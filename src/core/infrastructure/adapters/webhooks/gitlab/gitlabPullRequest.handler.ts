import { Injectable } from '@nestjs/common';
import {
    IWebhookEventHandler,
    IWebhookEventParams,
} from '@/core/domain/platformIntegrations/interfaces/webhook-event-handler.interface';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { SavePullRequestUseCase } from '@/core/application/use-cases/pullRequests/save.use-case';
import { RunCodeReviewAutomationUseCase } from '@/ee/automation/runCodeReview.use-case';
import { ChatWithKodyFromGitUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/chatWithKodyFromGit.use-case';
import { getMappedPlatform } from '@/shared/utils/webhooks';
import { GenerateIssuesFromPrClosedUseCase } from '@/core/application/use-cases/issues/generate-issues-from-pr-closed.use-case';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { KodyRulesSyncService } from '../../services/kodyRules/kodyRulesSync.service';

/**
 * Handler for GitLab webhook events.
 * Processes both merge request and comment events.
 */
@Injectable()
export class GitLabMergeRequestHandler implements IWebhookEventHandler {
    constructor(
        private readonly logger: PinoLoggerService,
        private readonly savePullRequestUseCase: SavePullRequestUseCase,
        private readonly runCodeReviewAutomationUseCase: RunCodeReviewAutomationUseCase,
        private readonly chatWithKodyFromGitUseCase: ChatWithKodyFromGitUseCase,
        private readonly generateIssuesFromPrClosedUseCase: GenerateIssuesFromPrClosedUseCase,
        private readonly kodyRulesSyncService: KodyRulesSyncService,
        private readonly codeManagement: CodeManagementService,
    ) {}

    /**
     * Checks if this handler can process the given webhook event.
     * @param params The webhook event parameters.
     * @returns True if this handler can process the event, false otherwise.
     */
    public canHandle(params: IWebhookEventParams): boolean {
        return (
            params.platformType === PlatformType.GITLAB &&
            ['Merge Request Hook', 'Note Hook'].includes(params.event)
        );
    }

    /**
     * Processes GitLab webhook events.
     * @param params The webhook event parameters.
     */
    public async execute(params: IWebhookEventParams): Promise<void> {
        const { event } = params;

        // Direcionar para o método apropriado com base no tipo de evento
        switch (event) {
            case 'Merge Request Hook':
                await this.handleMergeRequest(params);
                break;
            case 'Note Hook':
                await this.handleComment(params);
                break;
            default:
                this.logger.warn({
                    message: `Unsupported GitLab event: ${event}`,
                    context: GitLabMergeRequestHandler.name,
                });
        }
    }

    private async handleMergeRequest(
        params: IWebhookEventParams,
    ): Promise<void> {
        const { payload } = params;
        const mrNumber = payload?.object_attributes?.iid;
        const mrUrl = payload?.object_attributes?.url;

        this.logger.log({
            context: GitLabMergeRequestHandler.name,
            serviceName: GitLabMergeRequestHandler.name,
            message: `Processing GitLab 'Merge Request Hook' event for MR #${mrNumber} (${mrUrl || 'URL not found'})`,
            metadata: { mrNumber, mrUrl },
        });

        const repository = {
            id: String(payload?.project?.id),
            name: payload?.project?.path,
            fullName: payload?.project?.path_with_namespace,
        } as any;

        const orgData =
            await this.runCodeReviewAutomationUseCase.findTeamWithActiveCodeReview(
                {
                    repository: {
                        id: String(payload?.project?.id),
                        name: payload?.project?.path,
                    },
                    platformType: PlatformType.GITLAB,
                },
            );

        try {
            // Check if we should trigger code review based on the MR action
            if (this.shouldTriggerCodeReviewForGitLab(payload)) {
                await this.savePullRequestUseCase.execute(params);

                // Intentionally not awaiting this, as per original logic
                this.runCodeReviewAutomationUseCase.execute(params);

                if (payload?.object_attributes?.action === 'merge') {
                    await this.generateIssuesFromPrClosedUseCase.execute(
                        params,
                    );

                    // Sync Kody Rules after merge into target branch
                    try {
                        if (orgData?.organizationAndTeamData) {
                            const baseRef =
                                payload?.object_attributes?.target_branch;
                            const defaultBranch =
                                await this.codeManagement.getDefaultBranch({
                                    organizationAndTeamData:
                                        orgData.organizationAndTeamData,
                                    repository: {
                                        id: repository.id,
                                        name: repository.name,
                                    },
                                });
                            if (baseRef !== defaultBranch) {
                                return;
                            }
                            const changedFiles =
                                await this.codeManagement.getFilesByPullRequestId(
                                    {
                                        organizationAndTeamData:
                                            orgData.organizationAndTeamData,
                                        repository: {
                                            id: repository.id,
                                            name: repository.name,
                                        },
                                        prNumber:
                                            payload?.object_attributes?.iid,
                                    },
                                );
                            await this.kodyRulesSyncService.syncFromChangedFiles(
                                {
                                    organizationAndTeamData:
                                        orgData.organizationAndTeamData,
                                    repository,
                                    pullRequestNumber:
                                        payload?.object_attributes?.iid,
                                    files: changedFiles || [],
                                },
                            );
                        }
                    } catch (e) {
                        this.logger.error({
                            message: 'Failed to sync Kody Rules after MR merge',
                            context: GitLabMergeRequestHandler.name,
                            error: e,
                        });
                    }
                }

                return;
            } else if (
                payload?.object_attributes?.action === 'close' ||
                payload?.object_attributes?.action === 'merge' ||
                payload?.object_attributes?.action === 'update'
            ) {
                // For closed or merged MRs, just save the state without triggering automation
                await this.savePullRequestUseCase.execute(params);

                if (payload?.object_attributes?.action === 'merge') {
                    await this.generateIssuesFromPrClosedUseCase.execute(
                        params,
                    );
                }

                return;
            }
        } catch (error) {
            this.logger.error({
                context: GitLabMergeRequestHandler.name,
                serviceName: GitLabMergeRequestHandler.name,
                metadata: {
                    mrNumber,
                    mrUrl,
                    organizationAndTeamData: orgData?.organizationAndTeamData,
                },
                message: `Error processing GitLab merge request #${mrNumber}: ${error.message}`,
                error,
            });
            throw error;
        }
    }

    /**
     * Processa eventos de comentário do GitLab
     */
    private async handleComment(params: IWebhookEventParams): Promise<void> {
        const { payload } = params;
        const mrNumber = payload?.object_attributes?.iid;

        try {
            // Verify if the action is create
            if (payload?.object_attributes?.action === 'create') {
                // Extract comment data
                const mappedPlatform = getMappedPlatform(PlatformType.GITLAB);
                if (!mappedPlatform) {
                    this.logger.error({
                        message: 'Could not get mapped platform for GitLab.',
                        serviceName: GitLabMergeRequestHandler.name,
                        metadata: { mrNumber },
                        context: GitLabMergeRequestHandler.name,
                    });
                    return;
                }

                const comment = mappedPlatform.mapComment({ payload });
                if (!comment || !comment.body) {
                    this.logger.debug({
                        message: 'Comment body empty, skipping.',
                        serviceName: GitLabMergeRequestHandler.name,
                        metadata: { mrNumber },
                        context: GitLabMergeRequestHandler.name,
                    });
                    return;
                }

                // Verify if it is a start-review command
                const commandPattern = /^\s*@kody\s+start-review/i;
                const isStartCommand = commandPattern.test(comment.body);

                // Verify if it has the review marker
                const reviewMarkerPattern = /<!--\s*kody-codereview\s*-->/i;
                const hasReviewMarker = reviewMarkerPattern.test(comment.body);

                // Verify if the comment mentions Kody and is not a start-review command
                const kodyMentionPattern = /^\s*@kody\b(?!\s+start-review)/i;

                if (isStartCommand && !hasReviewMarker) {
                    this.logger.log({
                        message: `@kody start command detected in GitLab comment for PR#${mrNumber}`,
                        serviceName: GitLabMergeRequestHandler.name,
                        metadata: { mrNumber },
                        context: GitLabMergeRequestHandler.name,
                    });

                    // Prepare params for use cases
                    const updatedParams = {
                        ...params,
                        payload: {
                            ...payload,
                            action: 'synchronize',
                            origin: 'command',
                        },
                    };

                    await this.savePullRequestUseCase.execute(updatedParams);
                    this.runCodeReviewAutomationUseCase.execute(updatedParams);
                    return;
                }

                if (
                    !isStartCommand &&
                    !hasReviewMarker &&
                    kodyMentionPattern.test(comment.body)
                ) {
                    this.chatWithKodyFromGitUseCase.execute(params);
                    return;
                }
            }
        } catch (error) {
            this.logger.error({
                context: GitLabMergeRequestHandler.name,
                serviceName: GitLabMergeRequestHandler.name,
                metadata: { mrNumber },
                message: `Error processing GitLab comment: ${error.message}`,
                error,
            });
            throw error;
        }
    }

    private shouldTriggerCodeReviewForGitLab(params: any): boolean {
        const objectAttributes = params?.object_attributes || {};
        const changes = params?.changes || {};

        // Verify if it's a new MR
        if (objectAttributes.action === 'open') {
            return true;
        }

        // Verify if it's a new commit
        const lastCommitId = objectAttributes.last_commit?.id;
        const oldRev = objectAttributes.oldrev;

        if (lastCommitId && oldRev && lastCommitId !== oldRev) {
            return true;
        }

        // Verify if it's a merge
        if (
            objectAttributes.state === 'merged' ||
            objectAttributes.action === 'merge'
        ) {
            return true;
        }

        // Verify if the PR is closed.
        if (
            objectAttributes.state === 'closed' ||
            objectAttributes.action === 'close'
        ) {
            return true;
        }

        // Ignore if it's an update to the description
        if (objectAttributes.action === 'update' && changes.description) {
            return false;
        }

        if (
            objectAttributes.action === 'update' &&
            changes?.draft &&
            changes.draft.previous === true &&
            changes.draft.current === false
        ) {
            return true;
        }

        // For all other cases, return false
        return false;
    }
}
