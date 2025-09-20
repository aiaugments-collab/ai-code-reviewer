import { CreateIntegrationUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/create-integration.use-case';
import { CreateRepositoriesUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/create-repositories';
import { GetCodeManagementMemberListUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/get-code-management-members-list.use-case';
import { GetRepositoriesUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/get-repositories';
import { VerifyConnectionUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/verify-connection.use-case';
import { Repository } from '@/core/domain/integrationConfigs/types/codeManagement/repositories.type';
import {
    Body,
    Controller,
    Delete,
    Get,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { TeamQueryDto } from '../../dtos/teamId-query-dto';
import { GetOrganizationUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/get-organizations.use-case';
import { SaveCodeConfigUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/save-config.use-case';
import { SavePatTokenConfigUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/savePatTokenUseCase';
import { GetPatTokenUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/getPatTokenUseCase';
import { GetWorkflowsUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/get-workflows-use-case';
import { GetPRsUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/get-prs.use-case';
import { CreatePRCodeReviewUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/create-prs-code-review.use-case';
import { GetCodeReviewStartedUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/get-code-review-started.use-case';
import { FinishOnboardingDTO } from '../../dtos/finish-onboarding.dto';
import { FinishOnboardingUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/finish-onboarding.use-case';
import { DeleteIntegrationUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/delete-integration.use-case';
import { DeleteIntegrationAndRepositoriesUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/delete-integration-and-repositories.use-case';
import { GetRepositoryTreeUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/get-repository-tree.use-case';
import { GetRepositoryTreeDto } from '../../dtos/get-repository-tree.dto';
import {
    CheckPolicies,
    PolicyGuard,
} from '@/core/infrastructure/adapters/services/permissions/policy.guard';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import {
    checkPermissions,
    checkRepoPermissions,
} from '@/core/infrastructure/adapters/services/permissions/policy.handlers';

@Controller('code-management')
export class CodeManagementController {
    constructor(
        private readonly getCodeManagementMemberListUseCase: GetCodeManagementMemberListUseCase,
        private readonly createIntegrationUseCase: CreateIntegrationUseCase,
        private readonly verifyConnectionUseCase: VerifyConnectionUseCase,
        private readonly createRepositoriesUseCase: CreateRepositoriesUseCase,
        private readonly getRepositoriesUseCase: GetRepositoriesUseCase,
        private readonly getOrganizationUseCase: GetOrganizationUseCase,
        private readonly saveCodeConfigUseCase: SaveCodeConfigUseCase,
        private readonly savePatTokenConfigUseCase: SavePatTokenConfigUseCase,
        private readonly getPatTokenUseCase: GetPatTokenUseCase,
        private readonly getWorkflowsUseCase: GetWorkflowsUseCase,
        private readonly getPRsUseCase: GetPRsUseCase,
        private readonly createPRCodeReviewUseCase: CreatePRCodeReviewUseCase,
        private readonly getCodeReviewStartedUseCase: GetCodeReviewStartedUseCase,
        private readonly finishOnboardingUseCase: FinishOnboardingUseCase,
        private readonly deleteIntegrationUseCase: DeleteIntegrationUseCase,
        private readonly deleteIntegrationAndRepositoriesUseCase: DeleteIntegrationAndRepositoriesUseCase,
        private readonly getRepositoryTreeUseCase: GetRepositoryTreeUseCase,
    ) {}

    @Get('/repositories/org')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.CodeReviewSettings),
    )
    public async getRepositories(
        @Query()
        query: {
            teamId: string;
            organizationSelected: any;
            isSelected?: boolean;
        },
    ) {
        return this.getRepositoriesUseCase.execute(query);
    }

    // TODO: remove, unused
    @Get('/verify')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async verifyConnection(@Query() query: TeamQueryDto) {
        return this.verifyConnectionUseCase.execute(query.teamId);
    }

    @Post('/auth-integration')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async authIntegrationToken(@Body() body: any) {
        return this.createIntegrationUseCase.execute(body);
    }

    // TODO: remove, unused
    // METHOD USED ONLY AZURE REPOS
    @Post('/create-auth-integration')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async createIntegrationToken(@Body() body: any) {
        return this.createIntegrationUseCase.execute(body);
    }

    @Post('/repositories')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Create, ResourceType.CodeReviewSettings),
    )
    public async createRepositories(
        @Body() body: { repositories: Repository[]; teamId: string },
    ) {
        return this.createRepositoriesUseCase.execute(body);
    }

    // TODO: remove, unused
    @Get('/list-members')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.UserSettings))
    public async getListMembers() {
        return this.getCodeManagementMemberListUseCase.execute();
    }

    // TODO: remove, unused
    @Get('/organizations')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getOrganizations() {
        return this.getOrganizationUseCase.execute();
    }

    // TODO: remove, unused
    @Post('config')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async saveSetupConfig(
        @Body()
        body: {
            organizationSelected: any;
            teamId: string;
        },
    ) {
        await this.saveCodeConfigUseCase.execute(body);
    }

    // TODO: remove, unused
    @Post('/save-personal-token')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async savePersonalToken(
        @Body()
        body: {
            token: string;
            teamId: string;
        },
    ) {
        return await this.savePatTokenConfigUseCase.execute({
            token: body.token,
            teamId: body.teamId,
        });
    }

    // TODO: remove, unused
    @Get('/get-personal-token')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getPatToken(@Query() query: { teamId: string }) {
        return this.getPatTokenUseCase.execute({ teamId: query.teamId });
    }

    // TODO: remove, unused
    @Get('/get-workflows')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getWorkflows(@Query() query: { teamId: string }) {
        return this.getWorkflowsUseCase.execute({ teamId: query.teamId });
    }

    @Get('/get-prs')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.PullRequests))
    public async getPRs(
        @Query()
        query: {
            teamId: string;
            number?: number;
            title: string;
            url?: string;
        },
    ) {
        return await this.getPRsUseCase.execute({
            teamId: query.teamId,
            number: query.number,
            title: query.title,
            url: query.url,
        });
    }

    // TODO: remove, unused
    @Get('/get-code-review-started')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.PullRequests))
    public async GetCodeReviewStarted(@Query() query: { teamId: string }) {
        return await this.getCodeReviewStartedUseCase.execute({
            teamId: query.teamId,
        });
    }

    // TODO: remove, unused
    @Post('/review-pr')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkRepoPermissions(Action.Create, ResourceType.PullRequests, {
            key: { body: 'payload.id' },
        }),
    )
    public async reviewPR(
        @Body()
        body: {
            teamId: string;
            payload: {
                id: number;
                repository: string;
                pull_number: number;
            };
        },
    ) {
        return await this.createPRCodeReviewUseCase.execute(body);
    }

    @Post('/finish-onboarding')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Create, ResourceType.CodeReviewSettings),
    )
    public async onboardingReviewPR(
        @Body()
        body: FinishOnboardingDTO,
    ) {
        return await this.finishOnboardingUseCase.execute(body);
    }

    @Delete('/delete-integration')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Delete, ResourceType.GitSettings))
    public async deleteIntegration(
        @Query() query: { organizationId: string; teamId: string },
    ) {
        return await this.deleteIntegrationUseCase.execute(query);
    }

    @Delete('/delete-integration-and-repositories')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Delete, ResourceType.GitSettings))
    public async deleteIntegrationAndRepositories(
        @Query() query: { organizationId: string; teamId: string },
    ) {
        return await this.deleteIntegrationAndRepositoriesUseCase.execute(
            query,
        );
    }

    @Get('/get-repository-tree')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkRepoPermissions(Action.Read, ResourceType.CodeReviewSettings, {
            key: { query: 'repositoryId' },
        }),
    )
    public async getRepositoryTree(
        @Query()
        query: GetRepositoryTreeDto,
    ): Promise<any> {
        return await this.getRepositoryTreeUseCase.execute(query);
    }
}
