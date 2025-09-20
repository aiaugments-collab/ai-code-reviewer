import {
    CodeReviewConfig,
    CodeSuggestion,
    Comment,
    CommentResult,
    FileChange,
    SummaryConfig,
} from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { LLMModelProvider } from '@kodus/kodus-common/llm';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { ISuggestionByPR } from '../../pullRequests/interfaces/pullRequests.interface';
import { IPullRequestMessageContent, IPullRequestMessages } from '../../pullRequestMessages/interfaces/pullRequestMessages.interface';

export const COMMENT_MANAGER_SERVICE_TOKEN = Symbol('CommentManagerService');

export interface ICommentManagerService {
    createInitialComment(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        repository: { name: string; id: string },
        changedFiles: FileChange[],
        language: string,
        platformType: string,
        codeReviewConfig?: CodeReviewConfig,
        startReviewMessage?: string,
    ): Promise<{ commentId: number; noteId: number; threadId?: number }>;

    generateSummaryPR(
        pullRequest: any,
        repository: { name: string; id: string },
        changedFiles: Partial<FileChange>[],
        organizationAndTeamData: OrganizationAndTeamData,
        languageResultPrompt: string,
        summaryConfig: SummaryConfig,
        isCommitRun?: boolean,
    ): Promise<string>;

    updateOverallComment(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        repository: { name: string; id: string },
        commentId: number,
        noteId: number,
        platformType: string,
        codeSuggestions?: Array<CommentResult>,
        codeReviewConfig?: CodeReviewConfig,
        threadId?: number,
    ): Promise<void>;

    updateSummarizationInPR(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        repository: { name: string; id: string },
        summary: string,
    ): Promise<void>;

    createLineComments(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        repository: { name: string; id: string; language: string },
        lineComments: Comment[],
        language: string,
    ): Promise<{
        lastAnalyzedCommit: any;
        commits: any[];
        commentResults: Array<CommentResult>;
    }>;

    generateSummaryMarkdown(
        changedFiles: FileChange[],
        description: string,
    ): string;

    repeatedCodeReviewSuggestionClustering(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        provider: LLMModelProvider,
        suggestions: any[],
    ): Promise<any>;

    enrichParentSuggestionsWithRelated(
        suggestions: CodeSuggestion[],
    ): Promise<CodeSuggestion[]>;

    createPrLevelReviewComments(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        repository: { name: string; id: string; language: string },
        prLevelSuggestions: ISuggestionByPR[],
        language: string,
    ): Promise<{ commentResults: Array<CommentResult> }>;

    findLastReviewComment(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        repository: { name: string; id: string },
        platformType: PlatformType,
    ): Promise<{ commentId: number; nodeId?: string } | null>;

    minimizeLastReviewComment(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        repository: { name: string; id: string },
        platformType: PlatformType,
    ): Promise<boolean>;

    createComment(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        repository: { name: string; id: string },
        platformType: PlatformType,
        changedFiles?: FileChange[],
        language?: string,
        codeSuggestions?: Array<CommentResult>,
        codeReviewConfig?: CodeReviewConfig,
        endReviewMessage?: IPullRequestMessageContent,
    ): Promise<void>;
}
