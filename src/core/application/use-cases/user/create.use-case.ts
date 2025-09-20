import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';
import {
    IUsersService,
    USER_SERVICE_TOKEN,
} from '@/core/domain/user/contracts/user.service.contract';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import { CreateProfileUseCase } from '../profile/create.use-case';
import { CreateTeamUseCase } from '../team/create.use-case';
import { STATUS } from '@/config/types/database/status.type';
import { Role } from '@/core/domain/permissions/enums/permissions.enum';
import { DuplicateRecordException } from '@/shared/infrastructure/filters/duplicate-record.exception';
import posthogClient from '@/shared/utils/posthog';

@Injectable()
export class CreateUserUseCase implements IUseCase {
    constructor(
        @Inject(USER_SERVICE_TOKEN)
        private readonly usersService: IUsersService,
        private readonly createProfileUseCase: CreateProfileUseCase,
        private readonly createTeamUseCase: CreateTeamUseCase,
    ) {}
    public async execute(payload: any): Promise<Partial<IUser>> {
        const previousUser = await this.usersService.count({
            email: payload.email,
        });

        if (previousUser) {
            throw new DuplicateRecordException(
                'An user with this e-mail already exists.',
                'DUPLICATE_USER_EMAIL',
            );
        }

        const user = await this.usersService.register({
            email: payload.email,
            password: payload.password,
            role: Role.OWNER,
            status: STATUS.ACTIVE,
            organization: payload.organization,
        });

        await this.createProfileUseCase.execute({
            user: { uuid: user.uuid },
            name: payload.name,
            phone: payload?.phone,
        });

        await this.createTeamUseCase.execute({
            teamName: `${payload.name} - team`,
            organizationId: user.organization.uuid,
        });

        posthogClient.userIdentify(user);

        return {
            email: user.email,
            organization: user.organization,
            role: user.role,
            status: user.status,
            uuid: user.uuid,
        };
    }
}
