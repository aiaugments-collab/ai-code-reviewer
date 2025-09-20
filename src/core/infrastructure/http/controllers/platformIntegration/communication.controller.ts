import { GetCommunicationMemberListUseCase } from '@/core/application/use-cases/platformIntegration/communication/get-communication-members-list.use-case';
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CreateAuthIntegrationUseCase } from '@/core/application/use-cases/platformIntegration/communication/create-integration.use-case';
import { UpdateAuthIntegrationUseCase } from '@/core/application/use-cases/platformIntegration/communication/update-integration.use-case';
import { CreateOrUpdateIntegrationConfigUseCase } from '@/core/application/use-cases/platformIntegration/communication/create-or-update-configs.use-case';
import { VerifyConnectionCommunicationListUseCase } from '@/core/application/use-cases/platformIntegration/communication/verify-connection-communication-list.use-case';
import { GetChannelsUseCase } from '@/core/application/use-cases/platformIntegration/communication/get-channels';
import { SaveChannelSelectedUseCase } from '@/core/application/use-cases/platformIntegration/communication/save-channel-selected.use-case';
import { TeamQueryDto } from '../../dtos/teamId-query-dto';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { KodyNotification } from '@/core/domain/platformIntegrations/types/communication/kodyNotification.type';
import { SendKodyNotificationOnChannelUseCase } from '@/core/application/use-cases/platformIntegration/communication/sendNotification/send-kody-notification-on-channel.use-case';
import { SendKodyNotificationOnDmUseCase } from '@/core/application/use-cases/platformIntegration/communication/sendNotification/send-kody-notification-on-dm.use-case';
import { SendKodyNotificationToTeamMemberUseCase } from '@/core/application/use-cases/platformIntegration/communication/sendNotification/send-kody-notification-to-team-member.use-case';
import {
    CheckPolicies,
    PolicyGuard,
} from '@/core/infrastructure/adapters/services/permissions/policy.guard';
import { checkPermissions } from '@/core/infrastructure/adapters/services/permissions/policy.handlers';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Controller('communication')
export class CommunicationController {
    constructor(
        private readonly getCommunicationMemberListUseCase: GetCommunicationMemberListUseCase,
        private readonly createAuthIntegrationUseCase: CreateAuthIntegrationUseCase,
        private readonly updateAuthIntegrationUseCase: UpdateAuthIntegrationUseCase,
        private readonly createOrUpdateIntegrationConfigUseCase: CreateOrUpdateIntegrationConfigUseCase,
        private readonly verifyConnectionCommunicationListUseCase: VerifyConnectionCommunicationListUseCase,
        private readonly getChannelsUseCase: GetChannelsUseCase,
        private readonly saveChannelSelectedUseCase: SaveChannelSelectedUseCase,
        private readonly sendKodyNotificationOnChannelUseCase: SendKodyNotificationOnChannelUseCase,
        private readonly sendKodyNotificationOnDmUseCase: SendKodyNotificationOnDmUseCase,
        private readonly sendKodyNotificationToTeamMemberUseCase: SendKodyNotificationToTeamMemberUseCase,
    ) {}

    @Post('/create-auth-integration')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async createAuthIntegration(@Body() body: any) {
        return this.createAuthIntegrationUseCase.execute(body);
    }

    @Post('/update-auth-integration')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Update, ResourceType.GitSettings))
    public async updateAuthIntegration(@Body() body: any) {
        return this.updateAuthIntegrationUseCase.execute(body);
    }

    @Post('/create-or-update-integration-config')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async createOrUpdateIntegrationConfig(@Body() body: any) {
        return this.createOrUpdateIntegrationConfigUseCase.execute(body);
    }

    @Get('/list-members')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getListMembers() {
        return this.getCommunicationMemberListUseCase.execute();
    }

    @Get('/verify-connection')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async verifyConnection() {
        return this.verifyConnectionCommunicationListUseCase.execute();
    }

    @Get('/channels')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getChannels(@Query() query: TeamQueryDto) {
        return this.getChannelsUseCase.execute(query.teamId);
    }

    @Post('/save-channel')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async saveSelectedChannel(@Body() body: any) {
        return this.saveChannelSelectedUseCase.execute(body);
    }

    @Post('/send-notification-on-channel')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async sendNotificationOnChannel(
        @Body()
        body: {
            organizationId?: string;
            teamId?: string;
            notification: KodyNotification;
        },
    ) {
        const organizationAndTeamData: OrganizationAndTeamData = {
            organizationId: body?.organizationId,
            teamId: body?.teamId,
        };

        return this.sendKodyNotificationOnChannelUseCase.execute(
            organizationAndTeamData,
            body.notification,
        );
    }

    @Post('/send-notification-on-dm')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async sendNotificationOnDm(
        @Body()
        body: {
            organizationId?: string;
            teamId?: string;
            notification: KodyNotification;
        },
    ) {
        const organizationAndTeamData: OrganizationAndTeamData = {
            organizationId: body?.organizationId,
            teamId: body?.teamId,
        };

        return this.sendKodyNotificationOnDmUseCase.execute(
            organizationAndTeamData,
            body.notification,
        );
    }

    @Post('/send-notification-to-team-members')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async sendNotificationToTeamMembers(
        @Body()
        body: {
            teamMembers: string[];
            notification: KodyNotification;
        },
    ) {
        return this.sendKodyNotificationToTeamMemberUseCase.execute(
            body.teamMembers,
            body.notification,
        );
    }
}
