import { STATUS } from '@/config/types/database/status.type';
import {
    IOrganizationService,
    ORGANIZATION_SERVICE_TOKEN,
} from '@/core/domain/organization/contracts/organization.service.contract';
import {
    IProfileService,
    PROFILE_SERVICE_TOKEN,
} from '@/core/domain/profile/contracts/profile.service.contract';
import {
    ITeamService,
    TEAM_SERVICE_TOKEN,
} from '@/core/domain/team/contracts/team.service.contract';
import {
    ITeamMemberService,
    TEAM_MEMBERS_SERVICE_TOKEN,
} from '@/core/domain/teamMembers/contracts/teamMembers.service.contracts';
import { TeamMemberRole } from '@/core/domain/teamMembers/enums/teamMemberRole.enum';
import {
    IUsersService,
    USER_SERVICE_TOKEN,
} from '@/core/domain/user/contracts/user.service.contract';
import { Role } from '@/core/domain/permissions/enums/permissions.enum';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { JoinOrganizationDto } from '@/core/infrastructure/http/dtos/join-organization.dto';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class JoinOrganizationUseCase implements IUseCase {
    constructor(
        @Inject(USER_SERVICE_TOKEN)
        private readonly userService: IUsersService,

        @Inject(ORGANIZATION_SERVICE_TOKEN)
        private readonly organizationService: IOrganizationService,

        @Inject(TEAM_SERVICE_TOKEN)
        private readonly teamService: ITeamService,

        @Inject(TEAM_MEMBERS_SERVICE_TOKEN)
        private readonly teamMembersService: ITeamMemberService,

        @Inject(PROFILE_SERVICE_TOKEN)
        private readonly profileService: IProfileService,

        private readonly logger: PinoLoggerService,
    ) {}

    public async execute(data: JoinOrganizationDto): Promise<IUser> {
        const { userId, organizationId } = data;

        try {
            const user = await this.userService.findOne({
                uuid: userId,
            });
            if (!user) {
                throw new Error('User not found');
            }

            const originalOrgId = user.organization.uuid;

            const profile = await this.profileService.findOne({
                user: { uuid: userId },
            });
            if (!profile) {
                throw new Error('Profile not found for the user');
            }

            const organization = await this.organizationService.findOne({
                uuid: organizationId,
            });
            if (!organization) {
                throw new Error('Organization not found');
            }

            if (originalOrgId === organizationId) {
                return user;
            }

            const team = await this.teamService.findOne({
                organization: { uuid: organizationId },
            });

            if (!team) {
                throw new Error('Team not found for the organization');
            }

            let teamMember = await this.teamMembersService.findOne({
                user: { uuid: user.uuid },
            });

            if (!teamMember) {
                teamMember = await this.teamMembersService.create({
                    team,
                    user,
                    organization,
                    name: profile.name,
                    teamRole: TeamMemberRole.MEMBER,
                    status: true,
                });
            } else {
                await this.teamMembersService.update(
                    {
                        uuid: teamMember.uuid,
                    },
                    {
                        team,
                        organization,
                        teamRole: TeamMemberRole.MEMBER,
                        status: true,
                    },
                );
            }

            const updatedUser = await this.userService.update(
                {
                    uuid: user.uuid,
                },
                {
                    role: Role.CONTRIBUTOR,
                    status: STATUS.AWAITING_APPROVAL,
                    organization,
                },
            );

            if (!updatedUser) {
                throw new Error('Failed to update user with new organization');
            }

            this.logger.log({
                message: 'User joined organization',
                context: JoinOrganizationUseCase.name,
                serviceName: JoinOrganizationUseCase.name,
                metadata: { userId, organizationId },
            });

            await this.cleanUp(originalOrgId);

            return updatedUser.toObject();
        } catch (error) {
            this.logger.error({
                message: 'Error joining organization',
                error,
                context: JoinOrganizationUseCase.name,
                serviceName: JoinOrganizationUseCase.name,
                metadata: { userId, organizationId },
            });

            throw error;
        }
    }

    async cleanUp(organizationId: string) {
        const usersInOrg = await this.userService.find({
            organization: { uuid: organizationId },
        });

        const teamsInOrg = await this.teamService.find({
            organization: { uuid: organizationId },
        });

        const originalTeamCount = teamsInOrg.length;
        while (teamsInOrg.length > 0) {
            const team = teamsInOrg.pop();
            if (!team) {
                break;
            }

            const teamMembers =
                await this.teamMembersService.findManyByRelations({
                    organizationId: organizationId,
                    teamId: team.uuid,
                });

            if (!teamMembers || teamMembers.length === 0) {
                await this.teamService.deleteOne(team.uuid);
            }
        }

        if (teamsInOrg.length > 0) {
            this.logger.warn({
                message: 'Not all teams were deleted during cleanup',
                context: JoinOrganizationUseCase.name,
                serviceName: JoinOrganizationUseCase.name,
                metadata: { organizationId, remainingTeams: teamsInOrg.length },
            });

            return;
        }

        if (!usersInOrg || usersInOrg.length === 0) {
            await this.organizationService.deleteOne({ uuid: organizationId });
        } else {
            this.logger.warn({
                message:
                    'Organization not deleted during cleanup, users still exist',
                context: JoinOrganizationUseCase.name,
                serviceName: JoinOrganizationUseCase.name,
                metadata: { organizationId, userCount: usersInOrg.length },
            });
        }

        this.logger.log({
            message: 'Cleanup completed',
            context: JoinOrganizationUseCase.name,
            serviceName: JoinOrganizationUseCase.name,
            metadata: {
                organizationId,
                originalTeamCount,
                deletedTeams: originalTeamCount - teamsInOrg.length,
            },
        });
    }
}
