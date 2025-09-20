import { Inject, Injectable } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { PinoLoggerService } from '../../../logger/pino.service';
import { KodyRulesScope } from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import {
    KODY_RULES_PR_LEVEL_ANALYSIS_SERVICE_TOKEN,
    KodyRulesPrLevelAnalysisService,
} from '@/ee/codeBase/kodyRulesPrLevelAnalysis.service';
import {
    AnalysisContext,
    FileChange,
    ReviewModeResponse,
} from '@/config/types/general/codeReview.type';
import {
    CROSS_FILE_ANALYSIS_SERVICE_TOKEN,
    CrossFileAnalysisService,
} from '../../crossFileAnalysis.service';
import {
    FILE_REVIEW_CONTEXT_PREPARATION_TOKEN,
    IFileReviewContextPreparation,
} from '@/shared/interfaces/file-review-context-preparation.interface';

@Injectable()
export class ProcessFilesPrLevelReviewStage extends BasePipelineStage<CodeReviewPipelineContext> {
    readonly stageName = 'PRLevelReviewStage';

    constructor(
        private readonly logger: PinoLoggerService,

        @Inject(KODY_RULES_PR_LEVEL_ANALYSIS_SERVICE_TOKEN)
        private readonly kodyRulesPrLevelAnalysisService: KodyRulesPrLevelAnalysisService,

        @Inject(CROSS_FILE_ANALYSIS_SERVICE_TOKEN)
        private readonly crossFileAnalysisService: CrossFileAnalysisService,

        @Inject(FILE_REVIEW_CONTEXT_PREPARATION_TOKEN)
        private readonly fileReviewContextPreparation: IFileReviewContextPreparation,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        if (!context?.organizationAndTeamData) {
            this.logger.error({
                message: 'Missing organizationAndTeamData in context',
                context: this.stageName,
            });
            return context;
        }

        if (!context?.pullRequest?.number) {
            this.logger.error({
                message: 'Missing pullRequest data in context',
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                },
            });
            return context;
        }

        if (!context?.repository?.name || !context?.repository?.id) {
            this.logger.error({
                message: 'Missing repository data in context',
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                },
            });
            return context;
        }

        if (!context?.changedFiles?.length) {
            this.logger.warn({
                message: `No files to analyze for PR#${context.pullRequest.number}`,
                context: this.stageName,
                metadata: {
                    organizationId:
                        context.organizationAndTeamData.organizationId,
                    prNumber: context.pullRequest.number,
                },
            });
            return context;
        }

        //#region Kody Rules analysis
        try {
            const kodyRulesTurnedOn =
                context?.codeReviewConfig?.reviewOptions?.kody_rules;

            if (kodyRulesTurnedOn) {
                const prLevelRules =
                    context?.codeReviewConfig?.kodyRules?.filter(
                        (rule) => rule.scope === KodyRulesScope.PULL_REQUEST,
                    );

                if (prLevelRules?.length > 0) {
                    this.logger.log({
                        message: `Starting PR-level Kody Rules analysis for PR#${context.pullRequest.number}`,
                        context: this.stageName,
                        metadata: {
                            organizationAndTeamData:
                                context.organizationAndTeamData,
                            prNumber: context.pullRequest.number,
                        },
                    });

                    const kodyRulesPrLevelAnalysis =
                        await this.kodyRulesPrLevelAnalysisService.analyzeCodeWithAI(
                            context.organizationAndTeamData,
                            context.pullRequest.number,
                            context.changedFiles,
                            ReviewModeResponse.HEAVY_MODE,
                            context,
                        );

                    if (kodyRulesPrLevelAnalysis?.codeSuggestions?.length > 0) {
                        this.logger.log({
                            message: `PR-level analysis completed for PR#${context.pullRequest.number}`,
                            context: this.stageName,
                            metadata: {
                                suggestionsCount:
                                    kodyRulesPrLevelAnalysis?.codeSuggestions
                                        ?.length,
                                organizationAndTeamData:
                                    context.organizationAndTeamData,
                                prNumber: context.pullRequest.number,
                            },
                        });

                        const codeSuggestions =
                            kodyRulesPrLevelAnalysis?.codeSuggestions || [];

                        context = this.updateContext(context, (draft) => {
                            if (!draft.validSuggestionsByPR) {
                                draft.validSuggestionsByPR = [];
                            }

                            if (
                                codeSuggestions &&
                                Array.isArray(codeSuggestions)
                            ) {
                                draft.validSuggestionsByPR.push(
                                    ...codeSuggestions,
                                );
                            }
                        });
                    } else {
                        this.logger.warn({
                            message: `Analysis returned null for PR#${context.pullRequest.number}`,
                            context: this.stageName,
                            metadata: {
                                organizationAndTeamData:
                                    context.organizationAndTeamData,
                            },
                        });
                    }
                } else {
                    this.logger.log({
                        message: `No PR-level Kody Rules configured for PR#${context.pullRequest.number}`,
                        context: this.stageName,
                        metadata: {
                            organizationAndTeamData:
                                context.organizationAndTeamData,
                        },
                    });
                }
            }
        } catch (error) {
            this.logger.error({
                message: `Error during PR-level Kody Rules analysis for PR#${context.pullRequest.number}`,
                context: this.stageName,
                error,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                },
            });
        }
        //#endregion Kody Rules analysis

        //#region Cross-file analysis
        try {
            const preparedFilesData = context.changedFiles.map((file) => ({
                filename: file.filename,
                patchWithLinesStr: file.patchWithLinesStr,
            }));

            const crossFileAnalysis =
                await this.crossFileAnalysisService.analyzeCrossFileCode(
                    context.organizationAndTeamData,
                    context.pullRequest.number,
                    context,
                    preparedFilesData,
                );

            const crossFileAnalysisSuggestions =
                crossFileAnalysis?.codeSuggestions || [];

            if (crossFileAnalysisSuggestions.length > 0) {
                this.logger.log({
                    message: `Cross-file analysis completed for PR#${context.pullRequest.number}`,
                    context: this.stageName,
                    metadata: {
                        suggestionsCount: crossFileAnalysisSuggestions.length,
                        organizationAndTeamData:
                            context.organizationAndTeamData,
                        prNumber: context.pullRequest.number,
                    },
                });

                context = this.updateContext(context, (draft) => {
                    if (!draft.prAnalysisResults) {
                        draft.prAnalysisResults = {};
                    }
                    if (!draft.prAnalysisResults.validCrossFileSuggestions) {
                        draft.prAnalysisResults.validCrossFileSuggestions = [];
                    }
                    draft.prAnalysisResults.validCrossFileSuggestions.push(
                        ...crossFileAnalysisSuggestions,
                    );
                });
            } else {
                this.logger.log({
                    message: `No cross-file analysis suggestions found for PR#${context.pullRequest.number}`,
                    context: this.stageName,
                    metadata: {
                        organizationAndTeamData:
                            context.organizationAndTeamData,
                    },
                });
            }
        } catch (error) {
            this.logger.error({
                message: `Error during Cross-file analysis for PR#${context.pullRequest.number}`,
                context: this.stageName,
                error,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                },
            });
        }
        //#endregion Cross-file analysis
        return context;
    }
}
