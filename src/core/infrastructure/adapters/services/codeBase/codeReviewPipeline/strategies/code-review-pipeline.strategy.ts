/**
 * @license
 * Kodus Tech. All rights reserved.
 */
import { Injectable } from '@nestjs/common';
import { IPipelineStrategy } from '../../../pipeline/interfaces/pipeline-strategy.interface';
import { ValidateConfigStage } from '../stages/validate-config.stage';
import { FetchChangedFilesStage } from '../stages/fetch-changed-files.stage';
import { InitialCommentStage } from '../stages/initial-comment.stage';
import { ProcessFilesReview } from '../stages/process-files-review.stage';
import { AggregateResultsStage } from '../stages/aggregate-result.stage';
import { UpdateCommentsAndGenerateSummaryStage } from '../stages/finish-comments.stage';
import { RequestChangesOrApproveStage } from '../stages/finish-process-review.stage';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import { ProcessFilesPrLevelReviewStage } from '../stages/process-files-pr-level-review.stage';
import { CreatePrLevelCommentsStage } from '../stages/create-pr-level-comments.stage';
import { CreateFileCommentsStage } from '../stages/create-file-comments.stage';
import { ValidateNewCommitsStage } from '../stages/validate-new-commits.stage';
import { ResolveConfigStage } from '../stages/resolve-config.stage';

@Injectable()
export class CodeReviewPipelineStrategy
    implements IPipelineStrategy<CodeReviewPipelineContext>
{
    constructor(
        private readonly validateNewCommitsStage: ValidateNewCommitsStage,
        private readonly resolveConfigStage: ResolveConfigStage,
        private readonly validateConfigStage: ValidateConfigStage,
        private readonly fetchChangedFilesStage: FetchChangedFilesStage,
        private readonly initialCommentStage: InitialCommentStage,
        private readonly processFilesPrLevelReviewStage: ProcessFilesPrLevelReviewStage,
        private readonly processFilesReview: ProcessFilesReview,
        private readonly createPrLevelCommentsStage: CreatePrLevelCommentsStage,
        private readonly createFileCommentsStage: CreateFileCommentsStage,
        private readonly aggregateResultsStage: AggregateResultsStage,
        private readonly updateCommentsAndGenerateSummaryStage: UpdateCommentsAndGenerateSummaryStage,
        private readonly requestChangesOrApproveStage: RequestChangesOrApproveStage,
    ) {}

    configureStages(): BasePipelineStage<CodeReviewPipelineContext>[] {
        return [
            this.validateNewCommitsStage,
            this.resolveConfigStage,
            this.validateConfigStage,
            this.fetchChangedFilesStage,
            this.initialCommentStage,
            this.processFilesPrLevelReviewStage,
            this.processFilesReview,
            this.createPrLevelCommentsStage,
            this.createFileCommentsStage,
            this.aggregateResultsStage,
            this.updateCommentsAndGenerateSummaryStage,
            this.requestChangesOrApproveStage,
        ];
    }

    getPipelineName(): string {
        return 'CodeReviewPipeline';
    }
}
