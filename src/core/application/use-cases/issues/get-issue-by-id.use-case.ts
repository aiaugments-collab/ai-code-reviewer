import {
    IIssuesService,
    ISSUES_SERVICE_TOKEN,
} from '@/core/domain/issues/contracts/issues.service.contract';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';
import { IssuesEntity } from '@/core/domain/issues/entities/issues.entity';
import {
    CODE_REVIEW_FEEDBACK_SERVICE_TOKEN,
    ICodeReviewFeedbackService,
} from '@/core/domain/codeReviewFeedback/contracts/codeReviewFeedback.service.contract';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import {
    IContributingSuggestion,
    IIssueDetails,
} from '@/ee/kodyIssuesManagement/domain/kodyIssuesManagement.interface';
import { KodyIssuesManagementService } from '@/ee/kodyIssuesManagement/service/kodyIssuesManagement.service';
import { KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN } from '@/core/domain/codeBase/contracts/KodyIssuesManagement.contract';
import { REQUEST } from '@nestjs/core';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Injectable()
export class GetIssueByIdUseCase implements IUseCase {
    constructor(
        @Inject(ISSUES_SERVICE_TOKEN)
        private readonly issuesService: IIssuesService,

        @Inject(CODE_REVIEW_FEEDBACK_SERVICE_TOKEN)
        private readonly codeReviewFeedbackService: ICodeReviewFeedbackService,

        @Inject(KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN)
        private readonly kodyIssuesManagementService: KodyIssuesManagementService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: {
                uuid: string;
                organization: { uuid: string };
            };
        },

        private readonly authorizationService: AuthorizationService,
    ) {}

    async execute(id: string): Promise<IIssueDetails | null> {
        const issue = await this.issuesService.findById(id);

        if (!issue || !issue.repository?.id) {
            return null;
        }

        await this.authorizationService.ensure({
            user: this.request.user,
            action: Action.Read,
            resource: ResourceType.Issues,
            repoIds: [issue.repository.id],
        });

        const codeReviewFeedback =
            await this.codeReviewFeedbackService.getByOrganizationId(
                issue.organizationId,
            );

        const reactions = await this.calculateTotalReactions(
            issue,
            codeReviewFeedback,
        );
        const prUrls = await this.selectAllPrNumbers(issue);

        const dataToBuildUrls = {
            platform: issue.repository.platform,
            repositoryName: issue.repository.name,
            repositoryFullName: issue.repository.full_name,
        };

        const enrichedContributingSuggestions =
            await this.kodyIssuesManagementService.enrichContributingSuggestions(
                issue.contributingSuggestions,
                issue.organizationId,
            );

        return {
            id: issue.uuid,
            title: issue.title,
            description: issue.description,
            age: await this.kodyIssuesManagementService.ageCalculation(issue),
            label: issue.label,
            severity: issue.severity,
            status: issue.status,
            contributingSuggestions: enrichedContributingSuggestions.map(
                (suggestion) => ({
                    id: suggestion.id,
                    prNumber: suggestion.prNumber,
                    prAuthor: suggestion.prAuthor,
                    language: suggestion.language,
                    existingCode: suggestion.existingCode,
                    improvedCode: suggestion.improvedCode,
                }),
            ),
            fileLink: {
                label: issue.filePath,
                url: this.buildFileUrl(dataToBuildUrls, issue.filePath),
            },
            prLinks: prUrls.map((pr) => ({
                label: pr.number,
                url: pr.url,
            })),
            repositoryLink: {
                label: issue.repository.name,
                url: this.buildRepositoryUrl(dataToBuildUrls),
            },
            language: issue.language,
            reactions,
            gitOrganizationName: issue.repository.full_name.split('/')[0],
            repository: {
                id: issue.repository.id,
                name: issue.repository.name,
            },
        };
    }

    //#region Auxiliary functions
    private async calculateTotalReactions(
        issue: IssuesEntity,
        codeReviewFeedback: any[],
    ): Promise<{ thumbsUp: number; thumbsDown: number }> {
        if (!codeReviewFeedback?.length) {
            return { thumbsUp: 0, thumbsDown: 0 };
        }

        const suggestionIds = new Set<string>();

        if (issue.contributingSuggestions?.length) {
            issue.contributingSuggestions.forEach((suggestion) => {
                if (suggestion.id) {
                    suggestionIds.add(suggestion.id);
                }
            });
        }

        const allRelevantFeedbacks = codeReviewFeedback?.filter(
            (feedback) =>
                feedback?.suggestionId &&
                suggestionIds.has(feedback.suggestionId),
        );

        let totalThumbsUp = 0;
        let totalThumbsDown = 0;

        allRelevantFeedbacks.forEach((feedback) => {
            if (feedback.reactions) {
                if (typeof feedback.reactions.thumbsUp === 'number') {
                    totalThumbsUp += feedback.reactions.thumbsUp;
                }
                if (typeof feedback.reactions.thumbsDown === 'number') {
                    totalThumbsDown += feedback.reactions.thumbsDown;
                }
            }
        });

        return {
            thumbsUp: totalThumbsUp,
            thumbsDown: totalThumbsDown,
        };
    }

    private async selectAllPrNumbers(issue: IssuesEntity): Promise<
        {
            number: string;
            url: string;
        }[]
    > {
        const prNumbers = new Set<string>();

        if (issue.contributingSuggestions?.length) {
            issue.contributingSuggestions.forEach((suggestion) => {
                if (suggestion.prNumber) {
                    prNumbers.add(suggestion.prNumber.toString());
                }
            });
        }

        const dataToBuildUrls = {
            platform: issue.repository.platform,
            repositoryName: issue.repository.name,
            repositoryFullName: issue.repository.full_name,
        };

        const repositoryUrl = this.buildRepositoryUrl(dataToBuildUrls);

        issue.repository.url = repositoryUrl;

        const orderedPrNumbers = Array.from(prNumbers).sort(
            (a, b) => parseInt(a) - parseInt(b),
        );

        return orderedPrNumbers.map((prNumber) => ({
            number: prNumber,
            url: this.buildPullRequestUrl(dataToBuildUrls, prNumber),
        }));
    }

    //#endregion

    //#region Build URLs
    private buildFileUrl(
        data: {
            platform: PlatformType;
            repositoryName: string;
            repositoryFullName: string;
        },
        filePath: string,
        branch: string = 'main',
    ): string {
        const cleanFilePath = filePath.startsWith('/')
            ? filePath.substring(1)
            : filePath;

        switch (data.platform) {
            case PlatformType.GITHUB:
                return `https://github.com/${data.repositoryFullName}/blob/${branch}/${cleanFilePath}`;
            case PlatformType.GITLAB:
                return `https://gitlab.com/${data.repositoryFullName}/-/blob/${branch}/${cleanFilePath}`;
            case PlatformType.AZURE_REPOS:
                return `https://dev.azure.com/${data.repositoryFullName}/_git/${data.repositoryName}?path=/${cleanFilePath}`;
            case PlatformType.BITBUCKET:
                return `https://bitbucket.org/${data.repositoryFullName}/src/${branch}/${cleanFilePath}`;
            default:
                throw new Error(`Platform not supported: ${data.platform}`);
        }
    }

    private buildPullRequestUrl(
        data: {
            platform: PlatformType;
            repositoryName: string;
            repositoryFullName: string;
        },
        prNumber: string,
    ): string {
        switch (data.platform) {
            case PlatformType.GITHUB:
                return `https://github.com/${data.repositoryFullName}/pull/${prNumber}`;
            case PlatformType.GITLAB:
                return `https://gitlab.com/${data.repositoryFullName}/-/merge_requests/${prNumber}`;
            case PlatformType.AZURE_REPOS:
                return `https://dev.azure.com/${data.repositoryFullName}/_git/${data.repositoryName}/pullrequest/${prNumber}`;
            case PlatformType.BITBUCKET:
                return `https://bitbucket.org/${data.repositoryFullName}/pull-requests/${prNumber}`;
            default:
                throw new Error(`Platform not supported: ${data.platform}`);
        }
    }

    private buildRepositoryUrl(data: {
        platform: PlatformType;
        repositoryFullName: string;
    }): string {
        switch (data.platform) {
            case PlatformType.GITHUB:
                return `https://github.com/${data.repositoryFullName}`;
            case PlatformType.GITLAB:
                return `https://gitlab.com/${data.repositoryFullName}`;
            case PlatformType.AZURE_REPOS:
                return `https://dev.azure.com/${data.repositoryFullName}`;
            case PlatformType.BITBUCKET:
                return `https://bitbucket.org/${data.repositoryFullName}`;
            default:
                throw new Error(`Platform not supported: ${data.platform}`);
        }
    }
    //#endregion
}
