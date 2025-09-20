import { Injectable } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import { PinoLoggerService } from '../../../logger/pino.service';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';

@Injectable()
export class AggregateResultsStage extends BasePipelineStage<CodeReviewPipelineContext> {
    readonly stageName = 'AggregateResultsStage';

    constructor(private readonly logger: PinoLoggerService) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        if (
            !context.fileAnalysisResults ||
            context.fileAnalysisResults.length === 0
        ) {
            this.logger.warn({
                message: `No file analysis results to aggregate for PR#${context.pullRequest.number}`,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                },
            });
        } else {
            const overallComments = [];
            const validSuggestions = [];
            const discardedSuggestions = [];

            context.fileAnalysisResults?.forEach((result) => {
                if (result.validSuggestionsToAnalyze.length > 0) {
                    validSuggestions.push(...result.validSuggestionsToAnalyze);
                }
                if (result.discardedSuggestionsBySafeGuard.length > 0) {
                    discardedSuggestions.push(
                        ...result.discardedSuggestionsBySafeGuard,
                    );
                }
                if (result.overallComment.summary) {
                    overallComments.push(result.overallComment);
                }
            });

            this.logger.log({
                message: `Aggregated ${validSuggestions.length} valid suggestions, ${discardedSuggestions.length} discarded suggestions, and ${overallComments.length} overall comments`,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                },
            });

            context = this.updateContext(context, (draft) => {
                draft.overallComments = overallComments;
                draft.validSuggestions = validSuggestions;
                draft.discardedSuggestions = discardedSuggestions;
            });
        }

        if (
            !context.prAnalysisResults ||
            (context.prAnalysisResults.validSuggestionsByPR?.length === 0 &&
                context.prAnalysisResults.validCrossFileSuggestions?.length ===
                    0)
        ) {
            this.logger.warn({
                message: `No valid suggestions to aggregate for PR#${context.pullRequest.number}`,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                },
            });
        } else {
            const validSuggestionsByPR = [];
            const validCrossFileSuggestions = [];

            if (
                context.prAnalysisResults?.validSuggestionsByPR &&
                context.prAnalysisResults.validSuggestionsByPR?.length > 0
            ) {
                validSuggestionsByPR.push(
                    ...context.prAnalysisResults.validSuggestionsByPR,
                );
            }

            if (
                context.prAnalysisResults?.validCrossFileSuggestions &&
                context.prAnalysisResults.validCrossFileSuggestions?.length > 0
            ) {
                validCrossFileSuggestions.push(
                    ...context.prAnalysisResults.validCrossFileSuggestions,
                );
            }

            this.logger.log({
                message: `Aggregated ${validSuggestionsByPR.length} valid suggestions by PR, ${validCrossFileSuggestions.length} valid cross-file suggestions`,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                },
            });

            context = this.updateContext(context, (draft) => {
                draft.validSuggestionsByPR = validSuggestionsByPR;
                draft.validCrossFileSuggestions = validCrossFileSuggestions;
            });
        }

        return context;
    }
}
