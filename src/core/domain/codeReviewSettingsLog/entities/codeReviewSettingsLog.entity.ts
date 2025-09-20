import { Entity } from '@/shared/domain/interfaces/entity';
import { ICodeReviewSettingsLog } from '../interfaces/codeReviewSettingsLog.interface';
import {
    ActionType,
    ChangedData,
    ConfigLevel,
} from '@/config/types/general/codeReviewSettingsLog.type';

export class CodeReviewSettingsLogEntity
    implements Entity<ICodeReviewSettingsLog>
{
    private readonly _uuid: string;
    private readonly _organizationId: string;
    private readonly _teamId: string;
    private readonly _action: ActionType;
    private readonly _userInfo: {
        userId: string;
        userEmail: string;
    };
    private readonly _configLevel?: ConfigLevel;
    private readonly _repository?: {
        id: string;
        name?: string;
    };
    private readonly _directory?: {
        id?: string;
        path?: string;
    };
    private readonly _changedData: ChangedData[];
    private readonly _createdAt?: Date;
    private readonly _updatedAt?: Date;

    constructor(codeReviewSettingsLog: ICodeReviewSettingsLog) {
        this._uuid = codeReviewSettingsLog.uuid;
        this._organizationId = codeReviewSettingsLog.organizationId;
        this._teamId = codeReviewSettingsLog.teamId;
        this._action = codeReviewSettingsLog.action;
        this._userInfo = codeReviewSettingsLog.userInfo;
        this._configLevel = codeReviewSettingsLog.configLevel;
        this._repository = codeReviewSettingsLog.repository;
        this._directory = codeReviewSettingsLog.directory;
        this._changedData = codeReviewSettingsLog.changedData;
        this._createdAt = codeReviewSettingsLog.createdAt;
        this._updatedAt = codeReviewSettingsLog.updatedAt;
    }

    toJson(): ICodeReviewSettingsLog {
        return {
            uuid: this._uuid,
            organizationId: this._organizationId,
            teamId: this._teamId,
            action: this._action,
            userInfo: this._userInfo,
            configLevel: this._configLevel,
            repository: this._repository,
            directory: this._directory,
            changedData: this._changedData,
            createdAt: this._createdAt,
            updatedAt: this._updatedAt,
        };
    }

    toObject(): ICodeReviewSettingsLog {
        return {
            uuid: this._uuid,
            organizationId: this._organizationId,
            teamId: this._teamId,
            action: this._action,
            userInfo: this._userInfo,
            configLevel: this._configLevel,
            repository: this._repository,
            directory: this._directory,
            changedData: this._changedData,
            createdAt: this._createdAt,
            updatedAt: this._updatedAt,
        };
    }

    get uuid(): string {
        return this._uuid;
    }

    get organizationId(): string {
        return this._organizationId;
    }

    get teamId(): string {
        return this._teamId;
    }

    get action(): ActionType {
        return this._action;
    }

    get userInfo(): {
        userId: string;
        userEmail: string;
    } {
        return this._userInfo;
    }

    get configLevel(): ConfigLevel {
        return this._configLevel;
    }

    get repository(): {
        id: string;
        name?: string;
    } {
        return this._repository;
    }

    get directory(): {
        id?: string;
        path?: string;
    } {
        return this._directory;
    }

    get changedData(): ChangedData[] {
        return this._changedData;
    }

    get createdAt(): Date {
        return this._createdAt;
    }

    get updatedAt(): Date {
        return this._updatedAt;
    }

    public static create(
        codeReviewSettingsLog: ICodeReviewSettingsLog,
    ): CodeReviewSettingsLogEntity {
        return new CodeReviewSettingsLogEntity(codeReviewSettingsLog);
    }
}
