/**
 * @license
 * © Kodus Tech. All rights reserved.
 */
import { Module, forwardRef } from '@nestjs/common';
import { PipelineExecutor } from '@/core/infrastructure/adapters/services/pipeline/pipeline-executor.service';

import { ValidateConfigStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/validate-config.stage';
import { FetchChangedFilesStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/fetch-changed-files.stage';
import { InitialCommentStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/initial-comment.stage';
import { BatchCreationStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/create-batch.stage';
import { ProcessFilesReview } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/process-files-review.stage';
import { AggregateResultsStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/aggregate-result.stage';
import { UpdateCommentsAndGenerateSummaryStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/finish-comments.stage';
import { RequestChangesOrApproveStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/finish-process-review.stage';

import { ParametersModule } from './parameters.module';
import { PlatformIntegrationModule } from './platformIntegration.module';
import { AutomationModule } from './automation.module';
import { PullRequestsModule } from './pullRequests.module';
import { KodyRulesModule } from './kodyRules.module';
import { SuggestionEmbeddedModule } from './suggestionEmbedded.module';
import { OrganizationParametersModule } from './organizationParameters.module';
import { FileReviewModule } from '@/ee/codeReview/fileReviewContextPreparation/fileReview.module';
import { CodebaseModule } from './codeBase.module';
import { CodeReviewPipelineStrategy } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/strategies/code-review-pipeline.strategy';
import { CodeReviewPipelineStrategyEE } from '@/ee/codeReview/strategies/code-review-pipeline.strategy.ee';
import { KodyFineTuningStage } from '@/ee/codeReview/stages/kody-fine-tuning.stage';
import { CodeAnalysisASTStage } from '@/ee/codeReview/stages/code-analysis-ast.stage';
import { KodyFineTuningContextModule } from '@/ee/kodyFineTuning/fineTuningContext/kodyFineTuningContext.module';
import { KodyASTAnalyzeContextModule } from '@/ee/kodyASTAnalyze/kodyAstAnalyzeContext.module';
import { ProcessFilesPrLevelReviewStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/process-files-pr-level-review.stage';
import { CreatePrLevelCommentsStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/create-pr-level-comments.stage';
import { CreateFileCommentsStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/create-file-comments.stage';
import { CodeAnalysisASTCleanupStage } from '@/ee/codeReview/stages/code-analysis-ast-cleanup.stage';
import { TeamAutomationModule } from './teamAutomation.module';
import { PullRequestMessagesModule } from './pullRequestMessages.module';
import { ValidateNewCommitsStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/validate-new-commits.stage';
import { ResolveConfigStage } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/stages/resolve-config.stage';

@Module({
    imports: [
        forwardRef(() => CodebaseModule),
        forwardRef(() => ParametersModule),
        forwardRef(() => PlatformIntegrationModule),
        forwardRef(() => AutomationModule),
        forwardRef(() => TeamAutomationModule),
        forwardRef(() => PullRequestsModule),
        forwardRef(() => KodyRulesModule),
        forwardRef(() => SuggestionEmbeddedModule),
        forwardRef(() => OrganizationParametersModule),
        forwardRef(() => FileReviewModule),
        forwardRef(() => KodyFineTuningContextModule),
        forwardRef(() => KodyASTAnalyzeContextModule),
        forwardRef(() => PullRequestMessagesModule),
    ],
    providers: [
        PipelineExecutor,
        CodeReviewPipelineStrategy,
        CodeReviewPipelineStrategyEE,
        // Stages
        ValidateConfigStage,
        ValidateNewCommitsStage,
        ResolveConfigStage,
        FetchChangedFilesStage,
        InitialCommentStage,
        BatchCreationStage,
        ProcessFilesReview,
        ProcessFilesPrLevelReviewStage,
        CreatePrLevelCommentsStage,
        CreateFileCommentsStage,
        AggregateResultsStage,
        UpdateCommentsAndGenerateSummaryStage,
        RequestChangesOrApproveStage,
        KodyFineTuningStage,
        CodeAnalysisASTStage,
        CodeAnalysisASTCleanupStage,
    ],
    exports: [
        PipelineExecutor,
        ValidateConfigStage,
        ResolveConfigStage,
        FetchChangedFilesStage,
        InitialCommentStage,
        BatchCreationStage,
        ProcessFilesReview,
        ProcessFilesPrLevelReviewStage,
        CreatePrLevelCommentsStage,
        CreateFileCommentsStage,
        KodyFineTuningStage,
        CodeAnalysisASTStage,
        CodeAnalysisASTCleanupStage,
        AggregateResultsStage,
        UpdateCommentsAndGenerateSummaryStage,
        RequestChangesOrApproveStage,
        CodeReviewPipelineStrategy,
        CodeReviewPipelineStrategyEE,
    ],
})
export class CodeReviewPipelineModule {}
