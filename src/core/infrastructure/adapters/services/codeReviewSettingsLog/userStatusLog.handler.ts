import { Injectable } from '@nestjs/common';
import {
    UnifiedLogHandler,
    BaseLogParams,
    ChangedDataToExport,
} from './unifiedLog.handler';
import {
    ActionType,
    ConfigLevel,
} from '@/config/types/general/codeReviewSettingsLog.type';

export interface UserStatusChange {
    gitId: string;
    gitTool: string;
    userName: string;
    licenseStatus: boolean;
}

export interface UserStatusLogParams extends BaseLogParams {
    userStatusChanges: UserStatusChange[];
}

@Injectable()
export class UserStatusLogHandler {
    constructor(private readonly unifiedLogHandler: UnifiedLogHandler) {}

    public async logUserStatusChanges(
        params: UserStatusLogParams,
    ): Promise<void> {
        const { userStatusChanges, userInfo } = params;

        if (userStatusChanges.length === 0) {
            return;
        }

        const changedData = this.generateUserStatusChangedData(
            userStatusChanges,
            userInfo.userEmail,
        );

        await this.unifiedLogHandler.saveLogEntry({
            ...params,
            actionType: ActionType.EDIT,
            configLevel: ConfigLevel.GLOBAL,
            repository: undefined,
            changedData,
        });
    }

    private generateUserStatusChangedData(
        userStatusChanges: UserStatusChange[],
        userEmail: string,
    ): ChangedDataToExport[] {
        return userStatusChanges.map((userChange) => {
            const statusText = userChange.licenseStatus ? 'active' : 'inactive';
            const actionText = userChange.licenseStatus
                ? 'enabled'
                : 'disabled';

            return {
                actionDescription: `User ${userChange.licenseStatus ? 'Enabled' : 'Disabled'}`,
                previousValue: '',
                currentValue: {
                    gitId: userChange.gitId,
                    gitTool: userChange.gitTool,
                    status: statusText,
                    userName: userChange.userName,
                },
                description: `User ${userEmail} ${actionText} license for user "${userChange.userName}" (${userChange.gitId})`,
            };
        });
    }
}
