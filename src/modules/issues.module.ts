import { IssuesSchema } from "@/core/infrastructure/adapters/repositories/mongoose/schema/issues.model";
import { IssuesModel } from '@/core/infrastructure/adapters/repositories/mongoose/schema/issues.model';
import { KodyIssuesAnalysisService } from "@/ee/codeBase/kodyIssuesAnalysis.service";
import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PullRequestsModule } from "./pullRequests.module";
import { ISSUES_REPOSITORY_TOKEN } from "@/core/domain/issues/contracts/issues.repository";
import { IssuesRepository } from "@/core/infrastructure/adapters/repositories/mongoose/issues.repository";
import { ISSUES_SERVICE_TOKEN } from "@/core/domain/issues/contracts/issues.service.contract";
import { IssuesService } from "@/core/infrastructure/adapters/services/issues/issues.service";
import { KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN } from "@/core/domain/codeBase/contracts/KodyIssuesManagement.contract";
import { KodyIssuesManagementService } from "@/ee/kodyIssuesManagement/service/kodyIssuesManagement.service";
import { KODY_ISSUES_ANALYSIS_SERVICE_TOKEN } from "@/ee/codeBase/kodyIssuesAnalysis.service";
import { IssuesController } from "@/core/infrastructure/http/controllers/issues.controller";
import { UpdateIssuePropertyUseCase } from "@/core/application/use-cases/issues/update-issue-property.use-case";
import { GetIssuesByFiltersUseCase } from "@/core/application/use-cases/issues/get-issues-by-filters.use-case";
import { IntegrationConfigModule } from "./integrationConfig.module";
import { ParametersModule } from "./parameters.module";
import { GetTotalIssuesUseCase } from "@/core/application/use-cases/issues/get-total-issues.use-case";
import { CodeReviewFeedbackModule } from "./codeReviewFeedback.module";
import { GetIssueByIdUseCase } from "@/core/application/use-cases/issues/get-issue-by-id.use-case";
import { GenerateIssuesFromPrClosedUseCase } from "@/core/application/use-cases/issues/generate-issues-from-pr-closed.use-case";
import { CodebaseModule } from "./codeBase.module";
import { GlobalCacheModule } from "./cache.module";
import { GetIssuesUseCase } from "@/core/application/use-cases/issues/get-issues.use-case";

const UseCases = [
    GetIssuesByFiltersUseCase,
    UpdateIssuePropertyUseCase,
    GenerateIssuesFromPrClosedUseCase,
    GetTotalIssuesUseCase,
    GetIssuesUseCase,
    GetIssueByIdUseCase,
] as const;

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: IssuesModel.name,
                schema: IssuesSchema,
            },
        ]),
        forwardRef(() => PullRequestsModule),
        forwardRef(() => IntegrationConfigModule),
        forwardRef(() => ParametersModule),
        forwardRef(() => CodeReviewFeedbackModule),
        forwardRef(() => CodebaseModule),
        GlobalCacheModule,
    ],
    providers: [
        ...UseCases,
        {
            provide: ISSUES_REPOSITORY_TOKEN,
            useClass: IssuesRepository,
        },
        {
            provide: ISSUES_SERVICE_TOKEN,
            useClass: IssuesService,
        },
        {
            provide: KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN,
            useClass: KodyIssuesManagementService,
        },
        {
            provide: KODY_ISSUES_ANALYSIS_SERVICE_TOKEN,
            useClass: KodyIssuesAnalysisService,
        },
    ],
    controllers: [IssuesController],
    exports: [
        ISSUES_REPOSITORY_TOKEN,
        ISSUES_SERVICE_TOKEN,
        KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN,
        KODY_ISSUES_ANALYSIS_SERVICE_TOKEN,
        ...UseCases,
    ],
})
export class IssuesModule {}
