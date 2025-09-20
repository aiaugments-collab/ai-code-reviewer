import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';

import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import { PinoLoggerService } from '../../../logger/pino.service';
import {
    AIAnalysisResult,
    AnalysisContext,
    CodeReviewConfig,
    CodeReviewVersion,
    CodeSuggestion,
    FileChange,
    IFinalAnalysisResult,
    Repository,
} from '@/config/types/general/codeReview.type';
import { benchmark } from '@/shared/utils/benchmark.util';
import { createOptimizedBatches } from '@/shared/utils/batch.helper';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';

import {
    IPullRequestsService,
    PULL_REQUESTS_SERVICE_TOKEN,
} from '@/core/domain/pullRequests/contracts/pullRequests.service.contracts';
import {
    ISuggestionService,
    SUGGESTION_SERVICE_TOKEN,
} from '@/core/domain/codeBase/contracts/SuggestionService.contract';
import {
    FILE_REVIEW_CONTEXT_PREPARATION_TOKEN,
    IFileReviewContextPreparation,
} from '@/shared/interfaces/file-review-context-preparation.interface';
import { DeliveryStatus } from '@/core/domain/pullRequests/enums/deliveryStatus.enum';
import { ImplementationStatus } from '@/core/domain/pullRequests/enums/implementationStatus.enum';
import { PriorityStatus } from '@/core/domain/pullRequests/enums/priorityStatus.enum';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import {
    IKodyFineTuningContextPreparationService,
    KODY_FINE_TUNING_CONTEXT_PREPARATION_TOKEN,
} from '@/shared/interfaces/kody-fine-tuning-context-preparation.interface';
import {
    IKodyASTAnalyzeContextPreparationService,
    KODY_AST_ANALYZE_CONTEXT_PREPARATION_TOKEN,
} from '@/shared/interfaces/kody-ast-analyze-context-preparation.interface';
import { CodeAnalysisOrchestrator } from '@/ee/codeBase/codeAnalysisOrchestrator.service';
import { TaskStatus } from '@kodus/kodus-proto/task';

@Injectable()
export class ProcessFilesReview extends BasePipelineStage<CodeReviewPipelineContext> {
    readonly stageName = 'FileAnalysisStage';

    private readonly concurrencyLimit = 20;

    constructor(
        @Inject(SUGGESTION_SERVICE_TOKEN)
        private readonly suggestionService: ISuggestionService,

        @Inject(PULL_REQUESTS_SERVICE_TOKEN)
        private readonly pullRequestService: IPullRequestsService,

        @Inject(FILE_REVIEW_CONTEXT_PREPARATION_TOKEN)
        private readonly fileReviewContextPreparation: IFileReviewContextPreparation,

        @Inject(KODY_FINE_TUNING_CONTEXT_PREPARATION_TOKEN)
        private readonly kodyFineTuningContextPreparation: IKodyFineTuningContextPreparationService,

        @Inject(KODY_AST_ANALYZE_CONTEXT_PREPARATION_TOKEN)
        private readonly kodyAstAnalyzeContextPreparation: IKodyASTAnalyzeContextPreparationService,

        private readonly codeAnalysisOrchestrator: CodeAnalysisOrchestrator,
        private logger: PinoLoggerService,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        if (!context.changedFiles || context.changedFiles.length === 0) {
            this.logger.warn({
                message: `No files to analyze for PR#${context.pullRequest.number}`,
                context: this.stageName,
            });
            return context;
        }

        try {
            const {
                validSuggestions,
                discardedSuggestions,
                overallComments,
                fileMetadata,
                tasks,
            } = await this.analyzeChangedFilesInBatches(context);

            return this.updateContext(context, (draft) => {
                draft.validSuggestions = validSuggestions;
                draft.discardedSuggestions = discardedSuggestions;
                draft.overallComments = overallComments;
                draft.fileMetadata = fileMetadata;
                draft.tasks = tasks;
            });
        } catch (error) {
            this.logger.error({
                message: 'Error analyzing files in batches',
                error,
                context: this.stageName,
                metadata: {
                    pullRequestNumber: context.pullRequest.number,
                    repositoryName: context.repository.name,
                    batchCount: context.batches?.length || 0,
                },
            });

            // Mesmo em caso de erro, retornamos o contexto para que o pipeline continue
            return this.updateContext(context, (draft) => {
                draft.validSuggestions = [];
                draft.discardedSuggestions = [];
                draft.overallComments = [];
                draft.fileMetadata = new Map();
            });
        }
    }

    async analyzeChangedFilesInBatches(
        context: CodeReviewPipelineContext,
    ): Promise<{
        validSuggestions: Partial<CodeSuggestion>[];
        discardedSuggestions: Partial<CodeSuggestion>[];
        overallComments: { filepath: string; summary: string }[];
        fileMetadata: Map<string, any>;
        validCrossFileSuggestions: CodeSuggestion[];
        tasks: AnalysisContext['tasks'];
    }> {
        const { organizationAndTeamData, pullRequest, changedFiles } = context;
        const analysisContext =
            this.createAnalysisContextFromPipelineContext(context);

        const label = `Total review pipeline for PR#${pullRequest.number}`;

        return benchmark(
            { label, metadata: context.organizationAndTeamData },
            this.logger,
            async () => {
                try {
                    this.logger.log({
                        message: `Starting batch analysis of ${changedFiles.length} files`,
                        context: ProcessFilesReview.name,
                        metadata: {
                            organizationId:
                                organizationAndTeamData.organizationId,
                            teamId: organizationAndTeamData.teamId,
                            pullRequestNumber: pullRequest.number,
                        },
                    });

                    const batches = this.createOptimizedBatches(changedFiles);

                    // Criar um novo Map para esta execução
                    const fileMetadata = new Map<string, any>();

                    const execution = await this.runBatches(
                        batches,
                        analysisContext,
                        fileMetadata,
                        context.prAnalysisResults?.validCrossFileSuggestions,
                    );

                    this.logger.log({
                        message: `Finished all batches - Analysis complete for PR#${pullRequest.number}`,
                        context: ProcessFilesReview.name,
                        metadata: {
                            validSuggestionsCount:
                                execution.validSuggestions.length,
                            discardedCount:
                                execution.discardedSuggestions.length,
                            overallCommentsCount:
                                execution.overallComments.length,
                            tasks: execution.tasks,
                            organizationAndTeamData: organizationAndTeamData,
                        },
                    });

                    // Retornar apenas os dados analisados sem criar comentários
                    return {
                        validSuggestions: execution.validSuggestions,
                        discardedSuggestions: execution.discardedSuggestions,
                        overallComments: execution.overallComments,
                        fileMetadata: fileMetadata,
                        validCrossFileSuggestions:
                            execution.validCrossFileSuggestions,
                        tasks: execution.tasks,
                    };
                } catch (error) {
                    this.logProcessingError(
                        error,
                        organizationAndTeamData,
                        pullRequest,
                    );
                    return {
                        validSuggestions: [],
                        discardedSuggestions: [],
                        overallComments: [],
                        fileMetadata: new Map(),
                        validCrossFileSuggestions: [],
                        tasks: { ...context.tasks },
                    };
                }
            },
        );
    }

    /**
     * Logs processing errors
     * @param error The error that occurred
     * @param organizationAndTeamData Organization and team data
     * @param pullRequest Pull request data
     */
    private logProcessingError(
        error: any,
        organizationAndTeamData: OrganizationAndTeamData,
        pullRequest: { number: number },
    ): void {
        this.logger.error({
            message: `Error in batch file processing`,
            error,
            context: ProcessFilesReview.name,
            metadata: {
                organizationId: organizationAndTeamData.organizationId,
                teamId: organizationAndTeamData.teamId,
                pullRequestNumber: pullRequest.number,
            },
        });
    }

    private async runBatches(
        batches: FileChange[][],
        context: AnalysisContext,
        fileMetadata: Map<string, any>,
        validCrossFileSuggestions: CodeSuggestion[],
    ): Promise<{
        validSuggestions: Partial<CodeSuggestion>[];
        discardedSuggestions: Partial<CodeSuggestion>[];
        overallComments: { filepath: string; summary: string }[];
        validCrossFileSuggestions: CodeSuggestion[];
        tasks: AnalysisContext['tasks'];
    }> {
        const validSuggestions: Partial<CodeSuggestion>[] = [];
        const discardedSuggestions: Partial<CodeSuggestion>[] = [];
        const overallComments: { filepath: string; summary: string }[] = [];
        const tasks: AnalysisContext['tasks'] = {
            astAnalysis: {
                ...context.tasks.astAnalysis,
            },
        };

        await this.processBatchesSequentially(
            batches,
            context,
            validSuggestions,
            discardedSuggestions,
            overallComments,
            fileMetadata,
            validCrossFileSuggestions,
            tasks,
        );

        return {
            validSuggestions,
            discardedSuggestions,
            overallComments,
            validCrossFileSuggestions,
            tasks,
        };
    }

    /**
     * Creates optimized batches of files for parallel processing
     * @param files Array of files to be processed
     * @returns Array of file batches
     */
    private createOptimizedBatches(files: FileChange[]): FileChange[][] {
        const batches = createOptimizedBatches(files, {
            minBatchSize: 20,
            maxBatchSize: 30,
        });

        this.validateBatchIntegrity(batches, files.length);

        this.logger.log({
            message: `Processing ${files.length} files in ${batches.length} batches`,
            context: ProcessFilesReview.name,
        });

        return batches;
    }

    /**
     * Validates the integrity of the batches to ensure all files are processed
     * @param batches Batches created for processing
     * @param totalFileCount Original total number of files
     */
    private validateBatchIntegrity(
        batches: FileChange[][],
        totalFileCount: number,
    ): void {
        const totalFilesInBatches = batches.reduce(
            (sum, batch) => sum + batch.length,
            0,
        );
        if (totalFilesInBatches !== totalFileCount) {
            this.logger.warn({
                message: `Potential file processing mismatch! Total files: ${totalFileCount}, files in batches: ${totalFilesInBatches}`,
                context: ProcessFilesReview.name,
            });
            // Ensure all files are processed even in case of mismatch
            if (totalFilesInBatches < totalFileCount) {
                // If we identify that files might be missing, process all at once
                batches.length = 0;
                batches.push(Array.from({ length: totalFileCount }));
            }
        }
    }

    private async processBatchesSequentially(
        batches: FileChange[][],
        context: AnalysisContext,
        validSuggestionsToAnalyze: Partial<CodeSuggestion>[],
        discardedSuggestionsBySafeGuard: Partial<CodeSuggestion>[],
        overallComments: { filepath: string; summary: string }[],
        fileMetadata: Map<string, any>,
        validCrossFileSuggestions: CodeSuggestion[],
        tasks: AnalysisContext['tasks'],
    ): Promise<void> {
        for (const [index, batch] of batches.entries()) {
            this.logger.log({
                message: `Processing batch ${index + 1}/${batches.length} with ${batch.length} files`,
                context: ProcessFilesReview.name,
            });

            try {
                await this.processSingleBatch(
                    batch,
                    context,
                    validSuggestionsToAnalyze,
                    discardedSuggestionsBySafeGuard,
                    overallComments,
                    index,
                    fileMetadata,
                    tasks,
                );
            } catch (error) {
                this.logger.error({
                    message: `Error processing batch ${index + 1}`,
                    error,
                    context: ProcessFilesReview.name,
                    metadata: {
                        batchIndex: index,
                        batchSize: batch.length,
                        pullRequestNumber: context.pullRequest.number,
                    },
                });
                // Continuamos processando os próximos lotes mesmo se um falhar
            }
        }
    }

    private async processSingleBatch(
        batch: FileChange[],
        context: AnalysisContext,
        validSuggestions: Partial<CodeSuggestion>[],
        discardedSuggestions: Partial<CodeSuggestion>[],
        overallComments: { filepath: string; summary: string }[],
        batchIndex: number,
        fileMetadata: Map<string, any>,
        tasks: AnalysisContext['tasks'],
    ): Promise<void> {
        const { organizationAndTeamData, pullRequest } = context;
        const label = `processSingleBatch → Batch #${batchIndex + 1} (${batch.length} arquivos)`;

        await benchmark(
            { label, metadata: context.organizationAndTeamData },
            this.logger,
            async () => {
                // TESTAR
                const preparedFiles = await this.filterAndPrepareFiles(
                    batch,
                    context,
                );

                const astFailed = preparedFiles.find((file) => {
                    const task = file.fileContext.tasks?.astAnalysis;
                    return (
                        task && task.status !== TaskStatus.TASK_STATUS_COMPLETED
                    );
                });

                if (astFailed) {
                    tasks.astAnalysis.status =
                        astFailed?.fileContext?.tasks?.astAnalysis?.status ||
                        TaskStatus.TASK_STATUS_FAILED;
                }

                const results = await Promise.allSettled(
                    preparedFiles.map(({ fileContext }) =>
                        this.executeFileAnalysis(fileContext),
                    ),
                );

                results.forEach((result) => {
                    if (result.status === 'fulfilled') {
                        this.collectFileProcessingResult(
                            result.value,
                            validSuggestions,
                            discardedSuggestions,
                            overallComments,
                            fileMetadata,
                        );
                    } else {
                        this.logger.error({
                            message: `Error processing file in batch ${batchIndex + 1}`,
                            error: result.reason,
                            context: ProcessFilesReview.name,
                            metadata: {
                                organizationId:
                                    organizationAndTeamData.organizationId,
                                teamId: organizationAndTeamData.teamId,
                                pullRequestNumber: pullRequest.number,
                                batchIndex,
                            },
                        });
                    }
                });
            },
        );
    }

    /**
     * Collects and organizes the results of file processing
     * @param fileProcessingResult Result of the file processing
     * @param validSuggestionsToAnalyze Array to store the valid suggestions found
     * @param discardedSuggestionsBySafeGuard Array to store the discarded suggestions
     * @param overallComments Array to store the general comments
     * @param fileMetadata Map to store file metadata
     */
    private collectFileProcessingResult(
        fileProcessingResult: IFinalAnalysisResult & { file: FileChange },
        validSuggestionsToAnalyze: Partial<CodeSuggestion>[],
        discardedSuggestionsBySafeGuard: Partial<CodeSuggestion>[],
        overallComments: { filepath: string; summary: string }[],
        fileMetadata: Map<string, any>,
    ): void {
        const file = fileProcessingResult.file;

        if (fileProcessingResult?.validSuggestionsToAnalyze?.length > 0) {
            validSuggestionsToAnalyze.push(
                ...fileProcessingResult.validSuggestionsToAnalyze,
            );
        }

        if (fileProcessingResult?.discardedSuggestionsBySafeGuard?.length > 0) {
            discardedSuggestionsBySafeGuard.push(
                ...fileProcessingResult.discardedSuggestionsBySafeGuard,
            );
        }

        if (fileProcessingResult?.overallComment?.summary) {
            overallComments.push(fileProcessingResult.overallComment);
        }

        if (fileProcessingResult?.file?.filename) {
            fileMetadata.set(fileProcessingResult.file.filename, {
                reviewMode: fileProcessingResult.reviewMode,
                codeReviewModelUsed: fileProcessingResult.codeReviewModelUsed,
            });
        }
    }

    private async filterAndPrepareFiles(
        batch: FileChange[],
        context: AnalysisContext,
    ): Promise<Array<{ fileContext: AnalysisContext }>> {
        const limit = pLimit(this.concurrencyLimit);

        const settledResults = await Promise.allSettled(
            batch.map((file) =>
                limit(() =>
                    this.fileReviewContextPreparation.prepareFileContext(
                        file,
                        context,
                    ),
                ),
            ),
        );

        settledResults?.forEach((res, index) => {
            if (res.status === 'rejected') {
                this.logger.error({
                    message: `Error preparing the file "${batch[index]?.filename}" for analysis`,
                    error: res.reason,
                    context: ProcessFilesReview.name,
                    metadata: {
                        ...context.organizationAndTeamData,
                        pullRequestNumber: context.pullRequest.number,
                    },
                });
            }
        });

        return settledResults
            ?.filter(
                (
                    res,
                ): res is PromiseFulfilledResult<{
                    fileContext: AnalysisContext;
                }> => res.status === 'fulfilled' && res.value !== null,
            )
            ?.map((res) => res.value);
    }

    private async executeFileAnalysis(
        baseContext: AnalysisContext,
    ): Promise<IFinalAnalysisResult & { file: FileChange }> {
        const { reviewModeResponse } = baseContext;
        const { file, relevantContent, patchWithLinesStr } =
            baseContext.fileChangeContext;

        try {
            const context: AnalysisContext = {
                ...baseContext,
                reviewModeResponse: reviewModeResponse,
                fileChangeContext: { file, relevantContent, patchWithLinesStr },
            };

            const standardAnalysisResult =
                await this.codeAnalysisOrchestrator.executeStandardAnalysis(
                    context.organizationAndTeamData,
                    context.pullRequest.number,
                    { file, relevantContent, patchWithLinesStr },
                    reviewModeResponse,
                    context,
                );

            const finalResult = await this.processAnalysisResult(
                standardAnalysisResult,
                context,
            );

            return { ...finalResult, file };
        } catch (error) {
            this.logger.error({
                message: `Error analyzing file ${file.filename}`,
                error,
                context: ProcessFilesReview.name,
                metadata: {
                    filename: file.filename,
                    organizationId:
                        baseContext.organizationAndTeamData.organizationId,
                    teamId: baseContext.organizationAndTeamData.teamId,
                    pullRequestNumber: baseContext.pullRequest.number,
                },
            });

            return {
                validSuggestionsToAnalyze: [],
                discardedSuggestionsBySafeGuard: [],
                overallComment: { filepath: file.filename, summary: '' },
                file,
            };
        }
    }

    private async processAnalysisResult(
        result: AIAnalysisResult,
        context: AnalysisContext,
    ): Promise<IFinalAnalysisResult> {
        const { reviewModeResponse } = context;
        const { file, relevantContent, patchWithLinesStr } =
            context.fileChangeContext;

        const overallComment = {
            filepath: file.filename,
            summary: result?.overallSummary || '',
        };

        const validSuggestionsToAnalyze: Partial<CodeSuggestion>[] = [];
        const discardedSuggestionsBySafeGuard: Partial<CodeSuggestion>[] = [];
        let safeguardLLMProvider = '';

        if (
            result &&
            'codeSuggestions' in result &&
            Array.isArray(result.codeSuggestions) &&
            result.codeSuggestions.length > 0
        ) {
            const crossFileAnalysisSuggestions =
                context?.validCrossFileSuggestions || [];

            const validCrossFileSuggestions =
                crossFileAnalysisSuggestions?.filter(
                    (suggestion) => suggestion.relevantFile === file.filename,
                );

            const initialFilterResult = await this.initialFilterSuggestions(
                result,
                context,
                validCrossFileSuggestions,
                patchWithLinesStr,
            );

            const kodyFineTuningResult = await this.applyKodyFineTuningFilter(
                initialFilterResult.filteredSuggestions,
                context,
            );

            const discardedSuggestionsByCodeDiff =
                initialFilterResult.discardedSuggestionsByCodeDiff;
            const discardedSuggestionsByKodyFineTuning =
                kodyFineTuningResult.discardedSuggestionsByKodyFineTuning;
            const keepedSuggestions = kodyFineTuningResult.keepedSuggestions;

            // Separar sugestões cross-file das demais
            const crossFileIds = new Set(
                validCrossFileSuggestions?.map((suggestion) => suggestion.id),
            );

            const filteredCrossFileSuggestions = keepedSuggestions.filter(
                (suggestion) => crossFileIds?.has(suggestion.id),
            );

            const filteredKeepedSuggestions = keepedSuggestions.filter(
                (suggestion) => !crossFileIds?.has(suggestion.id),
            );

            // Aplicar safeguard apenas nas sugestões não cross-file
            const safeGuardResult = await this.applySafeguardFilter(
                filteredKeepedSuggestions,
                context,
                file,
                relevantContent,
                patchWithLinesStr,
                reviewModeResponse,
            );

            safeguardLLMProvider = safeGuardResult.safeguardLLMProvider;

            discardedSuggestionsBySafeGuard.push(
                ...safeGuardResult.allDiscardedSuggestions,
                ...discardedSuggestionsByCodeDiff,
                ...discardedSuggestionsByKodyFineTuning,
            );

            const suggestionsWithSeverity =
                await this.suggestionService.analyzeSuggestionsSeverity(
                    context?.organizationAndTeamData,
                    context?.pullRequest?.number,
                    safeGuardResult.safeguardSuggestions,
                    context?.codeReviewConfig?.reviewOptions,
                    context?.codeReviewConfig?.codeReviewVersion,
                );

            const crossFileSuggestionsWithSeverity =
                await this.suggestionService.analyzeSuggestionsSeverity(
                    context?.organizationAndTeamData,
                    context?.pullRequest?.number,
                    filteredCrossFileSuggestions,
                    context?.codeReviewConfig?.reviewOptions,
                );

            let mergedSuggestions = [];

            const kodyRulesSuggestions =
                await this.codeAnalysisOrchestrator.executeKodyRulesAnalysis(
                    context?.organizationAndTeamData,
                    context?.pullRequest?.number,
                    { file, patchWithLinesStr },
                    context,
                    {
                        overallSummary: result?.overallSummary,
                        codeSuggestions: suggestionsWithSeverity,
                    },
                );

            if (kodyRulesSuggestions?.codeSuggestions?.length > 0) {
                mergedSuggestions.push(...kodyRulesSuggestions.codeSuggestions);
            }

            // Se tem sugestões com severidade, adiciona também
            if (
                !kodyRulesSuggestions?.codeSuggestions?.length &&
                suggestionsWithSeverity?.length > 0
            ) {
                mergedSuggestions.push(...suggestionsWithSeverity);
            }

            const kodyASTSuggestions =
                await this.kodyAstAnalyzeContextPreparation.prepareKodyASTAnalyzeContext(
                    context,
                );

            // Garantir que as sugestões do AST tenham IDs
            const kodyASTSuggestionsWithId = await this.addSuggestionsId(
                kodyASTSuggestions?.codeSuggestions || [],
            );

            mergedSuggestions = [
                ...mergedSuggestions,
                ...kodyASTSuggestionsWithId,
                ...crossFileSuggestionsWithSeverity,
            ];

            const VALID_ACTIONS = [
                'synchronize',
                'update',
                'updated',
                'git.pullrequest.updated',
            ];

            // If it's a commit, validate repeated suggestions
            if (context?.action && VALID_ACTIONS.includes(context.action)) {
                const savedSuggestions =
                    await this.pullRequestService.findSuggestionsByPRAndFilename(
                        context?.pullRequest?.number,
                        context?.pullRequest?.base?.repo?.fullName,
                        file.filename,
                        context.organizationAndTeamData,
                    );

                if (savedSuggestions?.length > 0) {
                    const sentSuggestions = savedSuggestions.filter(
                        (suggestion) =>
                            suggestion.deliveryStatus === DeliveryStatus.SENT &&
                            suggestion.implementationStatus ===
                                ImplementationStatus.NOT_IMPLEMENTED,
                    );

                    if (mergedSuggestions?.length > 0) {
                        mergedSuggestions =
                            await this.suggestionService.removeSuggestionsRelatedToSavedFiles(
                                context?.organizationAndTeamData,
                                context?.pullRequest?.number.toString(),
                                savedSuggestions,
                                mergedSuggestions,
                            );
                    }

                    // We can only validate the implementation of suggestions that were sent
                    if (sentSuggestions.length > 0) {
                        await this.suggestionService.validateImplementedSuggestions(
                            context?.organizationAndTeamData,
                            file?.patch,
                            sentSuggestions,
                            context?.pullRequest?.number,
                        );
                    }
                }
            }

            if (mergedSuggestions?.length > 0) {
                await Promise.all(
                    mergedSuggestions.map(async (suggestion) => {
                        suggestion.rankScore =
                            await this.suggestionService.calculateSuggestionRankScore(
                                suggestion,
                            );
                    }),
                );
            }

            validSuggestionsToAnalyze.push(...mergedSuggestions);
        }

        return {
            validSuggestionsToAnalyze,
            discardedSuggestionsBySafeGuard:
                discardedSuggestionsBySafeGuard || [],
            overallComment,
            reviewMode: reviewModeResponse,
            codeReviewModelUsed: {
                generateSuggestions:
                    result?.codeReviewModelUsed?.generateSuggestions,
                safeguard: safeguardLLMProvider,
            },
        };
    }

    private async addSuggestionsId(suggestions: any[]): Promise<any[]> {
        return suggestions?.map((suggestion) => ({
            ...suggestion,
            id: suggestion?.id || uuidv4(),
        }));
    }

    private async initialFilterSuggestions(
        result: AIAnalysisResult,
        context: AnalysisContext,
        crossFileAnalysis: CodeSuggestion[],
        patchWithLinesStr: string,
    ): Promise<{
        filteredSuggestions: Partial<CodeSuggestion>[];
        discardedSuggestionsByCodeDiff: Partial<CodeSuggestion>[];
    }> {
        // Combinar sugestões regulares com cross-file suggestions
        const allSuggestions = [
            ...(result.codeSuggestions || []),
            ...crossFileAnalysis,
        ];

        // Adicionar IDs apenas uma vez, aqui
        const suggestionsWithId = await this.addSuggestionsId(allSuggestions);

        const combinedResult = {
            ...result,
            codeSuggestions: suggestionsWithId,
        };

        let filteredSuggestionsByOptions =
            this.suggestionService.filterCodeSuggestionsByReviewOptions(
                context?.codeReviewConfig?.reviewOptions,
                combinedResult,
            );

        const filterSuggestionsCodeDiff =
            await this.suggestionService.filterSuggestionsCodeDiff(
                patchWithLinesStr,
                filteredSuggestionsByOptions.codeSuggestions,
            );

        const discardedSuggestionsByCodeDiff =
            this.suggestionService.getDiscardedSuggestions(
                filteredSuggestionsByOptions.codeSuggestions,
                filterSuggestionsCodeDiff,
                PriorityStatus.DISCARDED_BY_CODE_DIFF,
            );

        return {
            filteredSuggestions: filterSuggestionsCodeDiff,
            discardedSuggestionsByCodeDiff,
        };
    }

    private async applyKodyFineTuningFilter(
        filteredSuggestions: any[],
        context: AnalysisContext,
    ): Promise<{
        keepedSuggestions: Partial<CodeSuggestion>[];
        discardedSuggestionsByKodyFineTuning: Partial<CodeSuggestion>[];
    }> {
        const getDataPipelineKodyFineTunning =
            await this.kodyFineTuningContextPreparation.prepareKodyFineTuningContext(
                context?.organizationAndTeamData.organizationId,
                context?.pullRequest?.number,
                {
                    id: context?.pullRequest?.repository?.id || '',
                    full_name: context?.pullRequest?.repository?.fullName || '',
                },
                filteredSuggestions,
                context?.codeReviewConfig?.kodyFineTuningConfig?.enabled,
                context?.clusterizedSuggestions,
            );

        const keepedSuggestions: Partial<CodeSuggestion>[] =
            getDataPipelineKodyFineTunning?.keepedSuggestions;

        const discardedSuggestions: Partial<CodeSuggestion>[] =
            getDataPipelineKodyFineTunning?.discardedSuggestions;

        const discardedSuggestionsByKodyFineTuning = discardedSuggestions.map(
            (suggestion) => {
                suggestion.priorityStatus =
                    PriorityStatus.DISCARDED_BY_KODY_FINE_TUNING;
                return suggestion;
            },
        );

        return {
            keepedSuggestions,
            discardedSuggestionsByKodyFineTuning,
        };
    }

    private async applySafeguardFilter(
        suggestions: Partial<CodeSuggestion>[],
        context: AnalysisContext,
        file: any,
        relevantContent,
        patchWithLinesStr: string,
        reviewModeResponse: any,
    ): Promise<{
        safeguardSuggestions: Partial<CodeSuggestion>[];
        allDiscardedSuggestions: Partial<CodeSuggestion>[];
        safeguardLLMProvider: string;
    }> {
        let filteredSuggestions = suggestions;
        let discardedSuggestionsBySeverity = [];

        if (
            context?.codeReviewConfig?.codeReviewVersion ===
            CodeReviewVersion.v2
        ) {
            const prioritizedSuggestions =
                await this.prioritizeSuggestionsBySeverityBeforeSafeGuard(
                    suggestions,
                    context,
                );

            filteredSuggestions = prioritizedSuggestions.filter(
                (suggestion) =>
                    suggestion.priorityStatus === PriorityStatus.PRIORITIZED,
            );

            discardedSuggestionsBySeverity = prioritizedSuggestions.filter(
                (suggestion) =>
                    suggestion.priorityStatus === PriorityStatus.DISCARDED_BY_SEVERITY,
            );
        }

        const safeGuardResponse =
            await this.suggestionService.filterSuggestionsSafeGuard(
                context?.organizationAndTeamData,
                context?.pullRequest?.number,
                file,
                relevantContent,
                patchWithLinesStr,
                filteredSuggestions,
                context?.codeReviewConfig?.languageResultPrompt,
                reviewModeResponse,
            );

        const safeguardLLMProvider =
            safeGuardResponse?.codeReviewModelUsed?.safeguard || '';

        const discardedSuggestionsBySafeGuard =
            this.suggestionService.getDiscardedSuggestions(
                filteredSuggestions,
                safeGuardResponse?.suggestions || [],
                PriorityStatus.DISCARDED_BY_SAFEGUARD,
            );

        const allDiscardedSuggestions = [
            ...discardedSuggestionsBySeverity,
            ...discardedSuggestionsBySafeGuard,
        ];

        return {
            safeguardSuggestions: safeGuardResponse?.suggestions || [],
            allDiscardedSuggestions,
            safeguardLLMProvider,
        };
    }

    private async prioritizeSuggestionsBySeverityBeforeSafeGuard(
        suggestions: Partial<CodeSuggestion>[],
        context: AnalysisContext,
    ): Promise<Partial<CodeSuggestion>[]> {
        const prioritizedSuggestions =
            await this.suggestionService.filterSuggestionsBySeverityLevel(
                suggestions,
                context?.codeReviewConfig?.suggestionControl
                    ?.severityLevelFilter,
                context?.organizationAndTeamData,
                context?.pullRequest?.number,
            );

        return prioritizedSuggestions;
    }

    private createAnalysisContextFromPipelineContext(
        context: CodeReviewPipelineContext,
    ): AnalysisContext {
        return {
            organizationAndTeamData: context.organizationAndTeamData,
            repository: context.repository,
            pullRequest: context.pullRequest,
            action: context.action,
            platformType: context.platformType,
            codeReviewConfig: context.codeReviewConfig,
            clusterizedSuggestions: context.clusterizedSuggestions,
            validCrossFileSuggestions:
                context.prAnalysisResults?.validCrossFileSuggestions || [],
            tasks: context.tasks,
        };
    }
}
