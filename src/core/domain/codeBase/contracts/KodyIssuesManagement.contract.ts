import { CodeSuggestion } from '@/config/types/general/codeReview.type';
import { contextToGenerateIssues } from '@/ee/kodyIssuesManagement/domain/kodyIssuesManagement.interface';

export const KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN = Symbol(
    'KodyIssuesManagementService',
);

export interface IKodyIssuesManagementService {
    processClosedPr(params: contextToGenerateIssues): Promise<void>;

    mergeSuggestionsIntoIssues(
        context: Pick<
            contextToGenerateIssues,
            'organizationAndTeamData' | 'repository' | 'pullRequest'
        >,
        filePath: string,
        newSuggestions: Partial<CodeSuggestion>[],
    ): Promise<any>;

    createNewIssues(
        context: Pick<
            contextToGenerateIssues,
            'organizationAndTeamData' | 'repository' | 'pullRequest'
        >,
        unmatchedSuggestions: Partial<CodeSuggestion>[],
    ): Promise<void>;

    resolveExistingIssues(
        context: Pick<
            contextToGenerateIssues,
            'organizationAndTeamData' | 'repository' | 'pullRequest'
        >,
        files: any[],
    ): Promise<void>;
}
