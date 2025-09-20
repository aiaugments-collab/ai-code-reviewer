import { ActionType, ChangedData, ConfigLevel } from "@/config/types/general/codeReviewSettingsLog.type";

export interface ICodeReviewSettingsLog {
    uuid: string;
    organizationId: string;
    teamId: string;
    action: ActionType;
    userInfo: {
        userId: string;
        userEmail: string;
    };
    configLevel?: ConfigLevel;
    repository?: {
        id: string;
        name?: string;
    };
    directory?: {
        id?: string;
        path?: string;
    };
    changedData: ChangedData[];
    createdAt?: Date;
    updatedAt?: Date;
}
