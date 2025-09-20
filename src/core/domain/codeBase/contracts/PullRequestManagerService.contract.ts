import { FileChange } from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PullRequestAuthor } from '../../platformIntegrations/types/codeManagement/pullRequests.type';
import { Commit } from '@/config/types/general/commit.type';

export const PULL_REQUEST_MANAGER_SERVICE_TOKEN = Symbol(
    'PullRequestManagerService',
);

export interface IPullRequestManagerService {
    getPullRequestDetails(
        organizationAndTeamData: OrganizationAndTeamData,
        repository: { name: string; id: any },
        prNumber: number,
    ): Promise<any>;

    getChangedFiles(
        organizationAndTeamData: OrganizationAndTeamData,
        repository: { name: string; id: any },
        pullRequest: any,
        ignorePaths: string[],
        lastCommit?: string,
    ): Promise<FileChange[]>;

    getPullRequestAuthorsWithCache(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<PullRequestAuthor[]>;

    getNewCommitsSinceLastExecution(
        organizationAndTeamData: OrganizationAndTeamData,
        repository: { name: string; id: any },
        pullRequest: any,
        lastCommit?: string,
    ): Promise<Commit[]>;
}
