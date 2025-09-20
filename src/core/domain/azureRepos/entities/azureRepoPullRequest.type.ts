import { AzureReposRepository } from './azureReposRepository.type';

export interface AzureRepoIdentity {
    displayName: string;
    url: string;
    _links: {
        avatar: {
            href: string;
        };
    };
    id: string;
    uniqueName: string;
    imageUrl: string;
    descriptor: string;
}

export interface AzureRepoCommitRef {
    commitId: string;
    url: string;
}

export enum AzurePRStatus {
    ABANDONED = 'abandoned', // closed
    ACTIVE = 'active', // open
    COMPLETED = 'completed', // merged
    NOT_SET = 'notSet', // Documentation says it's the default state.
    ALL = 'all', // Used in pull request search criteria to include all statuses.
}

export interface AzureRepoPullRequest {
    repository: Partial<AzureReposRepository>;
    pullRequestId: number;
    codeReviewId: number;
    status: AzurePRStatus;
    createdBy: AzureRepoIdentity;
    creationDate: string;
    closedDate: string;
    title: string;
    description: string;
    sourceRefName: string;
    targetRefName: string;
    mergeStatus: string;
    isDraft: boolean;
    mergeId: string;
    lastMergeSourceCommit: AzureRepoCommitRef;
    lastMergeTargetCommit: AzureRepoCommitRef;
    lastMergeCommit: AzureRepoCommitRef;
    reviewers: AzureRepoIdentity[];
    url: string;
    supportsIterations: boolean;
}
