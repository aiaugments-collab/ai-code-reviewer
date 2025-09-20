import {
    Inject,
    Injectable,
    InternalServerErrorException,
    UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

import { JwtService } from '@nestjs/jwt';
import { JWT, TokenResponse } from '@/config/types/jwt/jwt';
import { ConfigService } from '@nestjs/config';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import {
    AUTH_REPOSITORY_TOKEN,
    IAuthRepository,
} from '@/core/domain/auth/contracts/auth.repository.contracts';
import { IAuthService } from '@/core/domain/auth/contracts/auth.service.contracts';
import {
    IUserRepository,
    USER_REPOSITORY_TOKEN,
} from '@/core/domain/user/contracts/user.repository.contract';
import { UserEntity } from '@/core/domain/user/entities/user.entity';
import { IAuth } from '@/core/domain/auth/interfaces/auth.interface';
import { mapSimpleEntityToModel } from '@/shared/infrastructure/repositories/mappers';
import { UserModel } from '../../repositories/typeorm/schema/user.model';
import { getExpiryDate } from '@/shared/utils/transforms/date';
import {
    ITeamMemberService,
    TEAM_MEMBERS_SERVICE_TOKEN,
} from '@/core/domain/teamMembers/contracts/teamMembers.service.contracts';
import { TeamMemberEntity } from '@/core/domain/teamMembers/entities/teamMember.entity';
import { AuthProvider } from '@/shared/domain/enums/auth-provider.enum';
import axios, { AxiosResponse } from 'axios';

@Injectable()
export class AuthService implements IAuthService {
    protected jwtConfig: JWT;

    constructor(
        private readonly configService: ConfigService,
        private readonly jwtService: JwtService,
        @Inject(AUTH_REPOSITORY_TOKEN)
        private readonly authRepository: IAuthRepository,
        @Inject(USER_REPOSITORY_TOKEN)
        private readonly userRepository: IUserRepository,
        @Inject(TEAM_MEMBERS_SERVICE_TOKEN)
        private readonly teamMemberService: ITeamMemberService,
    ) {
        this.jwtConfig = this.configService.get<JWT>('jwtConfig');
    }

    async validateUser(
        userEntity: Partial<IUser>,
    ): Promise<Partial<IUser>> | undefined {
        const userLogged = await this.userRepository.getLoginData(
            userEntity.email,
        );

        return userLogged;
    }

    async login(
        userEntity: Partial<UserEntity>,
        authProvider: AuthProvider,
        authDetails?: any,
    ): Promise<any> {
        const teamMember = await this.teamMemberService.findOne({
            user: { uuid: userEntity?.uuid },
            organization: { uuid: userEntity?.organization?.uuid },
        });

        const tokens = await this.createToken(userEntity, teamMember);

        await this.createAuth(userEntity, tokens, authProvider, authDetails);

        return tokens;
    }

    async logout(refreshToken: string): Promise<any> {
        try {
            const refreshTokenAuth = await this.authRepository.findRefreshToken(
                {
                    refreshToken: refreshToken,
                },
            );

            if (refreshTokenAuth) {
                await this.authRepository.updateRefreshToken({
                    ...refreshTokenAuth,
                    used: true,
                });
            }

            return refreshTokenAuth;
        } catch (error) {
            console.log(error);
        }
    }

    async refreshToken(oldRefreshToken: string) {
        try {
            const payload = this.verifyToken(oldRefreshToken);

            const refreshTokenAuth =
                await this.getStoredRefreshToken(oldRefreshToken);

            this.validateRefreshToken(refreshTokenAuth);

            const userEntity = await this.userRepository.findOne({
                uuid: payload.sub,
            });

            const authDetails = refreshTokenAuth.authDetails;

            const teamMember = await this.teamMemberService.findOne({
                user: { uuid: userEntity?.uuid },
                organization: { uuid: userEntity?.organization?.uuid },
            });

            const tokens = await this.createToken(userEntity, teamMember);

            await this.markTokenAsUsed(refreshTokenAuth);
            await this.createAuth(
                userEntity,
                tokens,
                refreshTokenAuth.authProvider,
                authDetails,
            );

            return tokens;
        } catch (e) {
            throw new UnauthorizedException(
                'Refresh token is invalid or has expired',
            );
        }
    }

    async createForgotPassToken(uuid: string, email: string) {
        try {
            const user = await this.validateUser({
                email,
            });
            if (!user || !user.uuid) {
                throw new UnauthorizedException('api.users.unauthorized');
            }
            if (user.uuid !== uuid) {
                throw new UnauthorizedException(
                    'User ID does not match the provided email.',
                );
            }
            const token = await this.jwtService.signAsync(
                { uuid, email },
                {
                    secret: this.jwtConfig.secret,
                    expiresIn: '24h',
                },
            );
            return token;
        } catch (e) {
            throw new InternalServerErrorException('Failed to create token');
        }
    }
    async verifyForgotPassToken(token: string) {
        try {
            return this.jwtService.verify(token, {
                secret: this.jwtConfig.secret,
            });
        } catch (e) {
            throw new UnauthorizedException(
                'Reset password token is invalid or has expired',
            );
        }
    }

    private async createToken(
        user: Partial<UserEntity>,
        teamMember?: Partial<TeamMemberEntity>,
    ): Promise<TokenResponse> {
        try {
            const payload = {
                email: user.email,
                role: user.role,
                teamRole: teamMember?.teamRole,
                status: user.status,
                sub: user.uuid,
                organizationId: user.organization.uuid,
                iss: 'kodus-orchestrator',
                aud: 'web',
            };

            const access_token = await this.jwtService.signAsync(payload, {
                secret: this.jwtConfig.secret,
                expiresIn: this.jwtConfig.expiresIn,
            });

            const refresh_token = await this.jwtService.signAsync(payload, {
                secret: this.jwtConfig.refreshSecret,
                expiresIn: this.jwtConfig.refreshExpiresIn,
            });

            return {
                accessToken: access_token,
                refreshToken: refresh_token,
            };
        } catch (error) {
            throw new UnauthorizedException('Login is invalid');
        }
    }

    private async createAuth(
        userEntity: Partial<IUser>,
        tokens: TokenResponse,
        authProvider: AuthProvider,
        authDetails?: any,
    ): Promise<void> {
        try {
            const uuid = uuidv4();

            const userModel = mapSimpleEntityToModel(userEntity, UserModel);

            const expiryDate = getExpiryDate(this.jwtConfig.refreshExpiresIn);

            if (authProvider === AuthProvider.CREDENTIALS) {
                authDetails = {
                    refreshToken: tokens.refreshToken,
                    expiresAt: expiryDate,
                };
            }

            const tokenEntity: IAuth = {
                uuid: uuid,
                user: userModel,
                refreshToken: tokens.refreshToken,
                used: false,
                expiryDate: expiryDate,
                authDetails,
                authProvider,
            };

            await this.authRepository.saveRefreshToken({
                ...tokenEntity,
            });
        } catch (error) {
            console.log(error);
        }
    }

    private verifyToken(token: string) {
        try {
            return this.jwtService.verify(token, {
                secret: this.jwtConfig.refreshSecret,
            });
        } catch (e) {
            console.log(e);
            throw new UnauthorizedException(
                'Refresh token is invalid or has expired',
            );
        }
    }

    private async getStoredRefreshToken(token: string) {
        return await this.authRepository.findRefreshToken({
            refreshToken: token,
        });
    }

    private validateRefreshToken(refreshTokenAuth: any) {
        if (
            !refreshTokenAuth ||
            refreshTokenAuth.used ||
            new Date() > refreshTokenAuth.expiry_date
        ) {
            throw new UnauthorizedException(
                'Refresh token is invalid or has expired',
            );
        }
    }

    private async markTokenAsUsed(refreshTokenAuth: any) {
        await this.authRepository.updateRefreshToken({
            ...refreshTokenAuth,
            used: true,
        });
    }

    async hashPassword(password: string, salt: number): Promise<string> {
        return await bcrypt.hash(password, salt);
    }

    async match(enteredPassword: string, dbPassword: string): Promise<boolean> {
        return await bcrypt.compare(enteredPassword, dbPassword);
    }

    private async refreshThirdPartyToken(
        refreshToken: string,
        authProvider: AuthProvider,
    ): Promise<
        TokenResponse & {
            refreshTokenExpiresAt: number;
        }
    > {
        let url: string;
        let clientId: string;
        let clientSecret: string;

        switch (authProvider) {
            case AuthProvider.GOOGLE:
                url = 'https://oauth2.googleapis.com/token';
                clientId = process.env.API_GOOGLE_CLIENT_ID;
                clientSecret = process.env.API_GOOGLE_CLIENT_SECRET;
                break;
            case AuthProvider.GITHUB:
                url = 'https://github.com/login/oauth/access_token';
                clientId = process.env.GLOBAL_GITHUB_CLIENT_ID;
                clientSecret = process.env.API_GITHUB_CLIENT_SECRET;
                break;
            case AuthProvider.GITLAB:
                url = 'https://gitlab.com/oauth/token';
                clientId = process.env.GLOBAL_GITLAB_CLIENT_ID;
                clientSecret = process.env.GLOBAL_GITLAB_CLIENT_SECRET;
                break;
            default:
                throw new UnauthorizedException('Invalid auth provider');
        }

        type RefreshResponse = {
            refresh_token: string;
            access_token: string;
            expires_at: number;
        };

        const response = await axios.post(
            url,
            {
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            },
        );

        if (!response || response.status !== 200) {
            throw new UnauthorizedException(
                `Error refreshing third party token from ${authProvider}`,
            );
        }

        const data = JSON.parse(response.data) as RefreshResponse;

        if (!data.refresh_token || !data.access_token || !data.expires_at) {
            throw new UnauthorizedException(
                `Invalid response from ${authProvider} token refresh`,
            );
        }

        return {
            refreshToken: data.refresh_token,
            accessToken: data.access_token,
            refreshTokenExpiresAt: data.expires_at,
        };
    }
}
