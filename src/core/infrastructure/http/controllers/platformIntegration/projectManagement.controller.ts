import { CreateAuthIntegrationUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/create-auth-integration.use-case';
import { CreateOrUpdateIntegrationConfigUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/create-or-update-auth-configs.use-case';
import { GetAuthUrlUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/get-auth-url.use-case';
import { GetProjectManagementMemberListUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/get-project-management-members-list.use-case';
import { UpdateAuthIntegrationUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/update-auth-integration.use-case';
import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { GetDomainsListUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/get-domain-list.use-case';
import { GetProjectsListUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/get-project-list.use-case';
import { GetBoardsListUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/get-boards-list.use-case';
import { GetColumnsBoardUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/get-columns-board.use-case';
import { GetTeamListUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/get-team-list.use-case';
import { SaveConfigUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/save-config.use-case';
import { ColumnsConfigKey } from '@/core/domain/integrationConfigs/types/projectManagement/columns.type';
import { TeamQueryDto } from '../../dtos/teamId-query-dto';
import { JwtAuthGuard } from '@/core/infrastructure/adapters/services/auth/jwt-auth.guard';
import { CreateIntegrationUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/create-integration.use-case';
import { GetEpicsUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/get-epics.use-case';
import { GetEffortTeamUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/get-team-effort.use-case';
import { GetWorkitemTypesUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/get-workitem-types.use-case';
import { CreateOrUpdateColumnsBoardUseCase } from '@/core/application/use-cases/platformIntegration/projectManagement/create-or-update-board-columns.use-case';
import {
    CheckPolicies,
    PolicyGuard,
} from '@/core/infrastructure/adapters/services/permissions/policy.guard';
import { checkPermissions } from '@/core/infrastructure/adapters/services/permissions/policy.handlers';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Controller('project-management')
export class ProjectManagementController {
    constructor(
        private readonly createIntegrationUseCase: CreateIntegrationUseCase,
        readonly getProjectManagementMemberListUseCase: GetProjectManagementMemberListUseCase,
        readonly getAuthUrlUseCase: GetAuthUrlUseCase,
        readonly createAuthIntegrationUseCase: CreateAuthIntegrationUseCase,
        readonly updateAuthIntegrationUseCase: UpdateAuthIntegrationUseCase,
        readonly createOrUpdateIntegrationConfigUseCase: CreateOrUpdateIntegrationConfigUseCase,
        private readonly createOrUpdateColumnsBoardUseCase: CreateOrUpdateColumnsBoardUseCase,

        private readonly getDomainsListUseCase: GetDomainsListUseCase,
        private readonly getProjectsListUseCase: GetProjectsListUseCase,
        private readonly getBoardsListUseCase: GetBoardsListUseCase,
        private readonly getColumnsBoardUseCase: GetColumnsBoardUseCase,

        private readonly getTeamListUseCase: GetTeamListUseCase,
        private readonly getEpicsUseCase: GetEpicsUseCase,
        private readonly getTeamEffortUseCase: GetEffortTeamUseCase,
        private readonly getWorkItemTypesUseCase: GetWorkitemTypesUseCase,
        private readonly saveConfigUseCase: SaveConfigUseCase,
    ) {}

    @Post('/auth-integration')
    @UseGuards(JwtAuthGuard, PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async createIntegration(@Body() body: any) {
        return this.createIntegrationUseCase.execute(body);
    }

    @Get('/auth-url/:type')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getAuthUrl(@Param('type') type: string) {
        return this.getAuthUrlUseCase.execute(type);
    }

    @Post('/create-auth-integration')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async createAuthIntegration(@Body() config: any) {
        return this.createAuthIntegrationUseCase.execute(config);
    }

    @Post('/update-auth-integration')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Update, ResourceType.GitSettings))
    public async updateAuthIntegration(@Body() config: any) {
        return this.updateAuthIntegrationUseCase.execute(config);
    }

    @Post('/create-or-update-integration-config')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async createOrUpdateIntegrationConfig(@Body() config: any) {
        return this.createOrUpdateIntegrationConfigUseCase.execute(config);
    }

    @Get('/domains')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getDomainsList(@Query() queryParams: any) {
        const { teamId } = queryParams;

        return this.getDomainsListUseCase.execute(teamId);
    }

    @Get('/projects')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getProjectsList(@Query() queryParams: any) {
        const { teamId, domainSelected } = queryParams;

        return this.getProjectsListUseCase.execute(domainSelected, teamId);
    }

    @Get('/teams')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getTeamsList(
        @Query('domainSelected') domainSelected: string,
        @Query('projectSelected') projectSelected: string,
    ) {
        return this.getTeamListUseCase.execute(domainSelected, projectSelected);
    }

    @Get('boards')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getBoards(@Query() queryParams: any) {
        const { domainSelected, projectSelected, teamSelected, teamId } =
            queryParams;

        return this.getBoardsListUseCase.execute(
            domainSelected,
            projectSelected,
            teamSelected,
            teamId,
        );
    }

    @Post('config')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async saveSetupConfig(
        @Body()
        body: {
            domainSelected: string;
            projectSelected: string;
            teamSelected: string;
            boardSelected: string;
            teamId: string;
        },
    ) {
        await this.saveConfigUseCase.execute(body);
    }

    @Get('/columns')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getColumns(@Query() query: TeamQueryDto) {
        return await this.getColumnsBoardUseCase.execute(query.teamId);
    }

    @Post('/columns')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async createOrUpdateColumns(
        @Body() body: { columns: ColumnsConfigKey[]; teamId: string },
    ) {
        return this.createOrUpdateColumnsBoardUseCase.execute(
            body.columns,
            body.teamId,
        );
    }

    @Get('/list-members')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getListMembers() {
        return this.getProjectManagementMemberListUseCase.execute();
    }

    @Get('/epics')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getEpic(@Query('teamId') teamId?: string) {
        return this.getEpicsUseCase.execute(teamId ?? null);
    }

    @Get('/team-effort')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getTeamEffort(@Query('teamId') teamId?: string) {
        return this.getTeamEffortUseCase.execute(teamId ?? null);
    }

    @Get('/work-item-types')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getWorkItemTypes(@Query('teamId') teamId?: string) {
        return this.getWorkItemTypesUseCase.execute(teamId ?? null);
    }
}
