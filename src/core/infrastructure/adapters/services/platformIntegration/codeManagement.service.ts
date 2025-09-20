import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { PlatformIntegrationFactory } from './platformIntegration.factory';
import {
    IIntegrationService,
    INTEGRATION_SERVICE_TOKEN,
} from '@/core/domain/integrations/contracts/integration.service.contracts';
import {
    PullRequestAuthor,
    PullRequest,
    PullRequestReviewComment,
    PullRequestsWithChangesRequested,
    PullRequestReviewState,
} from '@/core/domain/platformIntegrations/types/codeManagement/pullRequests.type';
import { Repositories } from '@/core/domain/platformIntegrations/types/codeManagement/repositories.type';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { IntegrationCategory } from '@/shared/domain/enums/integration-category.enum';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { DoraMetricsConfig } from '@/core/domain/metrics/contracts/doraMetrics.factory.contract';
import { Commit } from '@/config/types/general/commit.type';
import { extractOrganizationAndTeamData } from '@/shared/utils/helpers';
import { CodeManagementConnectionStatus } from '@/shared/utils/decorators/validate-code-management-integration.decorator';
import {
    CommentResult,
    Repository,
    ReviewComment,
} from '@/config/types/general/codeReview.type';
import { ICodeManagementService } from '@/core/domain/platformIntegrations/interfaces/code-management.interface';
import { GitCloneParams } from '@/core/domain/platformIntegrations/types/codeManagement/gitCloneParams.type';
import { PullRequestState } from '@/shared/domain/enums/pullRequestState.enum';
import { RepositoryFile } from '@/core/domain/platformIntegrations/types/codeManagement/repositoryFile.type';

@Injectable()
export class CodeManagementService implements ICodeManagementService {
    constructor(
        @Inject(forwardRef(() => INTEGRATION_SERVICE_TOKEN))
        private readonly integrationService: IIntegrationService,
        private platformIntegrationFactory: PlatformIntegrationFactory,
    ) {}

    async getTypeIntegration(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<PlatformType> {
        try {
            const integration = await this.integrationService.findOne({
                organization: { uuid: organizationAndTeamData.organizationId },
                team: { uuid: organizationAndTeamData.teamId },
                integrationCategory: IntegrationCategory.CODE_MANAGEMENT,
                status: true,
            });

            if (!integration) {
                return null;
            }

            return integration.platform;
        } catch (error) {
            console.log(error);
        }
    }

    async getCommits(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository?: Partial<Repository>;
            filters?: {
                startDate?: Date;
                endDate?: Date;
                author?: string;
                branch?: string;
            };
        },
        type?: PlatformType,
    ): Promise<Commit[]> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        if (!type) {
            return [];
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getCommits(params);
    }

    async getRepositories(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            filters?: {
                archived?: boolean;
                organizationSelected?: string;
                visibility?: 'all' | 'public' | 'private';
                language?: string;
            };
        },
        type?: PlatformType,
    ): Promise<Repositories[]> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getRepositories(params);
    }

    async getWorkflows(params: any, type?: PlatformType): Promise<any> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        if (type === PlatformType.AZURE_REPOS) {
            return codeManagementService.getWorkflows(params);
        }

        return codeManagementService.getWorkflows(
            params.organizationAndTeamData,
        );
    }
    async getListMembers(params: any, type?: PlatformType): Promise<any> {
        type =
            type ??
            (await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            ));

        if (!type) {
            return [];
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return await codeManagementService.getListMembers(params);
    }

    async verifyConnection(
        params: any,
        type?: PlatformType,
    ): Promise<CodeManagementConnectionStatus> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        if (!type) return null;

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.verifyConnection(params);
    }

    async createAuthIntegration(
        params: any,
        type?: PlatformType,
    ): Promise<void> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.createAuthIntegration(params);
    }

    async updateAuthIntegration(
        params: any,
        type?: PlatformType,
    ): Promise<void> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.updateAuthIntegration(params);
    }

    async createOrUpdateIntegrationConfig(
        params: any,
        type?: PlatformType,
    ): Promise<void> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.createOrUpdateIntegrationConfig(params);
    }

    async getCommitsByReleaseMode(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            doraMetricsConfig?: DoraMetricsConfig;
            deployFrequencyData?: any;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getCommitsByReleaseMode(params);
    }

    async getPullRequests(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository?: {
                id: string;
                name: string;
            };
            filters?: {
                startDate?: Date;
                endDate?: Date;
                state?: PullRequestState;
                author?: string;
                branch?: string;
                number?: number;
                title?: string;
                url?: string;
            };
        },
        type?: PlatformType,
    ): Promise<PullRequest[]> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequests(params);
    }

    async getPullRequestsWithFiles(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            filters: any;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequestsWithFiles(params);
    }

    async getPullRequestsForRTTM(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            filters: any;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequestsForRTTM(params);
    }

    async getPullRequestAuthors(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
        },
        type?: PlatformType,
    ): Promise<PullRequestAuthor[]> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequestAuthors(params);
    }

    async getOrganizations(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getOrganizations(params);
    }

    async getFilesByPullRequestId(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getFilesByPullRequestId(params);
    }

    async getChangedFilesSinceLastCommit(params: any, type?: PlatformType) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getChangedFilesSinceLastCommit(params);
    }

    async createCommentInPullRequest(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
            overallComment: any;
            lineComments?: any;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.createCommentInPullRequest(params);
    }

    async getRepositoryContentFile(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            file: any;
            pullRequest: any;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getRepositoryContentFile(params);
    }

    async getPullRequestByNumber(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequestByNumber(params);
    }

    async createReviewComment(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string; language: string };
            prNumber: number;
            lineComment: any;
            commit: any;
            language: string;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.createReviewComment(params);
    }

    async getCommitsForPullRequestForCodeReview(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getCommitsForPullRequestForCodeReview(
            params,
        );
    }

    async createIssueComment(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
            body: string;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.createIssueComment(params);
    }

    async createSingleIssueComment(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
            body: string;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        if (type === PlatformType.GITLAB) {
            return codeManagementService.createSingleIssueComment(params);
        }
        return codeManagementService.createIssueComment(params);
    }

    async updateIssueComment(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
            body: string;
            commentId: number;
            noteId?: number;
            threadId?: number;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.updateIssueComment(params);
    }

    async findTeamAndOrganizationIdByConfigKey(
        params: any,
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.findTeamAndOrganizationIdByConfigKey(
            params,
        );
    }

    async getDefaultBranch(params: any, type?: PlatformType) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getDefaultBranch(params);
    }

    async getPullRequestReviewComment(params: any, type?: PlatformType) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequestReviewComment(params);
    }

    async createResponseToComment(params: any, type?: PlatformType) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.createResponseToComment(params);
    }

    async getPullRequest(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: Partial<Repository>;
            prNumber: number;
        },
        type?: PlatformType,
    ): Promise<PullRequest | null> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequest(params);
    }

    async updateDescriptionInPullRequest(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
            summary: string;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.updateDescriptionInPullRequest(params);
    }

    async getAuthenticationOAuthToken(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getAuthenticationOAuthToken(params);
    }

    async countReactions(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            comments: any[];
            pr: any;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.countReactions(params);
    }

    async minimizeComment(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            commentId: string;
            reason?:
                | 'ABUSE'
                | 'OFF_TOPIC'
                | 'OUTDATED'
                | 'RESOLVED'
                | 'DUPLICATE'
                | 'SPAM';
        },
        type?: PlatformType,
    ): Promise<any | null> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.minimizeComment(params);
    }

    async getRepositoryAllFiles(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: {
                id: string;
                name: string;
            };
            filters?: {
                branch?: string;
                filePatterns?: string[];
                excludePatterns?: string[];
                maxFiles?: number;
            };
        },
        type?: PlatformType,
    ): Promise<RepositoryFile[]> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getRepositoryAllFiles(params);
    }

    async getLanguageRepository(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getLanguageRepository(params);
    }

    async mergePullRequest(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.mergePullRequest(params);
    }

    async getCloneParams(
        params: {
            repository: Pick<
                Repository,
                'id' | 'defaultBranch' | 'fullName' | 'name'
            >;
            organizationAndTeamData: OrganizationAndTeamData;
        },
        type?: PlatformType,
    ): Promise<GitCloneParams> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getCloneParams(params);
    }

    async approvePullRequest(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.approvePullRequest(params);
    }

    async requestChangesPullRequest(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
            criticalComments: CommentResult[];
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.requestChangesPullRequest(params);
    }

    async getAllCommentsInPullRequest(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { name: string; id: string };
            prNumber: number;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getAllCommentsInPullRequest(params);
    }

    async getUserByUsername(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            username: string;
        },
        type?: PlatformType,
    ) {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getUserByUsername(params);
    }

    async getUserByEmailOrName(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            email?: string;
            userName: string;
        },
        type?: PlatformType,
    ): Promise<any | null> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getUserByEmailOrName(params);
    }

    async getUserById(
        params: {
            userId: string;
            organizationAndTeamData: OrganizationAndTeamData;
        },
        type?: PlatformType,
    ): Promise<any | null> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getUserById(params);
    }

    async markReviewCommentAsResolved(
        params: any,
        type?: PlatformType,
    ): Promise<any | null> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.markReviewCommentAsResolved(params);
    }

    async getPullRequestReviewComments(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: Partial<Repository>;
            prNumber: number;
        },
        type?: PlatformType,
    ): Promise<PullRequestReviewComment[] | null> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequestReviewComments(params);
    }

    async getPullRequestsByRepository(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: { id: string; name: string };
            filters?: {
                startDate: string;
                endDate: string;
                number?: number;
                branch?: string;
            };
        },
        type?: PlatformType,
    ): Promise<any[]> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequestsByRepository(params);
    }

    async getPullRequestReviewThreads(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: Partial<Repository>;
            prNumber: number;
        },
        type?: PlatformType,
    ): Promise<any | null> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequestReviewThreads(params);
    }

    async getPullRequestsWithChangesRequested(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: Partial<Repository>;
        },
        type?: PlatformType,
    ): Promise<PullRequestsWithChangesRequested[] | null> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getPullRequestsWithChangesRequested(
            params,
        );
    }

    async getListOfValidReviews(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repository: Partial<Repository>;
            prNumber: number;
        },
        type?: PlatformType,
    ): Promise<any[] | null> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getListOfValidReviews(params);
    }

    async checkIfPullRequestShouldBeApproved(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            prNumber: number;
            repository: { id: string; name: string };
        },
        type?: PlatformType,
    ): Promise<any | null> {
        if (!type) {
            type = await this.getTypeIntegration(
                extractOrganizationAndTeamData(params),
            );
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.checkIfPullRequestShouldBeApproved(params);
    }

    async deleteWebhook(params: {
        organizationAndTeamData: OrganizationAndTeamData;
    }): Promise<void> {
        const type = await this.getTypeIntegration(
            params.organizationAndTeamData,
        );

        if (!type) {
            return;
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.deleteWebhook(params);
    }

    async formatReviewCommentBody(params: {
        suggestion: any;
        repository: { name: string; language: string };
        includeHeader?: boolean;
        includeFooter?: boolean;
        language?: string;
        organizationAndTeamData: OrganizationAndTeamData;
    }): Promise<string> {
        const type = await this.getTypeIntegration(
            params.organizationAndTeamData,
        );

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.formatReviewCommentBody({
            suggestion: params.suggestion,
            repository: params.repository,
            includeHeader: params.includeHeader ?? true,
            includeFooter: params.includeFooter ?? true,
            language: params.language,
            organizationAndTeamData: params.organizationAndTeamData,
        });
    }

    async getRepositoryTree(
        params: {
            organizationAndTeamData: OrganizationAndTeamData;
            repositoryId: string;
        },
        type?: PlatformType,
    ): Promise<any> {
        if (!type) {
            type = await this.getTypeIntegration(
                params.organizationAndTeamData,
            );
        }

        if (!type) {
            return [];
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getRepositoryTree(params);
    }

    async updateResponseToComment(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        parentId: string;
        commentId: string;
        body: string;
        repository: { id: string; name: string };
        prNumber: number;
    }): Promise<any | null> {
        const type = await this.getTypeIntegration(
            params.organizationAndTeamData,
        );

        if (!type) {
            return null;
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.updateResponseToComment(params);
    }

    async isDraftPullRequest(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repository: Partial<Repository>;
        prNumber: number;
    }): Promise<boolean> {
        const type = await this.getTypeIntegration(
            params.organizationAndTeamData,
        );

        if (!type) {
            return false;
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.isDraftPullRequest(params);
    }

    async getReviewStatusByPullRequest(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repository: Partial<Repository>;
        prNumber: number;
    }): Promise<PullRequestReviewState | null> {
        const type = await this.getTypeIntegration(
            params.organizationAndTeamData,
        );

        if (!type) {
            return null;
        }

        const codeManagementService =
            this.platformIntegrationFactory.getCodeManagementService(type);

        return codeManagementService.getReviewStatusByPullRequest(params);
    }
}
