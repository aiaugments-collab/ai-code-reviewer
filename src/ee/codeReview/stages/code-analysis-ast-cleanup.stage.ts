import { Injectable, Inject } from '@nestjs/common';
import {
    AST_ANALYSIS_SERVICE_TOKEN,
    IASTAnalysisService,
} from '@/core/domain/codeBase/contracts/ASTAnalysisService.contract';
import { BasePipelineStage } from '@/core/infrastructure/adapters/services/pipeline/base-stage.abstract';
import { CodeReviewPipelineContext } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/context/code-review-pipeline.context';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';

const ENABLE_CODE_REVIEW_AST =
    process.env.API_ENABLE_CODE_REVIEW_AST === 'true';

@Injectable()
export class CodeAnalysisASTCleanupStage extends BasePipelineStage<CodeReviewPipelineContext> {
    stageName = 'CodeAnalysisASTCleanupStage';

    constructor(
        @Inject(AST_ANALYSIS_SERVICE_TOKEN)
        private readonly codeASTAnalysisService: IASTAnalysisService,

        private readonly logger: PinoLoggerService,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        if (
            !ENABLE_CODE_REVIEW_AST ||
            !context.codeReviewConfig.reviewOptions?.breaking_changes
        ) {
            return context;
        }

        try {
            await this.codeASTAnalysisService.deleteASTAnalysis(
                context.repository,
                context.pullRequest,
                context.platformType,
                context.organizationAndTeamData,
            );

            return context;
        } catch (error) {
            this.logger.error({
                message: 'Error during AST analysis cleanup',
                error,
                context: this.stageName,
                metadata: {
                    ...context.organizationAndTeamData,
                    pullRequestNumber: context.pullRequest.number,
                },
            });
            return context;
        }
    }
}
