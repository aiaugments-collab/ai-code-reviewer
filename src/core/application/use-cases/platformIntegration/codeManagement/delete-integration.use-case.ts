import { Inject, Injectable } from '@nestjs/common';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { IntegrationCategory } from '@/shared/domain/enums/integration-category.enum';
import { AuthIntegrationService } from '@/core/infrastructure/adapters/services/integrations/authIntegration.service';
import { INTEGRATION_SERVICE_TOKEN } from '@/core/domain/integrations/contracts/integration.service.contracts';
import { IntegrationConfigService } from '@/core/infrastructure/adapters/services/integrations/integrationConfig.service';
import { IntegrationService } from '@/core/infrastructure/adapters/services/integrations/integration.service';
import { AUTH_INTEGRATION_SERVICE_TOKEN } from '@/core/domain/authIntegrations/contracts/auth-integration.service.contracts';
import { INTEGRATION_CONFIG_SERVICE_TOKEN } from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { IntegrationConfigKey } from '@/shared/domain/enums/Integration-config-key.enum';
import { REQUEST } from '@nestjs/core';
import {
    CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN,
    ICodeReviewSettingsLogService,
} from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.service.contract';
import { ActionType } from '@/config/types/general/codeReviewSettingsLog.type';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';

@Injectable()
export class DeleteIntegrationUseCase {
    constructor(
        private readonly codeManagementService: CodeManagementService,

        @Inject(INTEGRATION_SERVICE_TOKEN)
        private readonly integrationService: IntegrationService,

        @Inject(AUTH_INTEGRATION_SERVICE_TOKEN)
        private readonly authIntegrationService: AuthIntegrationService,

        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IntegrationConfigService,

        @Inject(CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN)
        private readonly codeReviewSettingsLogService: ICodeReviewSettingsLogService,

        private readonly logger: PinoLoggerService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: {
                organization: { uuid: string };
                uuid: string;
                email: string;
            };
        },
    ) {}

    async execute(params: {
        organizationId: string;
        teamId: string;
    }): Promise<void> {
        const integration = await this.integrationService.findOne({
            organization: { uuid: params.organizationId },
            team: { uuid: params.teamId },
            integrationCategory: IntegrationCategory.CODE_MANAGEMENT,
            status: true,
        });

        if (!integration) {
            return;
        }

        await this.codeManagementService.deleteWebhook({
            organizationAndTeamData: {
                organizationId: params.organizationId,
                teamId: params.teamId,
            },
        });

        const integrationConfig = await this.integrationConfigService.findOne({
            configKey: IntegrationConfigKey.REPOSITORIES,
            integration: { uuid: integration.uuid },
            team: { uuid: params.teamId },
        });

        if (integrationConfig) {
            await this.integrationConfigService.delete(integrationConfig.uuid);
        }

        try {
            this.codeReviewSettingsLogService.registerIntegrationLog({
                organizationAndTeamData: {
                    organizationId: params.organizationId,
                    teamId: params.teamId,
                },
                userInfo: {
                    userId: this.request.user.uuid,
                    userEmail: this.request.user.email,
                },
                integration,
                actionType: ActionType.DELETE,
            });
        } catch (error) {
            this.logger.error({
                message: 'Error saving code review settings log',
                error: error,
                context: DeleteIntegrationUseCase.name,
                metadata: {
                    organizationAndTeamData: {
                        organizationId: this.request.user.organization.uuid,
                        teamId: params.teamId,
                    },
                },
            });
        }

        await this.integrationService.delete(integration.uuid);

        await this.authIntegrationService.delete(
            integration.authIntegration.uuid,
        );
    }
}
