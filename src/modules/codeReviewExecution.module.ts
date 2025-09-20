import { UseCases } from '@/core/application/use-cases/codeReviewExecution';
import { CODE_REVIEW_EXECUTION_REPOSITORY } from '@/core/domain/codeReviewExecutions/contracts/codeReviewExecution.repository.contract';
import { CODE_REVIEW_EXECUTION_SERVICE } from '@/core/domain/codeReviewExecutions/contracts/codeReviewExecution.service.contract';
import { CodeReviewExecutionService } from '@/core/infrastructure/adapters/services/codeReviewExecution/codeReviewExecution.service';
import { forwardRef, Module } from '@nestjs/common';
import { PullRequestsModule } from './pullRequests.module';
import { CodeReviewExecutionRepository } from '@/core/infrastructure/adapters/repositories/typeorm/codeReviewExecution.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CodeReviewExecutionModel } from '@/core/infrastructure/adapters/repositories/typeorm/schema/codeReviewExecution.model';

@Module({
    imports: [
        TypeOrmModule.forFeature([CodeReviewExecutionModel]),
        forwardRef(() => PullRequestsModule),
    ],
    providers: [
        ...UseCases,
        {
            provide: CODE_REVIEW_EXECUTION_SERVICE,
            useClass: CodeReviewExecutionService,
        },
        {
            provide: CODE_REVIEW_EXECUTION_REPOSITORY,
            useClass: CodeReviewExecutionRepository,
        },
    ],
    exports: [
        ...UseCases,
        CODE_REVIEW_EXECUTION_SERVICE,
        CODE_REVIEW_EXECUTION_REPOSITORY,
    ],
    controllers: [],
})
export class CodeReviewExecutionModule {}
