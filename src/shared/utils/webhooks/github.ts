import {
    IMappedComment,
    IMappedPlatform,
    IMappedPullRequest,
    IMappedRepository,
    IMappedUsers,
    MappedAction,
} from '@/core/domain/platformIntegrations/types/webhooks/webhooks-common.type';
import {
    IWebhookGithubPullRequestEvent,
    IWebhookGithubPullRequestCommentEvent,
} from '@/core/domain/platformIntegrations/types/webhooks/webhooks-github.type';
import { extractRepoFullName } from '.';

export class GithubMappedPlatform implements IMappedPlatform {
    mapUsers(params: {
        payload: IWebhookGithubPullRequestEvent;
    }): IMappedUsers {
        if (!params?.payload?.pull_request) {
            return null;
        }

        const { payload } = params;

        return {
            user: payload?.pull_request?.user,
            assignees: payload?.pull_request?.assignees,
            reviewers: payload?.pull_request?.requested_reviewers,
        };
    }

    mapPullRequest(params: {
        payload: IWebhookGithubPullRequestEvent;
    }): IMappedPullRequest {
        if (!params?.payload?.pull_request) {
            return null;
        }

        const { payload } = params;

        return {
            ...payload?.pull_request,
            repository: payload?.repository,
            title: payload?.pull_request?.title,
            body: payload?.pull_request?.body,
            number: payload?.pull_request?.number,
            user: payload?.pull_request?.user,
            head: {
                repo: {
                    fullName: payload?.pull_request?.head?.repo?.full_name,
                },
                ref: payload?.pull_request?.head?.ref,
            },
            base: {
                repo: {
                    fullName: payload?.pull_request?.base?.repo?.full_name,
                    defaultBranch: payload?.repository?.default_branch,
                },
                ref: payload?.pull_request?.base?.ref,
            },
            isDraft: payload?.pull_request?.draft ?? false,
        };
    }

    mapRepository(params: {
        payload: IWebhookGithubPullRequestEvent;
    }): IMappedRepository {
        if (!params?.payload?.repository) {
            return null;
        }

        const repository = params?.payload?.repository;

        return {
            ...repository,
            id: repository?.id.toString(),
            name: repository?.name,
            language: repository?.language,
            fullName:
                extractRepoFullName(params?.payload?.pull_request) ??
                repository?.name ??
                '',
        };
    }

    mapComment(params: {
        payload: IWebhookGithubPullRequestCommentEvent;
    }): IMappedComment {
        if (!params?.payload?.comment) {
            return null;
        }

        return {
            id: params?.payload?.comment?.id.toString(),
            body: params?.payload?.comment?.body,
        };
    }

    mapAction(params: {
        payload: IWebhookGithubPullRequestEvent;
    }): MappedAction | string | null {
        if (!params?.payload?.action) {
            return null;
        }

        switch (params?.payload?.action) {
            case 'opened':
                return MappedAction.OPENED;
            case 'synchronize':
                return MappedAction.UPDATED;
            default:
                return params?.payload?.action;
        }
    }
}
