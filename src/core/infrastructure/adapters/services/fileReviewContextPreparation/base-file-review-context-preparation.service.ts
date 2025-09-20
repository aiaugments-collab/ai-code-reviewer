/**
 * @license
 * © Kodus Tech. All rights reserved.
 */

import { Injectable } from '@nestjs/common';
import { clone } from 'ramda';
import {
    IFileReviewContextPreparation,
    ReviewModeOptions,
} from '@/shared/interfaces/file-review-context-preparation.interface';
import {
    AnalysisContext,
    FileChange,
    ReviewModeResponse,
} from '@/config/types/general/codeReview.type';
import { PinoLoggerService } from '../logger/pino.service';
import {
    convertToHunksWithLinesNumbers,
    handlePatchDeletions,
} from '@/shared/utils/patch';
import { TaskStatus } from '@kodus/kodus-proto/task';

/**
 * Abstract base class for file review context preparation
 * Implements the Template Method pattern to define the overall preparation flow
 * and allow subclasses to customize specific behaviors
 */
@Injectable()
export abstract class BaseFileReviewContextPreparation
    implements IFileReviewContextPreparation
{
    constructor(protected readonly logger: PinoLoggerService) {}

    /**
     * Prepares the context for analyzing a file
     * @param file File to be analyzed
     * @param context Analysis context
     * @returns Prepared file context or null if the file does not have a patch
     */
    async prepareFileContext(
        file: FileChange,
        context: AnalysisContext,
    ): Promise<{ fileContext: AnalysisContext } | null> {
        try {
            if (!file?.patch) {
                return null;
            }

            let patchWithLinesStr = file?.patchWithLinesStr || '';

            if (!patchWithLinesStr) {
                const patchFormatted = handlePatchDeletions(
                    file.patch,
                    file.filename,
                    file.status,
                );
                if (!patchFormatted) {
                    return null;
                }

                patchWithLinesStr = convertToHunksWithLinesNumbers(
                    patchFormatted,
                    file,
                );
            }

            return await this.prepareFileContextInternal(
                file,
                patchWithLinesStr,
                context,
            );
        } catch (error) {
            this.logger.error({
                message: 'Error while preparing file context',
                error,
                context: BaseFileReviewContextPreparation.name,
                metadata: {
                    ...context?.organizationAndTeamData,
                    pullRequestNumber: context.pullRequest.number,
                },
            });
            return null;
        }
    }

    /**
     * Abstract method to determine the review mode
     * Must be implemented by subclasses
     * @param file File to be analyzed
     * @param patch File patch
     * @param context Analysis context
     * @returns Determined review mode
     */
    protected abstract determineReviewMode(
        options?: ReviewModeOptions,
    ): Promise<ReviewModeResponse>;

    /**
     * Prepares the internal file context
     * Can be overridden by subclasses to add specific behaviors
     * @param file File to be analyzed
     * @param patchWithLinesStr Patch with line numbers
     * @param reviewMode Determined review mode
     * @param context Analysis context
     * @returns Prepared file context
     */
    protected async prepareFileContextInternal(
        file: FileChange,
        patchWithLinesStr: string,
        context: AnalysisContext,
    ): Promise<{ fileContext: AnalysisContext } | null> {
        const reviewModeProm = this.determineReviewMode({
            fileChangeContext: {
                file,
            },
            patch: patchWithLinesStr,
            context,
        });

        const relevantContentProm = this.getRelevantFileContent(file, context);

        const [reviewModeResponse, { relevantContent, taskStatus }] =
            await Promise.all([reviewModeProm, relevantContentProm]);

        const updatedContext: AnalysisContext = {
            ...context,
            reviewModeResponse,
            fileChangeContext: {
                file,
                relevantContent,
                patchWithLinesStr,
            },
            tasks: {
                ...context?.tasks,
                astAnalysis: {
                    ...context?.tasks?.astAnalysis,
                    status: taskStatus || TaskStatus.TASK_STATUS_FAILED,
                },
            },
        };

        return { fileContext: updatedContext };
    }

    protected abstract getRelevantFileContent(
        file: FileChange,
        context: AnalysisContext,
    ): Promise<{ relevantContent: string | null; taskStatus?: TaskStatus }>;
}
