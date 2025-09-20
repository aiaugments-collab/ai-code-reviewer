import { STATUS } from '@/config/types/database/status.type';
import {
    ORGANIZATION_SERVICE_TOKEN,
    IOrganizationService,
} from '@/core/domain/organization/contracts/organization.service.contract';
import {
    TEAM_SERVICE_TOKEN,
    ITeamService,
} from '@/core/domain/team/contracts/team.service.contract';
import {
    TEAM_MEMBERS_SERVICE_TOKEN,
    ITeamMemberService,
} from '@/core/domain/teamMembers/contracts/teamMembers.service.contracts';
import {
    USER_SERVICE_TOKEN,
    IUsersService,
} from '@/core/domain/user/contracts/user.service.contract';
import { UserEntity } from '@/core/domain/user/entities/user.entity';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetUsersAwaitingApprovalUseCase implements IUseCase {
    constructor(
        @Inject(USER_SERVICE_TOKEN)
        private readonly usersService: IUsersService,

        @Inject(ORGANIZATION_SERVICE_TOKEN)
        private readonly organizationService: IOrganizationService,

        @Inject(TEAM_SERVICE_TOKEN)
        private readonly teamService: ITeamService,

        @Inject(TEAM_MEMBERS_SERVICE_TOKEN)
        private readonly teamMembersService: ITeamMemberService,

        private readonly logger: PinoLoggerService,
    ) {}

    public async execute(
        userId: string,
        data: { organizationId: string; teamId: string },
    ): Promise<IUser[]> {
        const { organizationId, teamId } = data;

        try {
            const user = await this.usersService.findOne({
                uuid: userId,
            });
            if (!user) {
                throw new Error('User not found');
            }

            const organization = await this.organizationService.findOne({
                uuid: organizationId,
            });
            if (!organization) {
                throw new Error('Organization not found');
            }

            const team = await this.teamService.findOne({
                uuid: teamId,
                organization: {
                    uuid: organizationId,
                },
            });
            if (!team) {
                throw new Error('Team not found');
            }

            const teamMembers =
                await this.teamMembersService.findManyByRelations({
                    teamId: team.uuid,
                    organizationId: organization.uuid,
                });

            if (!teamMembers || teamMembers.length === 0) {
                this.logger.warn({
                    message: 'No team members found for the team',
                    context: GetUsersAwaitingApprovalUseCase.name,
                    metadata: { teamId, organizationId, userId },
                });

                return [];
            }

            const pendingUsers = teamMembers.filter(
                (tm) => tm.user.status === STATUS.AWAITING_APPROVAL,
            );
            if (pendingUsers.length === 0) {
                this.logger.warn({
                    message: 'No pending users found for the team',
                    context: GetUsersAwaitingApprovalUseCase.name,
                    metadata: { teamId, organizationId, userId },
                });

                return [];
            }

            const pendingUserIds = pendingUsers.map((tm) => tm.user.uuid);

            const promises: Promise<UserEntity>[] = [];
            for (const pendingUserId of pendingUserIds) {
                promises.push(
                    this.usersService.findOne({ uuid: pendingUserId }),
                );
            }

            const users = await Promise.all(promises);

            return users
                .filter((u): u is UserEntity => !!u)
                .map((u) => u.toObject());
        } catch (error) {
            this.logger.error({
                message: 'Error getting pending users',
                context: GetUsersAwaitingApprovalUseCase.name,
                metadata: { organizationId, teamId, userId },
                error,
            });
            throw error;
        }
    }
}
