import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
    IPasswordService,
    PASSWORD_SERVICE_TOKEN,
} from '@/core/domain/user/contracts/password.service.contract';
import {
    IUsersService,
    USER_SERVICE_TOKEN,
} from '@/core/domain/user/contracts/user.service.contract';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import posthogClient from '@/shared/utils/posthog';
import { UpdateUserDto } from '@/core/infrastructure/http/dtos/update.dto';
import { Role } from '@/core/domain/permissions/enums/permissions.enum';

@Injectable()
export class UpdateUserUseCase implements IUseCase {
    constructor(
        @Inject(USER_SERVICE_TOKEN)
        private readonly usersService: IUsersService,
        @Inject(PASSWORD_SERVICE_TOKEN)
        private readonly passwordService: IPasswordService,
    ) {}

    public async execute(uuid: string, data: UpdateUserDto): Promise<IUser> {
        const usersExists = await this.usersService.count({ uuid });

        if (!usersExists) {
            throw new NotFoundException('api.users.not_found');
        }

        if (data.password) {
            data.password = await this.passwordService.generate(
                data.password,
                10,
            );
        }

        const user = await this.usersService.update(
            { uuid },
            {
                ...data,
            },
        );

        posthogClient.userIdentify(user);

        return user.toObject();
    }
}
