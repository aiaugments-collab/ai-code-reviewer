import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { ActionType, UserInfo } from '@/config/types/general/codeReviewSettingsLog.type';

export interface IntegrationLogParams {
    organizationAndTeamData: OrganizationAndTeamData;
    userInfo: UserInfo;
    integration: {
        platform: string;
        integrationCategory: string;
        status: boolean;
        authIntegration: any;
    };
    actionType: ActionType;
}

export interface UserStatusLogParams {
    organizationAndTeamData: OrganizationAndTeamData;
    userInfo: UserInfo;
    actionType: ActionType;
    userStatusChanges: Array<{
        gitId: string;
        gitTool: string;
        licenseStatus: "active" | "inactive";
        userName: string;
    }>;
}
