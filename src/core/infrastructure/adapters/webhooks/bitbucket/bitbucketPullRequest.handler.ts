import { Inject, Injectable } from '@nestjs/common';
import {
    IWebhookEventHandler,
    IWebhookEventParams,
} from '@/core/domain/platformIntegrations/interfaces/webhook-event-handler.interface';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { SavePullRequestUseCase } from '@/core/application/use-cases/pullRequests/save.use-case';
import { RunCodeReviewAutomationUseCase } from '@/ee/automation/runCodeReview.use-case';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { ChatWithKodyFromGitUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/chatWithKodyFromGit.use-case';
import { IntegrationConfigKey } from '@/shared/domain/enums/Integration-config-key.enum';
import {
    INTEGRATION_CONFIG_SERVICE_TOKEN,
    IIntegrationConfigService,
} from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import {
    PULL_REQUESTS_SERVICE_TOKEN,
    IPullRequestsService,
} from '@/core/domain/pullRequests/contracts/pullRequests.service.contracts';
import { CodeManagementService } from '../../services/platformIntegration/codeManagement.service';
import { IWebhookBitbucketPullRequestEvent } from '@/core/domain/platformIntegrations/types/webhooks/webhooks-bitbucket.type';
import { getMappedPlatform } from '@/shared/utils/webhooks';
import { GenerateIssuesFromPrClosedUseCase } from '@/core/application/use-cases/issues/generate-issues-from-pr-closed.use-case';
import { KodyRulesSyncService } from '../../services/kodyRules/kodyRulesSync.service';

/**
 * Handler for Bitbucket webhook events.
 * Processes both pull request and comment events.
 */
@Injectable()
export class BitbucketPullRequestHandler implements IWebhookEventHandler {
    constructor(
        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IIntegrationConfigService,
        @Inject(PULL_REQUESTS_SERVICE_TOKEN)
        private readonly pullRequestsService: IPullRequestsService,

        private readonly logger: PinoLoggerService,
        private readonly savePullRequestUseCase: SavePullRequestUseCase,
        private readonly runCodeReviewAutomationUseCase: RunCodeReviewAutomationUseCase,
        private readonly chatWithKodyFromGitUseCase: ChatWithKodyFromGitUseCase,
        private readonly codeManagement: CodeManagementService,
        private readonly generateIssuesFromPrClosedUseCase: GenerateIssuesFromPrClosedUseCase,
        private readonly kodyRulesSyncService: KodyRulesSyncService,
    ) {}

    /**
     * Checks if this handler can process the given webhook event.
     * @param params The webhook event parameters.
     * @returns True if this handler can process the event, false otherwise.
     */
    public canHandle(params: IWebhookEventParams): boolean {
        return (
            params.platformType === PlatformType.BITBUCKET &&
            [
                'pullrequest:created',
                'pullrequest:updated',
                'pullrequest:fulfilled',
                'pullrequest:rejected',
                'pullrequest:comment_created',
            ].includes(params.event)
        );
    }

    /**
     * Processes Bitbucket webhook events.
     * @param params The webhook event parameters.
     */
    public async execute(params: IWebhookEventParams): Promise<void> {
        const { event } = params;

        if (event === 'pullrequest:comment_created') {
            await this.handleComment(params);
        } else {
            await this.handlePullRequest(params);
        }
    }

    private async handlePullRequest(
        params: IWebhookEventParams,
    ): Promise<void> {
        const { payload, event } = params;
        const prId = payload?.pullrequest?.id;
        const prUrl = payload?.pullrequest?.links?.html?.href;

        this.logger.log({
            context: BitbucketPullRequestHandler.name,
            serviceName: BitbucketPullRequestHandler.name,
            metadata: {
                prId,
                prUrl,
                event,
            },
            message: `Processing Bitbucket '${event}' event for PR #${prId} (${
                prUrl || 'URL not found'
            })`,
        });

        const repository = {
            id: payload?.repository?.uuid?.replace(/[{}]/g, ''),
            name: payload?.repository?.name,
            fullName: payload?.repository?.full_name,
        } as any;

        const orgData =
            await this.runCodeReviewAutomationUseCase.findTeamWithActiveCodeReview(
                {
                    repository: {
                        id: repository.id,
                        name: repository.name,
                    },
                    platformType: PlatformType.BITBUCKET,
                },
            );

        try {
            // Check if we should trigger code review based on the PR event
            const shouldTrigger = await this.shouldTriggerCodeReview(params);

            if (shouldTrigger) {
                await this.savePullRequestUseCase.execute(params);

                // For created/updated events, also trigger automation
                if (
                    event === 'pullrequest:created' ||
                    event === 'pullrequest:updated'
                ) {
                    // Intentionally not awaiting this, as per original logic
                    this.runCodeReviewAutomationUseCase.execute(params);
                }
            } else {
                // For events that don't trigger code review, just save the state
                const pullRequest =
                    await this.savePullRequestUseCase.execute(params);

                if (pullRequest && pullRequest.status === 'closed') {
                    await this.generateIssuesFromPrClosedUseCase.execute(
                        params,
                    );

                    const merged = payload?.pullrequest?.state === 'MERGED';
                    if (merged) {
                        try {
                            if (orgData?.organizationAndTeamData) {
                                const baseRef =
                                    payload?.pullrequest?.destination?.branch
                                        ?.name;
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
                                            prNumber: payload?.pullrequest?.id,
                                        },
                                    );
                                await this.kodyRulesSyncService.syncFromChangedFiles(
                                    {
                                        organizationAndTeamData:
                                            orgData.organizationAndTeamData,
                                        repository,
                                        pullRequestNumber:
                                            payload?.pullrequest?.id,
                                        files: changedFiles || [],
                                    },
                                );
                            }
                        } catch (e) {
                            this.logger.error({
                                message:
                                    'Failed to sync Kody Rules after PR merge',
                                context: BitbucketPullRequestHandler.name,
                                error: e,
                                metadata: {
                                    organizationAndTeamData:
                                        orgData?.organizationAndTeamData,
                                    repository,
                                    pullRequestNumber: payload?.pullrequest?.id,
                                },
                            });
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error({
                context: BitbucketPullRequestHandler.name,
                serviceName: BitbucketPullRequestHandler.name,
                message: `Error processing Bitbucket pull request #${prId}: ${error.message}`,
                metadata: {
                    prId,
                    prUrl,
                    event,
                },
                error,
            });
            throw error;
        }
    }

    private async handleComment(params: IWebhookEventParams): Promise<void> {
        const { payload } = params;
        const prId = payload?.pullrequest?.id;

        try {
            const mappedPlatform = getMappedPlatform(PlatformType.BITBUCKET);

            if (!mappedPlatform) {
                this.logger.error({
                    message: 'Could not get mapped platform for Bitbucket.',
                    serviceName: BitbucketPullRequestHandler.name,
                    metadata: {
                        prId,
                    },
                    context: BitbucketPullRequestHandler.name,
                });
                return;
            }

            const comment = mappedPlatform.mapComment({ payload });

            if (!comment || !comment.body || payload?.action === 'deleted') {
                this.logger.debug({
                    message:
                        'Comment body empty or action is deleted, skipping.',
                    serviceName: BitbucketPullRequestHandler.name,
                    metadata: {
                        prId,
                    },
                    context: BitbucketPullRequestHandler.name,
                });
                return;
            }

            // Verify if the comment is a start-review command
            const commandPattern = /^\s*@kody\s+start-review/i;
            const isStartCommand = commandPattern.test(comment.body);

            // Verify if the comment is a review marker (emoji or API generated)
            const emojiPattern = /(?:👍|👎)/u;
            const apiGeneratedPattern = /(?:kody code-review)/i;
            const hasReviewMarker =
                emojiPattern.test(comment.body) ||
                apiGeneratedPattern.test(comment.body);
            // Verify if the comment mentions Kody and is not a start-review command
            const kodyMentionPattern = /^\s*@kody\b(?!\s+start-review)/i;

            if (isStartCommand && !hasReviewMarker) {
                this.logger.log({
                    message: `@kody start command detected in Bitbucket comment for PR#${prId}`,
                    serviceName: BitbucketPullRequestHandler.name,
                    metadata: {
                        prId,
                    },
                    context: BitbucketPullRequestHandler.name,
                });

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
        } catch (error) {
            this.logger.error({
                context: BitbucketPullRequestHandler.name,
                serviceName: BitbucketPullRequestHandler.name,
                message: `Error processing Bitbucket comment for PR #${prId}: ${error.message}`,
                error,
                metadata: {
                    prId,
                },
            });
            throw error;
        }
    }

    /**
     * Determines if code review should be triggered based on the pull request payload.
     * @param params The webhook event parameters.
     * @returns True if code review should be triggered, false otherwise.
     */
    private async shouldTriggerCodeReview(
        params: IWebhookEventParams,
    ): Promise<boolean> {
        const { event, payload, platformType } = params;

        // Verificar se é um evento de pull request válido
        if (!this.isBitbucketPullRequestEvent(payload)) {
            return false;
        }

        const { pullrequest, repository } = payload;
        const repoId = repository.uuid.slice(1, repository.uuid.length - 1);

        const configs =
            await this.integrationConfigService.findIntegrationConfigWithTeams(
                IntegrationConfigKey.REPOSITORIES,
                repoId,
                platformType,
            );

        if (!configs || !configs?.length) {
            this.logger.debug({
                message: `No integration configs found for repository ${repository.name} (${repoId})`,
                context: BitbucketPullRequestHandler.name,
                serviceName: BitbucketPullRequestHandler.name,
                metadata: {
                    repositoryName: repository.name,
                    repositoryId: repoId,
                    platformType,
                    prNumber: pullrequest.id,
                },
            });
            return false;
        }

        const organizationAndTeamData = configs.map((config) => ({
            organizationId: config.team.organization.uuid,
            teamId: config.team.uuid,
        }))[0];

        if (event === 'pullrequest:updated') {
            try {
                const pullRequestCommits =
                    await this.codeManagement.getCommitsForPullRequestForCodeReview(
                        {
                            organizationAndTeamData,
                            repository: {
                                id: repoId,
                                name: repository.name,
                            },
                            prNumber: pullrequest.id,
                        },
                    );

                const storedPR =
                    await this.pullRequestsService.findByNumberAndRepositoryName(
                        pullrequest.id,
                        repository.name,
                        organizationAndTeamData,
                    );

                const isDraft = pullrequest.draft ?? false;
                const wasDraft = storedPR?.isDraft ?? false;

                if (pullrequest.state === 'OPEN' && wasDraft && !isDraft) {
                    return true;
                }

                if (storedPR && pullrequest.state === 'OPEN') {
                    const prCommit =
                        pullRequestCommits[pullRequestCommits.length - 1];
                    const storedPRCommitHashes = storedPR?.commits?.map(
                        (commit) => commit.sha,
                    );
                    if (storedPRCommitHashes?.includes(prCommit?.sha)) {
                        return false;
                    }
                }
            } catch (error) {
                this.logger.error({
                    message: `Error checking PR commits: ${error.message}`,
                    context: BitbucketPullRequestHandler.name,
                    serviceName: BitbucketPullRequestHandler.name,
                    metadata: {
                        prId: pullrequest.id,
                        event,
                    },
                    error,
                });
                return pullrequest.state === 'OPEN';
            }
        }

        switch (pullrequest.state) {
            case 'OPEN':
                return true;
            case 'MERGED':
                return false;
            case 'DECLINED':
                return false;
            default:
                return false;
        }
    }

    private isBitbucketPullRequestEvent(
        event: any,
    ): event is IWebhookBitbucketPullRequestEvent {
        const pullRequest = event?.pullrequest;
        const actor = event?.actor;
        const repository = event?.repository;
        const areUndefined =
            pullRequest === undefined ||
            actor === undefined ||
            repository === undefined;

        if (areUndefined) {
            return false;
        }

        return true;
    }
}
