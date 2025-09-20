import { CreateOrUpdateTeamMembersUseCase } from '@/core/application/use-cases/teamMembers/create.use-case';
import { GetTeamMemberByRelationsUseCase } from '@/core/application/use-cases/teamMembers/get-by-relations.use-case';
import { GetTeamMembersUseCase } from '@/core/application/use-cases/teamMembers/get-team-members.use-case';
import { IMembers } from '@/core/domain/teamMembers/interfaces/team-members.interface';
import {
    Body,
    Controller,
    DefaultValuePipe,
    Delete,
    Get,
    Param,
    ParseBoolPipe,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { TeamQueryDto } from '../dtos/teamId-query-dto';
import { SendInvitesUseCase } from '@/core/application/use-cases/teamMembers/send-invites.use-case';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import { DeleteTeamMembersUseCase } from '@/core/application/use-cases/teamMembers/delete.use-case';
import {
    CheckPolicies,
    PolicyGuard,
} from '../../adapters/services/permissions/policy.guard';
import { checkPermissions } from '../../adapters/services/permissions/policy.handlers';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Controller('team-members')
export class TeamMembersController {
    constructor(
        private readonly createOrUpdateTeamMembersUseCase: CreateOrUpdateTeamMembersUseCase,
        private readonly getTeamMembersUseCase: GetTeamMembersUseCase,
        private readonly getTeamMemberByRelationsUseCase: GetTeamMemberByRelationsUseCase,
        private readonly sendInvitesUseCase: SendInvitesUseCase,
        private readonly deleteTeamMembersUseCase: DeleteTeamMembersUseCase,
    ) {}

    @Get('/organization')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.UserSettings))
    public async getTeamMemberByOrganizationId(@Query() query: TeamQueryDto) {
        return this.getTeamMemberByRelationsUseCase.execute(query.teamId);
    }

    @Get('/')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.UserSettings))
    public async getTeamMembers(@Query() query: TeamQueryDto) {
        return this.getTeamMembersUseCase.execute(query.teamId);
    }

    @Post('/')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.UserSettings))
    public async createOrUpdateTeamMembers(
        @Body() body: { members: IMembers[]; teamId: string },
    ) {
        return this.createOrUpdateTeamMembersUseCase.execute(
            body.teamId,
            body.members,
        );
    }

    @Post('/send-invite')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.UserSettings))
    public async sendInvites(
        @Body()
        body: {
            teamId: string;
            organizationId: string;
            members: Partial<IUser[]>;
        },
    ) {
        return await this.sendInvitesUseCase.execute(
            body.teamId,
            body.organizationId,
            body.members,
        );
    }

    @Delete('/:uuid')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Delete, ResourceType.UserSettings))
    public async deleteTeamMember(
        @Param('uuid') uuid: string,
        @Query('removeAll', new DefaultValuePipe(false), ParseBoolPipe)
        removeAll: boolean,
    ) {
        return this.deleteTeamMembersUseCase.execute(uuid, removeAll);
    }
}
