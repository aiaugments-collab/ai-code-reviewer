import { Inject, Injectable } from '@nestjs/common';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { AGENT_SERVICE_TOKEN } from '@/core/domain/agents/contracts/agent.service.contracts';
import { IntegrationConfigEntity } from '@/core/domain/integrationConfigs/entities/integration-config.entity';
import { AgentService } from '@/core/infrastructure/adapters/services/agent/agent.service';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { ConversationAgentUseCase } from '../../agent/conversation-agent.use-case';
import { BusinessRulesValidationAgentUseCase } from '../../agent/business-rules-validation-agent.use-case';
import { createThreadId } from '@kodus/flow';
import posthogClient from '@/shared/utils/posthog';

// Constants
const KODY_COMMANDS = {
    BUSINESS_LOGIC_VALIDATION: '@kody -v business-logic',
    KODY_MENTION: '@kody',
    KODUS_MENTION: '@kodus',
} as const;

const KODY_IDENTIFIERS = {
    LOGIN_KEYWORDS: ['kody', 'kodus'],
    MARKDOWN_IDENTIFIERS: {
        DEFAULT: 'kody-codereview',
        BITBUCKET: 'kody|code-review',
    },
} as const;

const ACKNOWLEDGMENT_MESSAGES = {
    DEFAULT: 'Analyzing your request...',
    MARKDOWN_SUFFIX: '<!-- kody-codereview -->\n&#8203;',
} as const;

enum CommandType {
    BUSINESS_LOGIC_VALIDATION = 'business_logic_validation',
    CONVERSATION = 'conversation',
    UNKNOWN = 'unknown',
}

interface CommandHandler {
    canHandle(userQuestion: string): boolean;
    getCommandType(): CommandType;
}

class BusinessLogicValidationCommandHandler implements CommandHandler {
    canHandle(userQuestion: string): boolean {
        return userQuestion
            .toLowerCase()
            .trim()
            .startsWith(KODY_COMMANDS.BUSINESS_LOGIC_VALIDATION);
    }

    getCommandType(): CommandType {
        return CommandType.BUSINESS_LOGIC_VALIDATION;
    }
}

class ConversationCommandHandler implements CommandHandler {
    canHandle(userQuestion: string): boolean {
        const trimmedQuestion = userQuestion.toLowerCase().trim();

        const startsWithMention =
            trimmedQuestion.startsWith(KODY_COMMANDS.KODY_MENTION) ||
            trimmedQuestion.startsWith(KODY_COMMANDS.KODUS_MENTION);

        if (!startsWithMention) {
            return false;
        }

        if (trimmedQuestion.includes(' -v ')) {
            return false;
        }

        return true;
    }

    getCommandType(): CommandType {
        return CommandType.CONVERSATION;
    }
}

class CommandManager {
    private handlers: CommandHandler[];

    constructor() {
        this.handlers = [
            new BusinessLogicValidationCommandHandler(),
            new ConversationCommandHandler(),
        ];
    }

    getCommandType(userQuestion: string): CommandType {
        const handler = this.handlers.find((h) => h.canHandle(userQuestion));
        return handler?.getCommandType() ?? CommandType.UNKNOWN;
    }
}

interface WebhookParams {
    event: string;
    payload: any;
    platformType: PlatformType;
}

interface Repository {
    name: string;
    id: string;
}

interface Sender {
    login: string;
    id: string;
}

interface Comment {
    id: number;
    body: string;
    in_reply_to_id?: number;
    parent?: {
        id: number;
        links?: any;
    };
    replies?: Comment[];
    content?: {
        raw: string;
        markup?: string;
        html?: string;
        type?: string;
    };
    path?: string;
    deleted?: boolean;
    user?: { login?: string; display_name?: string };
    author?: {
        name?: string;
        username?: string;
        display_name?: string;
        id?: string;
    };
    diff_hunk?: string;
    discussion_id?: string;
    originalCommit?: any;
    // Azure Repos specific properties
    threadId?: number;
    thread?: any;
    commentType?: string;
}

@Injectable()
export class ChatWithKodyFromGitUseCase {
    private commandManager: CommandManager;

    constructor(
        @Inject(AGENT_SERVICE_TOKEN)
        private readonly agentService: AgentService,

        private readonly logger: PinoLoggerService,
        private readonly codeManagementService: CodeManagementService,
        private readonly conversationAgentUseCase: ConversationAgentUseCase,
        private readonly businessRulesValidationAgentUseCase: BusinessRulesValidationAgentUseCase,
    ) {}

    async execute(params: WebhookParams): Promise<void> {
        this.logger.log({
            message: 'Receiving pull request review webhook for conversation',
            context: ChatWithKodyFromGitUseCase.name,
            metadata: { eventName: params.event },
        });

        try {
            if (!this.isRelevantAction(params)) {
                return;
            }

            const repository = this.getRepository(params);
            const integrationConfig = await this.getIntegrationConfig(
                params.platformType,
                repository,
            );

            const organizationAndTeamData = integrationConfig
                ? this.extractOrganizationAndTeamData(integrationConfig)
                : null;

            if (
                !integrationConfig ||
                !organizationAndTeamData?.organizationId ||
                !organizationAndTeamData?.teamId
            ) {
                this.logger.warn({
                    message:
                        'No integration config or organization/team data found for repository',
                    context: ChatWithKodyFromGitUseCase.name,
                    metadata: {
                        platformType: params.platformType,
                        repository: repository.name,
                        repositoryId: repository.id,
                        hasIntegrationConfig: !!integrationConfig,
                        organizationId: organizationAndTeamData?.organizationId,
                        teamId: organizationAndTeamData?.teamId,
                        integrationConfig,
                    },
                });
                return;
            }

            const pullRequestNumber = this.getPullRequestNumber(params);
            const pullRequestDescription =
                this.getPullRequestDescription(params);

            this.logger.log({
                message: 'Extracted PR information',
                context: ChatWithKodyFromGitUseCase.name,
                serviceName: ChatWithKodyFromGitUseCase.name,
                metadata: {
                    platformType: params.platformType,
                    repository: repository.name,
                    pullRequestNumber,
                    hasDescription: !!pullRequestDescription,
                    descriptionLength: pullRequestDescription?.length || 0,
                },
            });

            this.commandManager = new CommandManager();
            const commandType = this.detectCommandType(params);

            if (commandType === CommandType.BUSINESS_LOGIC_VALIDATION) {
                await this.handleBusinessLogicFlow(
                    params,
                    repository,
                    pullRequestNumber,
                    pullRequestDescription,
                    organizationAndTeamData,
                );
            }

            if (commandType === CommandType.CONVERSATION) {
                await this.handleConversationFlow(
                    params,
                    repository,
                    pullRequestNumber,
                    pullRequestDescription,
                    organizationAndTeamData,
                );
            }
        } catch (error) {
            this.logger.error({
                message: 'Error while executing the git comment response agent',
                context: ChatWithKodyFromGitUseCase.name,
                serviceName: ChatWithKodyFromGitUseCase.name,
                error,
            });
        }
    }

    private isRelevantAction(params: WebhookParams): boolean {
        const action = params.payload?.action;
        const eventType = params.payload?.event_type;

        if (
            (action && action !== 'created') ||
            (!action && eventType && eventType !== 'note')
        ) {
            return false;
        }

        return true;
    }

    private detectCommandType(params: WebhookParams): CommandType {
        if (params.event === 'issue_comment' || params.payload?.comment?.body) {
            const commentBody =
                params.payload?.comment?.body ||
                params.payload?.issue?.body ||
                '';
            return this.commandManager.getCommandType(commentBody);
        }

        if (params.platformType === PlatformType.GITLAB) {
            const commentType = params.payload?.object_attributes?.type;
            const isSuggestion = commentType === 'DiffNote';
            const isGeneralFlow = commentType === null;
            const commentBody = params.payload?.object_attributes?.note || '';

            if (isSuggestion) {
                return CommandType.CONVERSATION;
            }

            if (isGeneralFlow) {
                return this.commandManager.getCommandType(commentBody);
            }

            return CommandType.CONVERSATION;
        }

        if (params.platformType === PlatformType.BITBUCKET) {
            const comment = params.payload?.comment;
            const isSuggestion =
                comment?.inline !== null && comment?.inline !== undefined;
            const isGeneralFlow = !isSuggestion;
            const commentBody = comment?.content?.raw || '';

            if (isSuggestion) {
                return CommandType.CONVERSATION;
            }

            if (isGeneralFlow) {
                return this.commandManager.getCommandType(commentBody);
            }

            return CommandType.CONVERSATION;
        }

        if (params.platformType === PlatformType.AZURE_REPOS) {
            const comment = params.payload?.resource?.comment;
            const isSuggestion = comment?.parentCommentId > 0;
            const isGeneralFlow = comment?.parentCommentId === 0;
            const commentBody = comment?.content || '';

            if (isSuggestion) {
                return CommandType.CONVERSATION;
            }

            if (isGeneralFlow) {
                return this.commandManager.getCommandType(commentBody);
            }

            return CommandType.CONVERSATION;
        }

        return CommandType.CONVERSATION;
    }

    private async handleBusinessLogicFlow(
        params: WebhookParams,
        repository: Repository,
        pullRequestNumber: number,
        pullRequestDescription: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<void> {
        const sender = this.getSender(params);
        const commentBody =
            params.platformType === PlatformType.GITLAB
                ? params.payload?.object_attributes?.note || ''
                : params.platformType === PlatformType.BITBUCKET
                  ? params.payload?.comment?.content?.raw || ''
                  : params.platformType === PlatformType.AZURE_REPOS
                    ? params.payload?.resource?.comment?.content || ''
                    : params.payload?.comment?.body ||
                      params.payload?.issue?.body ||
                      '';
        const issueId =
            params.platformType === PlatformType.GITLAB
                ? params?.payload?.object_attributes?.noteable_id
                : params.platformType === PlatformType.BITBUCKET
                  ? params?.payload?.pullrequest?.id
                  : params.platformType === PlatformType.AZURE_REPOS
                    ? params?.payload?.resource?.pullRequest?.pullRequestId
                    : params?.payload?.issue?.id;

        const thread = createThreadId(
            {
                organizationId: organizationAndTeamData.organizationId,
                teamId: organizationAndTeamData.teamId,
                repositoryId: repository.id,
                userId: sender.id,
                issueId,
            },
            {
                prefix: 'vbl',
            },
        );

        const ackResponse = await this.codeManagementService.createIssueComment(
            {
                organizationAndTeamData,
                repository,
                prNumber: pullRequestNumber,
                body: this.getAcknowledgmentBody(params.platformType),
            },
        );

        if (!ackResponse) {
            this.logger.warn({
                message: 'Failed to create acknowledgment response',
                context: ChatWithKodyFromGitUseCase.name,
                metadata: {
                    repository: repository.name,
                    pullRequestNumber,
                },
            });
            return;
        }

        const [ackResponseId, parentId] =
            this.getBusinessLogicAcknowledgmentIds(
                ackResponse,
                params.platformType,
            );

        if (!ackResponseId) {
            this.logger.warn({
                message:
                    'Failed to get acknowledgment response ID for business logic',
                context: ChatWithKodyFromGitUseCase.name,
                metadata: {
                    repository: repository.name,
                    pullRequestNumber,
                    platformType: params.platformType,
                },
            });
            return;
        }

        const prepareContext = {
            userQuestion: commentBody,
            pullRequestNumber,
            repository,
            pullRequestDescription,
            platformType: params.platformType,
        };

        const response = await this.businessRulesValidationAgentUseCase.execute(
            {
                prepareContext,
                organizationAndTeamData,
                thread,
            },
        );

        if (!response) {
            this.logger.warn({
                message:
                    'No response generated by Business Logic Validation Agent',
                context: ChatWithKodyFromGitUseCase.name,
                metadata: {
                    repository: repository.name,
                    pullRequestNumber,
                },
            });
            return;
        }

        try {
            const updateParams: any = {
                organizationAndTeamData,
                repository,
                prNumber: pullRequestNumber,
                commentId: Number(ackResponseId),
                body: response,
            };

            if (params.platformType === PlatformType.GITLAB) {
                updateParams.noteId = parentId ? Number(parentId) : undefined;
            } else if (params.platformType === PlatformType.AZURE_REPOS) {
                updateParams.threadId = parentId ? Number(parentId) : undefined;
            }

            await this.codeManagementService.updateIssueComment(updateParams);

            this.logger.log({
                message:
                    'Successfully updated PR response for business logic validation',
                context: ChatWithKodyFromGitUseCase.name,
                metadata: {
                    repository: repository.name,
                    pullRequestNumber,
                },
            });
        } catch (error) {
            this.logger.error({
                message:
                    'Failed to update PR response for business logic validation',
                context: ChatWithKodyFromGitUseCase.name,
                error,
                metadata: {
                    repository: repository.name,
                    pullRequestNumber,
                },
            });
            return;
        }

        this.logger.log({
            message: 'Successfully executed business logic validation',
            context: ChatWithKodyFromGitUseCase.name,
            metadata: {
                repository: repository.name,
                pullRequestNumber,
            },
        });
    }

    private async handleConversationFlow(
        params: WebhookParams,
        repository: Repository,
        pullRequestNumber: number,
        pullRequestDescription: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<void> {
        const allComments =
            await this.codeManagementService.getPullRequestReviewComment({
                organizationAndTeamData,
                filters: {
                    pullRequestNumber,
                    repository,
                    discussionId:
                        params.payload?.object_attributes?.discussion_id ?? '',
                },
            });

        const commentId = this.getCommentId(params);
        const comment =
            params.platformType !== PlatformType.AZURE_REPOS
                ? allComments?.find((c) => c.id === commentId)
                : this.getReviewThreadByCommentId(
                      commentId,
                      allComments,
                      params,
                  );

        if (!comment) {
            return;
        }

        if (this.shouldIgnoreComment(comment, params.platformType)) {
            this.logger.log({
                message:
                    'Comment made by Kody or does not mention Kody/Kodus. Ignoring.',
                context: ChatWithKodyFromGitUseCase.name,
                metadata: {
                    repository: repository.name,
                    pullRequestNumber,
                },
            });
            return;
        }

        const originalKodyComment = this.getOriginalKodyComment(
            comment,
            allComments,
            params.platformType,
        );
        const othersReplies = this.getOthersReplies(
            comment,
            allComments,
            params.platformType,
        );
        const sender = this.getSender(params);

        const message = this.prepareMessage(
            comment,
            originalKodyComment,
            sender.login,
            othersReplies,
        );

        const ackResponse =
            await this.codeManagementService.createResponseToComment({
                organizationAndTeamData,
                inReplyToId: comment.id,
                discussionId: params.payload?.object_attributes?.discussion_id,
                threadId: comment.threadId,
                body: this.getAcknowledgmentBody(params.platformType),
                repository,
                prNumber: pullRequestNumber,
            });

        if (!ackResponse) {
            this.logger.warn({
                message: 'Failed to create acknowledgment response',
                context: ChatWithKodyFromGitUseCase.name,
                metadata: {
                    repository: repository.name,
                    pullRequestNumber,
                    commentId: comment.id,
                },
            });
            return;
        }

        const [ackResponseId, parentId] = this.getAcknowledgmentIds(
            originalKodyComment,
            ackResponse,
            params.platformType,
            comment,
        );

        if (!ackResponseId || !parentId) {
            this.logger.warn({
                message:
                    'Failed to get acknowledgment response ID or parent ID',
                context: ChatWithKodyFromGitUseCase.name,
                metadata: {
                    repository: repository.name,
                    pullRequestNumber,
                    commentId: comment.id,
                },
            });
            return;
        }

        let response = '';
        if (
            await posthogClient.isFeatureEnabled(
                'conversation-agent',
                organizationAndTeamData.organizationId,
                organizationAndTeamData,
            )
        ) {
            const prepareContext = this.prepareContext({
                comment,
                originalKodyComment,
                gitUserName: sender.login,
                othersReplies,
                pullRequestNumber,
                repository,
                pullRequestDescription,
                platformType: params.platformType,
            });

            const thread = createThreadId(
                {
                    organizationId: organizationAndTeamData.organizationId,
                    teamId: organizationAndTeamData.teamId,
                    repositoryId: repository.id,
                    userId: sender.id,
                    suggestionCommentId: originalKodyComment?.id || comment?.id,
                },
                {
                    prefix: 'cmc',
                },
            );

            const commandType = this.commandManager.getCommandType(
                prepareContext.userQuestion,
            );
            response = await this.processCommand(commandType, {
                prepareContext,
                organizationAndTeamData,
                thread,
            });
        } else {
            response = await this.agentService.conversationWithKody(
                organizationAndTeamData,
                sender.id,
                message,
                sender.login,
            );
        }

        if (!response) {
            this.logger.warn({
                message: 'No response generated by Kody',
                context: ChatWithKodyFromGitUseCase.name,
                metadata: {
                    repository: repository.name,
                    pullRequestNumber,
                    commentId: comment.id,
                },
            });
            return;
        }

        const updatedComment =
            await this.codeManagementService.updateResponseToComment({
                organizationAndTeamData,
                parentId,
                commentId: ackResponseId,
                body: response,
                prNumber: pullRequestNumber,
                repository,
            });

        if (!updatedComment) {
            this.logger.warn({
                message: 'Failed to update acknowledgment response',
                context: ChatWithKodyFromGitUseCase.name,
                metadata: {
                    repository: repository.name,
                    pullRequestNumber,
                    commentId: comment.id,
                },
            });
            return;
        }

        this.logger.log({
            message: 'Successfully executed conversation flow',
            context: ChatWithKodyFromGitUseCase.name,
            metadata: {
                repository: repository.name,
                pullRequestNumber,
                commentId: comment.id,
                responseId: ackResponseId,
            },
        });
    }

    private prepareMessage(
        comment: Comment,
        originalKodyComment: Comment,
        userName: string,
        othersReplies: Comment[],
    ): string {
        const userQuestion =
            comment.body.trim() === '@kody'
                ? 'The user did not ask any questions. Ask them what they would like to know about the codebase or suggestions for code changes.'
                : comment.body;

        return JSON.stringify({
            userName,
            userQuestion,
            context: {
                originalComment: {
                    text: originalKodyComment?.body,
                    diffHunk: originalKodyComment?.diff_hunk,
                },
                othersReplies: othersReplies.map((reply) => ({
                    text: reply.body,
                    diffHunk: reply.diff_hunk,
                })),
            },
        });
    }

    private async getIntegrationConfig(
        platformType: PlatformType,
        repository: Repository,
    ): Promise<IntegrationConfigEntity> {
        return await this.codeManagementService.findTeamAndOrganizationIdByConfigKey(
            {
                repository: repository,
            },
            platformType,
        );
    }

    private extractOrganizationAndTeamData(
        integrationConfig: IntegrationConfigEntity,
    ): OrganizationAndTeamData {
        return {
            organizationId: integrationConfig?.integration?.organization?.uuid,
            teamId: integrationConfig?.team?.uuid,
        };
    }

    private getRepository(params: WebhookParams): Repository {
        switch (params.platformType) {
            case PlatformType.GITHUB:
                return {
                    name: params.payload?.repository?.name,
                    id: params.payload?.repository?.id,
                };
            case PlatformType.GITLAB:
                return {
                    name: params.payload?.project?.name,
                    id: params.payload?.project?.id,
                };
            case PlatformType.BITBUCKET:
                return {
                    name: params.payload?.repository?.name,
                    id:
                        params.payload?.repository?.uuid?.slice(1, -1) ||
                        params.payload?.repository?.id,
                };
            case PlatformType.AZURE_REPOS:
                return {
                    name: params.payload?.resource?.pullRequest?.repository
                        ?.name,
                    id: params.payload?.resource?.pullRequest?.repository?.id,
                };
            default:
                this.logger.warn({
                    message: `Unsupported platform type: ${params.platformType}`,
                    context: ChatWithKodyFromGitUseCase.name,
                });
                return { name: '', id: '' };
        }
    }

    private getPullRequestNumber(params: WebhookParams): number {
        switch (params.platformType) {
            case PlatformType.GITHUB:
                if (
                    params.event === 'issue_comment' &&
                    params.payload?.issue?.pull_request?.url
                ) {
                    const url = params.payload.issue.pull_request.url;
                    const match = url.match(/\/pulls\/(\d+)/);
                    if (match) {
                        return parseInt(match[1], 10);
                    } else {
                        return 0;
                    }
                }

                return params.payload?.pull_request?.number || 0;
            case PlatformType.GITLAB:
                return params.payload?.merge_request?.iid;
            case PlatformType.BITBUCKET:
                return params.payload?.pullrequest?.id;
            case PlatformType.AZURE_REPOS:
                return params.payload?.resource?.pullRequest?.pullRequestId;
            default:
                this.logger.warn({
                    message: `Unsupported platform type: ${params.platformType}`,
                    context: ChatWithKodyFromGitUseCase.name,
                });
                return 0;
        }
    }

    private getPullRequestDescription(params: WebhookParams): string {
        let description = '';

        switch (params.platformType) {
            case PlatformType.GITHUB:
                // Se for issue_comment, pegar description do issue
                if (params.event === 'issue_comment') {
                    description = params.payload?.issue?.body || '';
                } else {
                    // Caso normal (PR webhook)
                    description =
                        params.payload?.pull_request?.body ||
                        params.payload?.pull_request?.description ||
                        '';
                }
                break;
            case PlatformType.GITLAB:
                description =
                    params.payload?.merge_request?.description ||
                    params.payload?.merge_request?.body ||
                    '';
                break;
            case PlatformType.BITBUCKET:
                description =
                    params.payload?.pullrequest?.description ||
                    params.payload?.pullrequest?.summary ||
                    '';
                break;
            case PlatformType.AZURE_REPOS:
                description =
                    params.payload?.resource?.pullRequest?.description || '';
                break;
            default:
                this.logger.warn({
                    message: `Unsupported platform type: ${params.platformType} for PR description`,
                    context: ChatWithKodyFromGitUseCase.name,
                });
                return '';
        }

        this.logger.log({
            message: 'PR description extracted',
            context: ChatWithKodyFromGitUseCase.name,
            serviceName: ChatWithKodyFromGitUseCase.name,
            metadata: {
                platformType: params.platformType,
                hasDescription: !!description,
                descriptionLength: description.length,
                descriptionPreview: description.substring(0, 100),
            },
        });

        return description;
    }

    private getReviewThreadByCommentId(
        commentId: number,
        reviewComments: any[],
        params?: WebhookParams,
    ): any | null {
        try {
            if (params?.platformType === PlatformType.AZURE_REPOS) {
                const threadId = this.getThreadIdFromAzurePayload(params);
                if (threadId) {
                    const thread = reviewComments?.find(
                        (t) => t.threadId === threadId,
                    );
                    if (thread) {
                        const targetComment = thread.replies?.find(
                            (c: any) => c.id === commentId,
                        );
                        if (targetComment) {
                            return {
                                ...targetComment,
                                thread,
                            };
                        }
                    }
                }
            }

            return null;
        } catch (error) {
            this.logger.error({
                message: 'Failed to find thread by commentId',
                context:
                    'ChatWithKodyFromGitUseCase.getReviewThreadByCommentId',
                error,
                metadata: { commentId, platformType: params?.platformType },
            });
            return null;
        }
    }

    private getCommentId(params: WebhookParams): number {
        switch (params.platformType) {
            case PlatformType.GITHUB:
                return params.payload?.comment?.id;
            case PlatformType.GITLAB:
                return params.payload?.object_attributes?.id;
            case PlatformType.BITBUCKET:
                return params.payload?.comment?.id;
            case PlatformType.AZURE_REPOS:
                return params.payload?.resource?.comment?.id;
            default:
                this.logger.warn({
                    message: `Unsupported platform type: ${params.platformType}`,
                    context: ChatWithKodyFromGitUseCase.name,
                });
                return 0;
        }
    }

    private getThreadIdFromAzurePayload(params: WebhookParams): number | null {
        if (params.platformType !== PlatformType.AZURE_REPOS) {
            return null;
        }

        try {
            // Extrair threadId da URL nos _links do comentário
            const threadLink =
                params.payload?.resource?.comment?._links?.threads?.href;
            if (threadLink) {
                const threadIdMatch = threadLink.match(/\/threads\/(\d+)/);
                if (threadIdMatch) {
                    return parseInt(threadIdMatch[1], 10);
                }
            }

            // Fallback: extrair da URL do HTML (discussionId)
            const htmlContent =
                params.payload?.message?.html ||
                params.payload?.detailedMessage?.html;
            if (htmlContent) {
                const discussionIdMatch =
                    htmlContent.match(/discussionId=(\d+)/);
                if (discussionIdMatch) {
                    return parseInt(discussionIdMatch[1], 10);
                }
            }

            return null;
        } catch (error) {
            this.logger.error({
                message: 'Failed to extract threadId from Azure payload',
                context: ChatWithKodyFromGitUseCase.name,
                error,
                metadata: { platformType: params.platformType },
            });
            return null;
        }
    }

    private shouldIgnoreComment(
        comment: any,
        platformType: PlatformType,
    ): boolean {
        return (
            this.isKodyComment(comment, platformType) ||
            !this.mentionsKody(comment, platformType)
        );
    }

    private getOriginalKodyComment(
        comment: Comment,
        allComments: Comment[],
        platformType: PlatformType,
    ): Comment | undefined {
        switch (platformType) {
            case PlatformType.GITHUB:
                if (!comment?.in_reply_to_id) {
                    return undefined;
                }

                return allComments.find(
                    (originalComment) =>
                        originalComment.id === comment.in_reply_to_id &&
                        this.isKodyComment(originalComment, platformType),
                );
            case PlatformType.GITLAB:
                return comment?.originalCommit;
            case PlatformType.BITBUCKET:
                if (!comment?.parent?.id) {
                    return undefined;
                }

                const originalComment = allComments.find(
                    (c) =>
                        c.id === comment.parent.id &&
                        this.isKodyComment(c, platformType),
                );

                return originalComment;
            case PlatformType.AZURE_REPOS:
                if (comment.threadId && comment.id !== comment.threadId) {
                    const originalComment = comment.thread;
                    return originalComment;
                }
            default:
                this.logger.warn({
                    message: `Unsupported platform type: ${platformType}`,
                    context: ChatWithKodyFromGitUseCase.name,
                });
                return undefined;
        }
    }

    private getOthersReplies(
        comment: Comment,
        allComments: Comment[],
        platformType: PlatformType,
    ): Comment[] {
        switch (platformType) {
            case PlatformType.GITHUB:
                return allComments.filter(
                    (reply) =>
                        reply.in_reply_to_id === comment.in_reply_to_id &&
                        !this.isKodyComment(reply, platformType),
                );
            case PlatformType.BITBUCKET:
                if (comment.parent?.id) {
                    const originalComment = allComments.find(
                        (c) => c.id === comment.parent.id,
                    );

                    if (!originalComment) {
                        return [];
                    }

                    if (
                        originalComment.replies &&
                        Array.isArray(originalComment.replies)
                    ) {
                        const validReplies = [];

                        for (const reply of originalComment.replies) {
                            if (
                                reply.content?.raw === '' ||
                                reply.deleted === true
                            ) {
                                continue;
                            }

                            if (reply.id === comment.id) {
                                continue;
                            }
                            if (
                                this.isKodyComment(
                                    {
                                        body: reply.content?.raw,
                                        id: reply.id,
                                        author: {
                                            name: reply.user?.display_name,
                                        },
                                    },
                                    platformType,
                                )
                            ) {
                                continue;
                            }

                            if (reply.content?.raw) {
                                validReplies.push({
                                    ...reply,
                                    body: reply.content.raw,
                                });
                            } else {
                                validReplies.push(reply);
                            }
                        }

                        return validReplies;
                    }
                }
            case PlatformType.AZURE_REPOS:
                if (comment.threadId) {
                    const thread = allComments.find(
                        (c) => c.threadId === comment.threadId,
                    );

                    if (
                        thread &&
                        thread.replies &&
                        Array.isArray(thread.replies)
                    ) {
                        return thread.replies.filter(
                            (reply) =>
                                reply.id !== comment.id &&
                                !this.isKodyComment(reply, platformType),
                        );
                    }
                    return [];
                }

                return allComments.filter(
                    (reply) =>
                        reply.in_reply_to_id === comment.in_reply_to_id &&
                        !this.isKodyComment(reply, platformType),
                );
            case PlatformType.GITLAB:
                return allComments.filter(
                    (reply) =>
                        reply.in_reply_to_id === comment.in_reply_to_id &&
                        !this.isKodyComment(reply, platformType),
                );
            default:
                this.logger.warn({
                    message: `Plataforma nu00e3o suportada: ${platformType}`,
                    context: ChatWithKodyFromGitUseCase.name,
                });
                return [];
        }
    }

    private getSender(params: WebhookParams): Sender {
        switch (params.platformType) {
            case PlatformType.GITHUB:
                return {
                    login: params.payload?.sender?.login,
                    id: params.payload?.sender?.id,
                };
            case PlatformType.GITLAB:
                return {
                    login: params.payload?.user?.name,
                    id: params.payload?.user?.id,
                };
            case PlatformType.BITBUCKET:
                return {
                    login:
                        params.payload?.actor?.display_name ||
                        params.payload?.actor?.nickname,
                    id:
                        params.payload?.actor?.uuid?.slice(1, -1) ||
                        params.payload?.actor?.account_id,
                };
            case PlatformType.AZURE_REPOS:
                return {
                    login: params.payload?.resource?.comment?.author
                        ?.displayName,
                    id: params.payload?.resource?.comment?.author?.id,
                };
            default:
                this.logger.warn({
                    message: `Plataforma nu00e3o suportada: ${params.platformType}`,
                    context: ChatWithKodyFromGitUseCase.name,
                });
                return { login: '', id: '' };
        }
    }

    private prepareContext({
        comment,
        originalKodyComment,
        gitUserName,
        othersReplies,
        pullRequestNumber,
        repository,
        pullRequestDescription,
        platformType,
    }: {
        comment?: Comment;
        originalKodyComment?: Comment;
        gitUserName?: string;
        othersReplies?: Comment[];
        repository?: Repository;
        platformType?: PlatformType;
        pullRequestNumber?: number;
        pullRequestDescription?: string;
    }): any {
        const userQuestion =
            comment.body.trim() === '@kody'
                ? 'The user did not ask any questions. Ask them what they would like to know about the codebase or suggestions for code changes.'
                : comment.body;

        return {
            gitUserName,
            userQuestion,
            pullRequestNumber,
            repository,
            pullRequestDescription,
            platformType,
            codeManagementContext: {
                originalComment: {
                    suggestionCommentId: originalKodyComment?.id,
                    suggestionFilePath: comment?.path,
                    suggestionText: originalKodyComment?.body,
                    diffHunk: originalKodyComment?.diff_hunk,
                },
                othersReplies: othersReplies.map((reply) => ({
                    historyConversationText: reply.body,
                })),
            },
        };
    }

    private mentionsKody(
        comment: Comment,
        platformType: PlatformType,
    ): boolean {
        const commentBody = comment.body.toLowerCase();
        return [KODY_COMMANDS.KODY_MENTION, KODY_COMMANDS.KODUS_MENTION].some(
            (keyword) => commentBody.startsWith(keyword),
        );
    }

    private isKodyComment(
        comment: Comment,
        platformType: PlatformType,
    ): boolean {
        const login =
            platformType === PlatformType.GITHUB
                ? comment.user?.login
                : comment.author?.name;
        const body = comment.body.toLowerCase();
        const bodyWithoutMarkdown =
            platformType !== PlatformType.BITBUCKET
                ? KODY_IDENTIFIERS.MARKDOWN_IDENTIFIERS.DEFAULT
                : KODY_IDENTIFIERS.MARKDOWN_IDENTIFIERS.BITBUCKET;

        return (
            KODY_IDENTIFIERS.LOGIN_KEYWORDS.some((keyword) =>
                login?.includes(keyword),
            ) || body.includes(bodyWithoutMarkdown)
        );
    }

    private getAcknowledgmentBody(platformType: PlatformType): string {
        let msg: string = ACKNOWLEDGMENT_MESSAGES.DEFAULT;
        if (platformType !== PlatformType.BITBUCKET) {
            msg = `${msg}${ACKNOWLEDGMENT_MESSAGES.MARKDOWN_SUFFIX}`;
        }
        return msg.trim();
    }

    private getAcknowledgmentIds(
        originalKodyComment: Comment,
        ackResponse: any,
        platformType: PlatformType,
        comment?: Comment,
    ): [ackResponseId: string, parentId: string] {
        let ackResponseId;
        let parentId;
        switch (platformType) {
            case PlatformType.GITHUB:
                ackResponseId = ackResponse.id;
                parentId = originalKodyComment?.id;
                break;
            case PlatformType.GITLAB:
                ackResponseId = ackResponse.id;
                parentId = comment?.id;
                break;
            case PlatformType.BITBUCKET:
                ackResponseId = ackResponse.id;
                parentId = originalKodyComment?.id;
                break;
            case PlatformType.AZURE_REPOS:
                ackResponseId = ackResponse?.id;
                parentId = originalKodyComment?.threadId;
                break;
            default:
                this.logger.warn({
                    message: `Unsupported platform type: ${platformType}`,
                    context: ChatWithKodyFromGitUseCase.name,
                    metadata: {
                        originalKodyComment,
                        ackResponse,
                        platformType,
                    },
                });
                return ['', ''];
        }

        if (!ackResponseId || !parentId) {
            return ['', ''];
        }

        return [ackResponseId, parentId];
    }

    private getBusinessLogicAcknowledgmentIds(
        ackResponse: any,
        platformType: PlatformType,
    ): [string | number | null, string | number | null] {
        let ackResponseId;
        let parentId;

        switch (platformType) {
            case PlatformType.GITHUB:
                ackResponseId = ackResponse?.id;
                parentId = ackResponse?.id;
                break;

            case PlatformType.GITLAB:
                ackResponseId = ackResponse?.id;
                parentId = ackResponse?.notes?.[0]?.id;
                break;

            case PlatformType.BITBUCKET:
                ackResponseId = ackResponse?.id;
                parentId = ackResponse?.id;
                break;

            case PlatformType.AZURE_REPOS:
                ackResponseId = ackResponse?.id;
                parentId = ackResponse?.threadId;
                break;

            default:
                ackResponseId = ackResponse?.id;
                parentId = ackResponse?.id;
        }

        return [ackResponseId, parentId];
    }

    private async processCommand(
        commandType: CommandType,
        context: {
            prepareContext: any;
            organizationAndTeamData: OrganizationAndTeamData;
            thread: any;
        },
    ): Promise<string> {
        switch (commandType) {
            case CommandType.BUSINESS_LOGIC_VALIDATION:
                return await this.handleBusinessLogicValidation(context);
            case CommandType.CONVERSATION:
                return await this.handleConversation(context);
            default:
                return await this.handleConversation(context);
        }
    }

    private async handleBusinessLogicValidation(context: {
        prepareContext: any;
        organizationAndTeamData: OrganizationAndTeamData;
        thread: any;
    }): Promise<string> {
        return await this.businessRulesValidationAgentUseCase.execute(context);
    }

    private async handleConversation(context: {
        prepareContext: any;
        organizationAndTeamData: OrganizationAndTeamData;
        thread: any;
    }): Promise<string> {
        const { prepareContext, organizationAndTeamData, thread } = context;

        return await this.conversationAgentUseCase.execute({
            prompt: prepareContext.userQuestion,
            organizationAndTeamData,
            prepareContext: prepareContext,
            thread: thread,
        });
    }
}
