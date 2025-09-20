import { Injectable } from '@nestjs/common';
import { UnifiedLogHandler, BaseLogParams } from './unifiedLog.handler';
import {
    ActionType,
    ConfigLevel,
} from '@/config/types/general/codeReviewSettingsLog.type';

export interface IntegrationLogParams extends BaseLogParams {
    integration: {
        platform: string;
        integrationCategory: string;
        authIntegration?: {
            authDetails?: {
                org?: string;
                accountType?: string;
                authMode?: string;
            };
        };
    };
}

@Injectable()
export class IntegrationLogHandler {
    constructor(private readonly unifiedLogHandler: UnifiedLogHandler) {}

    public async logIntegrationAction(
        params: IntegrationLogParams,
    ): Promise<void> {
        const { integration, actionType } = params;

        const platformName = this.formatPlatformName(integration.platform);
        const entityName =
            platformName +
            (integration.authIntegration?.authDetails?.org
                ? ` (${integration.authIntegration.authDetails.org})`
                : '');

        const { oldData, newData } = this.prepareIntegrationData(
            integration,
            actionType,
        );

        await this.unifiedLogHandler.logAction({
            ...params,
            configLevel: ConfigLevel.GLOBAL,
            entityType: 'integration',
            entityName,
            oldData,
            newData,
        });
    }

    private prepareIntegrationData(
        integration: any,
        actionType: ActionType,
    ): { oldData: any; newData: any } {
        const integrationData = {
            platform: integration.platform,
            integrationCategory: integration.integrationCategory,
            organizationName: integration.authIntegration?.authDetails?.org,
            accountType: integration.authIntegration?.authDetails?.accountType,
            authMode: integration.authIntegration?.authDetails?.authMode,
        };

        return {
            oldData: actionType === ActionType.DELETE ? integrationData : null,
            newData: actionType === ActionType.CREATE ? integrationData : null,
        };
    }

    private formatPlatformName(platform: string): string {
        const platformNames = {
            GITHUB: 'GitHub',
            GITLAB: 'GitLab',
            BITBUCKET: 'Bitbucket',
            AZURE: 'Azure DevOps',
        };
        return platformNames[platform] || platform;
    }
}
