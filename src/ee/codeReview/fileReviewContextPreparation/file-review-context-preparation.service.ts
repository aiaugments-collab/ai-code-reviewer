/**
 * @license
 * © Kodus Tech. All rights reserved.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
    AnalysisContext,
    FileChange,
    ReviewModeConfig,
    ReviewModeResponse,
} from '@/config/types/general/codeReview.type';
import {
    AST_ANALYSIS_SERVICE_TOKEN,
    IASTAnalysisService,
} from '@/core/domain/codeBase/contracts/ASTAnalysisService.contract';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { BaseFileReviewContextPreparation } from '@/core/infrastructure/adapters/services/fileReviewContextPreparation/base-file-review-context-preparation.service';
import { ReviewModeOptions } from '@/shared/interfaces/file-review-context-preparation.interface';
import { IAIAnalysisService } from '@/core/domain/codeBase/contracts/AIAnalysisService.contract';
import { LLM_ANALYSIS_SERVICE_TOKEN } from '@/core/infrastructure/adapters/services/codeBase/llmAnalysis.service';
import { TaskStatus } from '@kodus/kodus-proto/task';
import { LLMModelProvider } from '@kodus/kodus-common/llm';

/**
 * Enterprise (cloud) implementation of the file review context preparation service
 * Extends the base class and overrides methods to add advanced functionalities
 * Available only in the cloud version or with an enterprise license
 */
@Injectable()
export class FileReviewContextPreparation extends BaseFileReviewContextPreparation {
    constructor(
        @Inject(AST_ANALYSIS_SERVICE_TOKEN)
        private readonly astService: IASTAnalysisService,

        @Inject(LLM_ANALYSIS_SERVICE_TOKEN)
        private readonly aiAnalysisService: IAIAnalysisService,

        protected readonly logger: PinoLoggerService,
    ) {
        super(logger);
    }

    /**
     * Overrides the method for determining the review mode to use advanced logic
     * @param file File to be analyzed
     * @param patch File patch
     * @param context Analysis context
     * @returns Determined review mode
     * @override
     */
    protected async determineReviewMode(
        options?: ReviewModeOptions,
    ): Promise<ReviewModeResponse> {
        try {
            const { context } = options;

            let reviewMode = ReviewModeResponse.HEAVY_MODE;

            const shouldCheckMode =
                context?.codeReviewConfig?.reviewModeConfig ===
                    ReviewModeConfig.LIGHT_MODE_FULL ||
                context?.codeReviewConfig?.reviewModeConfig ===
                    ReviewModeConfig.LIGHT_MODE_PARTIAL;

            if (shouldCheckMode) {
                reviewMode = await this.getReviewMode(options);
            }

            return reviewMode;
        } catch (error) {
            this.logger.warn({
                message:
                    'Error determining advanced review mode, falling back to basic mode',
                error,
                context: FileReviewContextPreparation.name,
            });

            // In case of an error, we call the parent class method (basic implementation)
            // However, since BaseFileReviewContextPreparation is now abstract, we need to implement a fallback here
            return ReviewModeResponse.HEAVY_MODE;
        }
    }

    /**
     * Overrides the method for preparing the internal context to add AST analysis
     * @param file File to be analyzed
     * @param patchWithLinesStr Patch with line numbers
     * @param reviewMode Determined review mode
     * @param context Analysis context
     * @returns Prepared file context with AST analysis
     * @override
     */
    protected async prepareFileContextInternal(
        file: FileChange,
        patchWithLinesStr: string,
        context: AnalysisContext,
    ): Promise<{ fileContext: AnalysisContext } | null> {
        const baseContext = await super.prepareFileContextInternal(
            file,
            patchWithLinesStr,
            context,
        );

        if (!baseContext) {
            return null;
        }

        let fileContext: AnalysisContext = baseContext.fileContext;

        const isHeavyMode =
            fileContext.reviewModeResponse === ReviewModeResponse.HEAVY_MODE;

        const hasASTAnalysisTask =
            fileContext.tasks.astAnalysis.taskId &&
            fileContext.tasks.astAnalysis.status !==
                TaskStatus.TASK_STATUS_FAILED &&
            fileContext.tasks.astAnalysis.status !==
                TaskStatus.TASK_STATUS_CANCELLED;

        const hasEnabledBreakingChanges =
            fileContext.codeReviewConfig.reviewOptions?.breaking_changes;

        // Check if we should execute the AST analysis
        const shouldRunAST =
            isHeavyMode && hasASTAnalysisTask && hasEnabledBreakingChanges;

        if (shouldRunAST) {
            try {
                const astTaskRes = await this.astService.awaitTask(
                    fileContext.tasks.astAnalysis.taskId,
                    fileContext.organizationAndTeamData,
                    {
                        timeout: 600000, // 10 minutes
                    },
                );

                if (
                    !astTaskRes ||
                    astTaskRes?.task?.status !==
                        TaskStatus.TASK_STATUS_COMPLETED
                ) {
                    this.logger.warn({
                        message:
                            'AST analysis task did not complete successfully',
                        context: FileReviewContextPreparation.name,
                        metadata: {
                            ...fileContext?.organizationAndTeamData,
                            filename: file.filename,
                        },
                    });

                    return {
                        fileContext: this.updateContextWithTaskStatus(
                            fileContext,
                            astTaskRes?.task?.status ||
                                TaskStatus.TASK_STATUS_FAILED,
                            'astAnalysis',
                        ),
                    };
                }

                fileContext = this.updateContextWithTaskStatus(
                    fileContext,
                    astTaskRes?.task?.status,
                    'astAnalysis',
                );

                const { taskId } =
                    await this.astService.initializeImpactAnalysis(
                        fileContext.repository,
                        fileContext.pullRequest,
                        fileContext.platformType,
                        fileContext.organizationAndTeamData,
                        patchWithLinesStr,
                        file.filename,
                    );

                const impactTaskRes = await this.astService.awaitTask(
                    taskId,
                    fileContext.organizationAndTeamData,
                    {
                        timeout: 600000, // 10 minutes
                    },
                );

                if (
                    !impactTaskRes ||
                    impactTaskRes?.task?.status !==
                        TaskStatus.TASK_STATUS_COMPLETED
                ) {
                    this.logger.warn({
                        message:
                            'Impact analysis task did not complete successfully',
                        context: FileReviewContextPreparation.name,
                        metadata: {
                            ...fileContext?.organizationAndTeamData,
                            filename: file.filename,
                        },
                    });
                    return { fileContext };
                }

                const impactAnalysis = await this.astService.getImpactAnalysis(
                    fileContext.repository,
                    fileContext.pullRequest,
                    fileContext.platformType,
                    fileContext.organizationAndTeamData,
                );

                // Creates a new context by combining the fileContext with the AST analysis
                fileContext = {
                    ...fileContext,
                    impactASTAnalysis: impactAnalysis,
                };
            } catch (error) {
                this.logger.error({
                    message: 'Error executing advanced AST analysis',
                    error,
                    context: FileReviewContextPreparation.name,
                    metadata: {
                        ...context?.organizationAndTeamData,
                        filename: file.filename,
                    },
                });
            }
        }

        return { fileContext };
    }

    private async getReviewMode(
        options: ReviewModeOptions,
    ): Promise<ReviewModeResponse> {
        const response = await this.aiAnalysisService.selectReviewMode(
            options.context.organizationAndTeamData,
            options.context.pullRequest.number,
            LLMModelProvider.NOVITA_DEEPSEEK_V3_0324,
            options.fileChangeContext.file,
            options.patch,
        );

        return response;
    }

    protected async getRelevantFileContent(
        file: FileChange,
        context: AnalysisContext,
    ): Promise<{ relevantContent: string | null; taskStatus?: TaskStatus }> {
        try {
            const { taskId } = context.tasks.astAnalysis;

            if (!taskId) {
                this.logger.warn({
                    message:
                        'No AST analysis task ID found, returning file content',
                    context: FileReviewContextPreparation.name,
                    metadata: {
                        ...context?.organizationAndTeamData,
                        filename: file.filename,
                    },
                });

                return {
                    relevantContent: file.fileContent || file.content || null,
                    taskStatus: TaskStatus.TASK_STATUS_FAILED,
                };
            }

            const taskRes = await this.astService.awaitTask(
                taskId,
                context.organizationAndTeamData,
                {
                    timeout: 600000, // 10 minutes
                },
            );

            if (
                !taskRes ||
                taskRes?.task?.status !== TaskStatus.TASK_STATUS_COMPLETED
            ) {
                this.logger.warn({
                    message: 'AST analysis task did not complete successfully',
                    context: FileReviewContextPreparation.name,
                    metadata: {
                        ...context?.organizationAndTeamData,
                        filename: file.filename,
                    },
                });

                return {
                    relevantContent: file.fileContent || file.content || null,
                    taskStatus:
                        taskRes?.task?.status || TaskStatus.TASK_STATUS_FAILED,
                };
            }

            const content = await this.astService.getRelatedContentFromDiff(
                context.repository,
                context.pullRequest,
                context.platformType,
                context.organizationAndTeamData,
                file.patch,
                file.filename,
            );

            if (content) {
                return {
                    relevantContent: content,
                    taskStatus: taskRes?.task?.status,
                };
            } else {
                this.logger.warn({
                    message: 'No relevant content found for the file',
                    context: FileReviewContextPreparation.name,
                    metadata: {
                        ...context?.organizationAndTeamData,
                        filename: file.filename,
                    },
                });
                return {
                    relevantContent: file.fileContent || file.content || null,
                    taskStatus: taskRes?.task?.status,
                };
            }
        } catch (error) {
            this.logger.error({
                message: 'Error retrieving relevant file content',
                error,
                context: FileReviewContextPreparation.name,
                metadata: {
                    ...context?.organizationAndTeamData,
                    filename: file.filename,
                },
            });
            return {
                relevantContent: file.fileContent || file.content || null,
            };
        }
    }

    private updateContextWithTaskStatus(
        context: AnalysisContext,
        taskStatus: TaskStatus,
        type: keyof AnalysisContext['tasks'],
    ): AnalysisContext {
        return {
            ...context,
            tasks: {
                ...context.tasks,
                [type]: {
                    ...context.tasks[type],
                    status: taskStatus,
                },
            },
        };
    }
}
