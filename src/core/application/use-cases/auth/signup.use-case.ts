import { STATUS } from '@/config/types/database/status.type';
import {
    ORGANIZATION_SERVICE_TOKEN,
    IOrganizationService,
} from '@/core/domain/organization/contracts/organization.service.contract';
import { IOrganization } from '@/core/domain/organization/interfaces/organization.interface';
import {
    USER_SERVICE_TOKEN,
    IUsersService,
} from '@/core/domain/user/contracts/user.service.contract';
import { Role } from '@/core/domain/permissions/enums/permissions.enum';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { SignUpDTO } from '@/core/infrastructure/http/dtos/create-user-organization.dto';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { DuplicateRecordException } from '@/shared/infrastructure/filters/duplicate-record.exception';
import { generateRandomOrgName } from '@/shared/utils/helpers';
import { Inject, Injectable } from '@nestjs/common';
import { CreateProfileUseCase } from '../profile/create.use-case';
import { CreateTeamUseCase } from '../team/create.use-case';
import { identify, track } from '@/shared/utils/segment';
import posthogClient from '@/shared/utils/posthog';
import {
    ITeamMemberService,
    TEAM_MEMBERS_SERVICE_TOKEN,
} from '@/core/domain/teamMembers/contracts/teamMembers.service.contracts';
import {
    ITeamService,
    TEAM_SERVICE_TOKEN,
} from '@/core/domain/team/contracts/team.service.contract';
import { TeamMemberRole } from '@/core/domain/teamMembers/enums/teamMemberRole.enum';
import { ITeam } from '@/core/domain/team/interfaces/team.interface';

@Injectable()
export class SignUpUseCase implements IUseCase {
    constructor(
        @Inject(ORGANIZATION_SERVICE_TOKEN)
        private readonly organizationService: IOrganizationService,

        @Inject(USER_SERVICE_TOKEN)
        private readonly usersService: IUsersService,

        @Inject(TEAM_MEMBERS_SERVICE_TOKEN)
        private readonly teamMembersService: ITeamMemberService,

        @Inject(TEAM_SERVICE_TOKEN)
        private readonly teamService: ITeamService,

        private readonly createProfileUseCase: CreateProfileUseCase,
        private readonly createTeamUseCase: CreateTeamUseCase,

        private readonly logger: PinoLoggerService,
    ) {}

    public async execute(payload: SignUpDTO): Promise<Partial<IUser>> {
        const { email, password, name, organizationId } = payload;

        try {
            const userExists = await this.checkIfUserAlreadyExists(email);
            if (userExists) {
                throw new DuplicateRecordException('User already exists');
            }

            const user: Omit<IUser, 'uuid'> = {
                email,
                password,
                role: Role.CONTRIBUTOR,
                status: STATUS.PENDING,
                organization: {
                    name: generateRandomOrgName(name),
                },
            };

            if (organizationId && organizationId.length > 0) {
                user.organization = await this.organizationService.findOne({
                    uuid: organizationId,
                });
            } else {
                const orgExists = await this.checkIfOrganizationAlreadyExists(
                    user.organization.name,
                );

                if (orgExists) {
                    throw new DuplicateRecordException(
                        'Organization with this name already exists',
                    );
                }

                user.role = Role.OWNER;
                user.status = STATUS.ACTIVE;
                user.organization =
                    await this.organizationService.createOrganizationWithTenant(
                        user.organization,
                    );
            }

            if (!user.organization) {
                throw new Error('Organization not found');
            }

            const createdUser = await this.usersService.register(user);

            if (!createdUser) {
                throw new Error('User creation failed');
            }

            await this.createProfileUseCase.execute({
                user: { uuid: createdUser.uuid },
                name,
            });

            let team: ITeam;
            const isOwner = user.role === Role.OWNER;
            if (isOwner) {
                team = await this.createTeamUseCase.execute({
                    teamName: `${name} - team`,
                    organizationId: createdUser.organization.uuid,
                });

                if (!team) {
                    throw new Error('Team creation failed');
                }
            } else {
                team = await this.teamService.findOne({
                    organization: {
                        uuid: createdUser.organization.uuid,
                    },
                });

                if (!team) {
                    throw new Error('Team not found for the organization');
                }
            }

            const member = await this.teamMembersService.create({
                user: createdUser,
                name,
                organization: createdUser.organization,
                team,
                teamRole: isOwner
                    ? TeamMemberRole.TEAM_LEADER
                    : TeamMemberRole.MEMBER,
                status: isOwner,
            });

            if (!member) {
                throw new Error('Failed to create team member');
            }

            identify(createdUser.uuid, {
                name,
                email,
                organizationId: user.organization.uuid,
                organizationName: user.organization.name,
            });

            track(createdUser.uuid, 'signed_up');

            posthogClient.organizationIdentify(
                user.organization as IOrganization,
            );
            posthogClient.userIdentify(createdUser);
            posthogClient.teamIdentify(team);

            this.sendWebhook(user, payload, user.organization.name);

            return createdUser.toObject();
        } catch (error) {
            this.logger.error({
                message: 'Error during sign up',
                error,
                context: SignUpUseCase.name,
                metadata: {
                    name,
                    email,
                    organizationId,
                },
                serviceName: SignUpUseCase.name,
            });

            throw error;
        }
    }

    private async sendWebhook(
        user: Partial<IUser>,
        payload: SignUpDTO,
        organizationName: string,
    ): Promise<void> {
        const webhookUrl = process.env.API_SIGNUP_NOTIFICATION_WEBHOOK;

        if (!webhookUrl) {
            return;
        }

        try {
            const webhookData = {
                email: user?.email,
                organization: organizationName,
                name: payload.name,
            };

            if (!webhookData.email || !webhookData.organization) {
                throw new Error('Invalid data for webhook');
            }

            let response;
            let retries = 3;
            while (retries > 0) {
                response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(webhookData),
                });

                if (response.ok) {
                    break;
                }
                console.error(
                    `Failed to send webhook (${retries} attempts remaining):`,
                    response.statusText,
                );
                await new Promise((resolve) => setTimeout(resolve, 1000));
                retries--;
            }
            if (retries === 0) {
                throw new Error('Error calling signup notification webhook');
            }
        } catch (error) {
            this.logger.error({
                message: 'Failed to send webhook.',
                context: SignUpUseCase.name,
                error: error,
            });
        }
    }

    private async checkIfUserAlreadyExists(email: string): Promise<boolean> {
        const previousUser = await this.usersService.count({
            email: email,
        });

        return !!previousUser;
    }

    private async checkIfOrganizationAlreadyExists(
        organizationName: string,
    ): Promise<boolean> {
        const existingOrganization = await this.organizationService.findOne({
            name: organizationName,
        });

        return !!existingOrganization;
    }
}
