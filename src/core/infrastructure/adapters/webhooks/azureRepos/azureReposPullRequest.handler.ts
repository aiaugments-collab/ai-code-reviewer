import { Injectable } from '@nestjs/common';
import {
    IWebhookEventHandler,
    IWebhookEventParams,
} from '@/core/domain/platformIntegrations/interfaces/webhook-event-handler.interface';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { SavePullRequestUseCase } from '@/core/application/use-cases/pullRequests/save.use-case';
import { RunCodeReviewAutomationUseCase } from '@/ee/automation/runCodeReview.use-case';
import { ChatWithKodyFromGitUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/chatWithKodyFromGit.use-case';
import { getMappedPlatform } from '@/shared/utils/webhooks';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { createHash } from 'crypto';
import { CacheService } from '@/shared/utils/cache/cache.service';
import { GenerateIssuesFromPrClosedUseCase } from '@/core/application/use-cases/issues/generate-issues-from-pr-closed.use-case';
import { KodyRulesSyncService } from '../../services/kodyRules/kodyRulesSync.service';

@Injectable()
export class AzureReposPullRequestHandler implements IWebhookEventHandler {
    constructor(
        private readonly logger: PinoLoggerService,
        private readonly savePullRequestUseCase: SavePullRequestUseCase,
        private readonly runCodeReviewAutomationUseCase: RunCodeReviewAutomationUseCase,
        private readonly chatWithKodyFromGitUseCase: ChatWithKodyFromGitUseCase,
        private readonly cacheService: CacheService,
        private readonly generateIssuesFromPrClosedUseCase: GenerateIssuesFromPrClosedUseCase,
        private readonly kodyRulesSyncService: KodyRulesSyncService,
        private readonly codeManagement: CodeManagementService,
    ) {}

    /**
     * Determines if this handler can process an Azure Repos webhook event.
     * @param params The webhook event parameters.
     * @returns True if the event is an Azure Repos event this handler supports, false otherwise.
     */
    public canHandle(params: IWebhookEventParams): boolean {
        if (params.platformType !== PlatformType.AZURE_REPOS) {
            return false;
        }

        const supportedEvents = [
            'git.pullrequest.created',
            'git.pullrequest.updated',
            'git.pullrequest.merge.attempted',
            'ms.vss-code.git-pullrequest-comment-event',
        ];
        return supportedEvents.includes(params.event);
    }

    /**
     * Processes an Azure Repos webhook event by calling the relevant use cases.
     * @param params The webhook event parameters.
     */
    public async execute(params: IWebhookEventParams): Promise<void> {
        const { event } = params;

        // Verificar se é uma requisição duplicada
        const isDuplicate = await this.isDuplicateRequest(params.payload);
        if (isDuplicate) {
            this.logger.warn({
                context: AzureReposPullRequestHandler.name,
                serviceName: AzureReposPullRequestHandler.name,
                message:
                    'Duplicate Azure Repos webhook request detected, skipping processing',
                metadata: {
                    eventType: event,
                    prId:
                        params.payload?.resource?.pullRequestId ||
                        'UNKNOWN_PR_ID',
                },
            });
            return;
        }

        // Direcionar para o método apropriado com base no tipo de evento
        if (event === 'ms.vss-code.git-pullrequest-comment-event') {
            await this.handleComment(params);
        } else {
            await this.handlePullRequest(params);
        }
    }

    /**
     * Processa eventos de pull request do Azure Repos
     */
    private async handlePullRequest(
        params: IWebhookEventParams,
    ): Promise<void> {
        const prId = params.payload?.resource?.pullRequestId || 'UNKNOWN_PR_ID';
        const eventType = params.event;
        const repoName =
            params.payload?.resource?.repository?.name || 'UNKNOWN_REPO';

        this.logger.log({
            context: AzureReposPullRequestHandler.name,
            serviceName: AzureReposPullRequestHandler.name,
            metadata: {
                prId,
                eventType,
                repoName,
            },
            message: `Processing Azure Repos event '${eventType}' for PR ID: ${prId} in repo ${repoName}`,
        });

        const repository = {
            id: params?.payload?.resource?.repository?.id,
            name: params?.payload?.resource?.repository?.name,
            fullName: params?.payload?.resource?.repository?.name,
        } as any;

        const orgData =
            await this.runCodeReviewAutomationUseCase.findTeamWithActiveCodeReview(
                {
                    repository: {
                        id: repository.id,
                        name: repository.name,
                    },
                    platformType: PlatformType.AZURE_REPOS,
                },
            );

        try {
            switch (eventType) {
                case 'git.pullrequest.created':
                case 'git.pullrequest.updated':
                    await this.savePullRequestUseCase.execute(params);
                    this.runCodeReviewAutomationUseCase.execute(params);
                    await this.generateIssuesFromPrClosedUseCase.execute(
                        params,
                    );

                    try {
                        if (params?.payload?.resource?.status === 'completed') {
                            if (orgData?.organizationAndTeamData) {
                                const baseRefFull =
                                    params?.payload?.resource?.targetRefName; // refs/heads/main
                                const baseRef =
                                    baseRefFull?.replace('refs/heads/', '') ||
                                    baseRefFull;
                                const defaultBranch =
                                    await this.codeManagement.getDefaultBranch({
                                        organizationAndTeamData:
                                            orgData.organizationAndTeamData,
                                        repository: {
                                            id: repository.id,
                                            name: repository.name,
                                        },
                                    });
                                if (baseRefFull !== defaultBranch) {
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
                                                params?.payload?.resource
                                                    ?.pullRequestId,
                                        },
                                    );
                                await this.kodyRulesSyncService.syncFromChangedFiles(
                                    {
                                        organizationAndTeamData:
                                            orgData.organizationAndTeamData,
                                        repository,
                                        pullRequestNumber:
                                            params?.payload?.resource
                                                ?.pullRequestId,
                                        files: changedFiles || [],
                                    },
                                );
                            }
                        }
                    } catch (e) {
                        this.logger.error({
                            message: 'Failed to sync Kody Rules after PR merge',
                            context: AzureReposPullRequestHandler.name,
                            error: e,
                            metadata: {
                                prId,
                                eventType,
                                repoName,
                                organizationAndTeamData:
                                    orgData?.organizationAndTeamData,
                            },
                        });
                    }

                    break;
                case 'git.pullrequest.merge.attempted':
                    await this.savePullRequestUseCase.execute(params);
                    break;
                default:
                    this.logger.warn({
                        context: AzureReposPullRequestHandler.name,
                        message: `Event '${eventType}' for PR ID ${prId} passed canHandle but is not handled in execute.`,
                    });
                    return;
            }

            this.logger.log({
                context: AzureReposPullRequestHandler.name,
                serviceName: AzureReposPullRequestHandler.name,
                metadata: {
                    prId,
                    eventType,
                    repoName,
                    organizationAndTeamData: orgData?.organizationAndTeamData,
                },
                message: `Successfully processed Azure Repos event '${eventType}' for PR ID: ${prId}`,
            });
        } catch (error) {
            this.logger.error({
                context: AzureReposPullRequestHandler.name,
                serviceName: AzureReposPullRequestHandler.name,
                metadata: {
                    prId,
                    eventType,
                    repoName,
                    organizationAndTeamData: orgData?.organizationAndTeamData,
                },
                message: `Error processing Azure Repos pull request #${prId}: ${error.message}`,
                error,
            });
            throw error;
        }
    }

    /**
     * Processa eventos de comentário do Azure Repos
     */
    private async handleComment(params: IWebhookEventParams): Promise<void> {
        const { payload } = params;
        const prId =
            payload?.resource?.pullRequest?.pullRequestId || 'UNKNOWN_PR_ID';
        const repoName = payload?.resource?.repository?.name || 'UNKNOWN_REPO';

        try {
            // Extract comment data
            const commentContent = payload?.resource?.comment?.content;
            const isPullRequestActive =
                payload?.resource?.pullRequest?.status === 'active';

            if (!commentContent || !isPullRequestActive) {
                this.logger.debug({
                    message:
                        'Comment content empty or pull request not active, skipping.',
                    serviceName: AzureReposPullRequestHandler.name,
                    metadata: {
                        prId,
                        repoName,
                        hasComment: !!commentContent,
                        isPullRequestActive,
                    },
                    context: AzureReposPullRequestHandler.name,
                });
                return;
            }

            const mappedPlatform = getMappedPlatform(PlatformType.AZURE_REPOS);

            if (!mappedPlatform) {
                this.logger.error({
                    message: 'Could not get mapped platform for Azure Repos.',
                    serviceName: AzureReposPullRequestHandler.name,
                    metadata: {
                        prId,
                    },
                    context: AzureReposPullRequestHandler.name,
                });
                return;
            }

            const comment = mappedPlatform.mapComment({ payload });

            if (!comment || !comment.body || payload?.action === 'deleted') {
                this.logger.debug({
                    message:
                        'Comment body empty or action is deleted, skipping.',
                    serviceName: AzureReposPullRequestHandler.name,
                    metadata: {
                        prId,
                    },
                    context: AzureReposPullRequestHandler.name,
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
                    message: `@kody start command detected in Azure Repos comment for PR#${prId}`,
                    serviceName: AzureReposPullRequestHandler.name,
                    metadata: {
                        prId,
                        repoName,
                    },
                    context: AzureReposPullRequestHandler.name,
                });

                // Prepare params for the use cases
                const updatedParams = {
                    ...params,
                    payload: {
                        ...payload,
                        action: 'synchronize',
                        origin: 'command',
                    },
                };

                // Execute the necessary use cases
                await this.savePullRequestUseCase.execute(updatedParams);
                this.runCodeReviewAutomationUseCase.execute(updatedParams);
            }

            // For pull_request_review_comment that is not a start-review command
            if (
                !hasReviewMarker &&
                !isStartCommand &&
                kodyMentionPattern.test(comment.body)
            ) {
                this.chatWithKodyFromGitUseCase.execute(params);
                return;
            }
        } catch (error) {
            this.logger.error({
                context: AzureReposPullRequestHandler.name,
                serviceName: AzureReposPullRequestHandler.name,
                metadata: {
                    prId,
                    repoName,
                },
                message: `Error processing Azure Repos comment: ${error.message}`,
                error,
            });
            throw error;
        }
    }

    /**
     * Checks if a webhook request is a duplicate
     * @param payload The webhook payload
     * @returns true if it's a duplicate request, false otherwise
     */
    private async isDuplicateRequest(payload: any): Promise<boolean> {
        const prId = payload?.resource?.pullRequestId;
        const eventType = payload?.eventType;

        if (!prId || !eventType) {
            return false;
        }

        // Use the complete payload for comparison
        const payloadHash = createHash('md5')
            .update(
                JSON.stringify({
                    prId,
                    eventType,
                    createdDate: payload?.createdDate,
                    id: payload?.id,
                }),
            )
            .digest('hex');

        // Unique cache key based on content
        const cacheKey = `azure_webhook:${prId}:${payloadHash}`;

        const exists = await this.cacheService.cacheExists(cacheKey);
        if (exists) {
            this.logger.warn({
                message: `Duplicate request detected`,
                context: AzureReposPullRequestHandler.name,
                serviceName: AzureReposPullRequestHandler.name,
                metadata: { prId, eventType, payloadHash },
            });
            return true;
        }

        await this.cacheService.addToCache(cacheKey, true, 60000); // 1 minute
        return false;
    }
}
