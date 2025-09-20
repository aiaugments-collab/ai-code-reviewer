/**
 * @license
 * Kodus Tech. All rights reserved.
 */
import { Injectable } from '@nestjs/common';
import { IPipelineStrategy } from '@/core/infrastructure/adapters/services/pipeline/interfaces/pipeline-strategy.interface';
import { PipelineStage } from '@/core/infrastructure/adapters/services/pipeline/interfaces/pipeline.interface';
import { ValidateConfigStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/validate-config.stage';
import { FetchChangedFilesStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/fetch-changed-files.stage';
import { InitialCommentStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/initial-comment.stage';
import { ProcessFilesReview } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/process-files-review.stage';
import { AggregateResultsStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/aggregate-result.stage';
import { UpdateCommentsAndGenerateSummaryStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/finish-comments.stage';
import { RequestChangesOrApproveStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/finish-process-review.stage';
import { CodeReviewPipelineContext } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/context/code-review-pipeline.context';
import { KodyFineTuningStage } from '../stages/kody-fine-tuning.stage';
import { CodeAnalysisASTStage } from '../stages/code-analysis-ast.stage';
import { ProcessFilesPrLevelReviewStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/process-files-pr-level-review.stage';
import { CreatePrLevelCommentsStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/create-pr-level-comments.stage';
import { CreateFileCommentsStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/create-file-comments.stage';
import { CodeAnalysisASTCleanupStage } from '../stages/code-analysis-ast-cleanup.stage';
import { ValidateNewCommitsStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/validate-new-commits.stage';
import { ResolveConfigStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/resolve-config.stage';

@Injectable()
export class CodeReviewPipelineStrategyEE
    implements IPipelineStrategy<CodeReviewPipelineContext>
{
    constructor(
        private readonly validateNewCommitsStage: ValidateNewCommitsStage,
        private readonly resolveConfigStage: ResolveConfigStage,
        private readonly validateConfigStage: ValidateConfigStage,
        private readonly fetchChangedFilesStage: FetchChangedFilesStage,
        private readonly initialCommentStage: InitialCommentStage,
        private readonly kodyFineTuningStage: KodyFineTuningStage,
        private readonly codeAnalysisASTStage: CodeAnalysisASTStage,
        private readonly processFilesPrLevelReviewStage: ProcessFilesPrLevelReviewStage,
        private readonly processFilesReview: ProcessFilesReview,
        private readonly createPrLevelCommentsStage: CreatePrLevelCommentsStage,
        private readonly createFileCommentsStage: CreateFileCommentsStage,
        private readonly codeAnalysisASTCleanupStage: CodeAnalysisASTCleanupStage,
        private readonly aggregateResultsStage: AggregateResultsStage,
        private readonly updateCommentsAndGenerateSummaryStage: UpdateCommentsAndGenerateSummaryStage,
        private readonly requestChangesOrApproveStage: RequestChangesOrApproveStage,
    ) {}

    getPipelineName(): string {
        return 'CodeReviewPipeline';
    }

    configureStages(): PipelineStage<CodeReviewPipelineContext>[] {
        return [
            this.validateNewCommitsStage,
            this.resolveConfigStage,
            this.validateConfigStage,
            this.fetchChangedFilesStage,
            this.initialCommentStage,
            this.kodyFineTuningStage,
            this.codeAnalysisASTStage,
            this.processFilesPrLevelReviewStage,
            this.processFilesReview,
            this.createPrLevelCommentsStage,
            this.createFileCommentsStage,
            this.codeAnalysisASTCleanupStage,
            this.aggregateResultsStage,
            this.updateCommentsAndGenerateSummaryStage,
            this.requestChangesOrApproveStage,
        ];
    }
}
