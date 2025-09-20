import {
    Body,
    Controller,
    Get,
    Inject,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { GetUserUseCase } from '@/core/application/use-cases/user/get-user.use-case';
import { InviteDataUserUseCase } from '@/core/application/use-cases/user/invite-data.use-case';

import { AcceptUserInvitationDto } from '../dtos/accept-user-invitation.dto';
import { AcceptUserInvitationUseCase } from '@/core/application/use-cases/user/accept-user-invitation.use-case';
import { CheckUserWithEmailUserUseCase } from '@/core/application/use-cases/user/check-user-email.use-case';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import { JoinOrganizationDto } from '../dtos/join-organization.dto';
import { JoinOrganizationUseCase } from '@/core/application/use-cases/user/join-organization.use-case';
import { UpdateUserDto } from '../dtos/update.dto';
import { UpdateUserUseCase } from '@/core/application/use-cases/user/update.use-case';
import { REQUEST } from '@nestjs/core';
import { GetUsersAwaitingApprovalUseCase } from '@/core/application/use-cases/user/get-awaiting-approval.use-case';
import { UpdateAnotherUserDto } from '../dtos/update-another-user.dto';
import { UpdateAnotherUserUseCase } from '@/core/application/use-cases/user/update-another.use-case';
import {
    CheckPolicies,
    PolicyGuard,
} from '../../adapters/services/permissions/policy.guard';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { checkPermissions } from '../../adapters/services/permissions/policy.handlers';

@Controller('user')
export class UsersController {
    constructor(
        private readonly getUserUseCase: GetUserUseCase,
        private readonly inviteDataUserUseCase: InviteDataUserUseCase,
        private readonly acceptUserInvitationUseCase: AcceptUserInvitationUseCase,
        private readonly checkUserWithEmailUserUseCase: CheckUserWithEmailUserUseCase,
        private readonly joinOrganizationUseCase: JoinOrganizationUseCase,
        private readonly updateUserUseCase: UpdateUserUseCase,
        private readonly getUsersAwaitingApprovalUseCase: GetUsersAwaitingApprovalUseCase,
        private readonly updateAnotherUserUseCase: UpdateAnotherUserUseCase,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string }; uuid: string };
        },
    ) {}

    @Get('/email')
    public async getEmail(
        @Query('email')
        email: string,
    ) {
        return await this.checkUserWithEmailUserUseCase.execute(email);
    }

    @Get('/info')
    public async show() {
        return await this.getUserUseCase.execute();
    }

    @Get('/invite')
    public async getInviteDate(
        @Query('userId')
        userId: string,
    ) {
        return await this.inviteDataUserUseCase.execute(userId);
    }

    @Post('/invite/complete-invitation')
    public async completeInvitation(@Body() body: AcceptUserInvitationDto) {
        return await this.acceptUserInvitationUseCase.execute(body);
    }

    @Post('/join-organization')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.UserSettings))
    public async joinOrganization(@Body() body: JoinOrganizationDto) {
        return await this.joinOrganizationUseCase.execute(body);
    }

    @Patch('/')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Update, ResourceType.UserSettings))
    public async update(@Body() body: UpdateUserDto) {
        const userId = this.request.user?.uuid;

        if (!userId) {
            throw new Error('User not found in request');
        }

        return await this.updateUserUseCase.execute(userId, body);
    }

    @Get('/awaiting-approval')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.UserSettings))
    public async getUsersAwaitingApproval(
        @Query('teamId') teamId: string,
    ): Promise<IUser[]> {
        const userId = this.request.user?.uuid;
        if (!userId) {
            throw new Error('User not found in request');
        }

        const organizationId = this.request.user?.organization.uuid;
        if (!organizationId) {
            throw new Error('Organization not found in request');
        }

        if (!teamId) {
            throw new Error('TeamId is required');
        }

        return await this.getUsersAwaitingApprovalUseCase.execute(userId, {
            organizationId,
            teamId,
        });
    }

    @Patch('/:targetUserId')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Update, ResourceType.UserSettings))
    public async updateAnother(
        @Body() body: UpdateAnotherUserDto,
        @Param('targetUserId') targetUserId: string,
    ): Promise<IUser> {
        if (!targetUserId) {
            throw new Error('targetUserId is required');
        }

        const userId = this.request.user?.uuid;

        if (!userId) {
            throw new Error('User not found in request');
        }

        return await this.updateAnotherUserUseCase.execute(
            userId,
            targetUserId,
            body,
        );
    }
}
