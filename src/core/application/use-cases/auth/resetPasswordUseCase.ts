import {
    AUTH_SERVICE_TOKEN,
    IAuthService,
} from '@/core/domain/auth/contracts/auth.service.contracts';
import {
    IUsersService,
    USER_SERVICE_TOKEN,
} from '@/core/domain/user/contracts/user.service.contract';
import {
    Inject,
    Injectable,
    InternalServerErrorException,
    UnauthorizedException,
} from '@nestjs/common';

interface DecodedPayload {
  readonly email: string;
}

@Injectable()
export class ResetPasswordUseCase {
    constructor(
        @Inject(AUTH_SERVICE_TOKEN)
        private readonly authService: IAuthService,
        @Inject(USER_SERVICE_TOKEN)
        private readonly usersService: IUsersService,
    ) {}

    async execute(token: string, newPassword: string) {
        try {
            const decode:DecodedPayload = await this.authService.verifyForgotPassToken(token);
            if (!decode?.email) {
                throw new UnauthorizedException(
                    'Token does not contain user email',
                );
            }
            const password = await this.authService.hashPassword(
                newPassword,
                10,
            );
            await this.usersService.update(
                { email: decode.email },
                { password },
            );
            return { message: 'Password reset done' };
        } catch (error) {
            return new InternalServerErrorException(
                'Something went wrong while resetting password',
            );
        }
    }
}
