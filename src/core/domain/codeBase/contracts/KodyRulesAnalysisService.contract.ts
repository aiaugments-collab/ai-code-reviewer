import { FileChangeContext, ReviewModeResponse, AnalysisContext, AIAnalysisResult, AIAnalysisResultPrLevel } from "@/config/types/general/codeReview.type";
import { OrganizationAndTeamData } from "@/config/types/general/organizationAndTeamData";
import { IKodyRule } from "../../kodyRules/interfaces/kodyRules.interface";

export interface IKodyRulesAnalysisService {
    analyzeCodeWithAI(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        fileContext: FileChangeContext,
        reviewModeResponse: ReviewModeResponse,
        context: AnalysisContext,
        suggestions?: AIAnalysisResult,
    ): Promise<AIAnalysisResult | AIAnalysisResultPrLevel>;
}
