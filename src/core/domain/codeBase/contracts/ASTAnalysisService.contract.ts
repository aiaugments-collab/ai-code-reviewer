import {
    AIAnalysisResult,
    AnalysisContext,
    ReviewModeResponse,
} from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    GetImpactAnalysisResponse,
    InitializeImpactAnalysisResponse,
    InitializeRepositoryResponse,
} from '@kodus/kodus-proto/ast';
import { GetTaskInfoResponse } from '@kodus/kodus-proto/task';

export const AST_ANALYSIS_SERVICE_TOKEN = Symbol('ASTAnalysisService');

export interface IASTAnalysisService {
    awaitTask(
        taskId: string,
        organizationAndTeamData: OrganizationAndTeamData,
        options?: {
            timeout?: number;
            interval?: number;
        },
    ): Promise<GetTaskInfoResponse>;
    analyzeASTWithAI(
        context: AnalysisContext,
        reviewModeResponse: ReviewModeResponse,
    ): Promise<AIAnalysisResult>;
    initializeASTAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
        filePaths?: string[],
    ): Promise<InitializeRepositoryResponse>;
    deleteASTAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<void>;
    initializeImpactAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
        codeChunk: string,
        fileName: string,
    ): Promise<InitializeImpactAnalysisResponse>;
    getImpactAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: any,
    ): Promise<GetImpactAnalysisResponse>;
    getRelatedContentFromDiff(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
        diff: string,
        filePath: string,
    ): Promise<string>;
}
