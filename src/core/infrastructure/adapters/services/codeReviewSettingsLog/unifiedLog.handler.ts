import { Injectable, Inject } from '@nestjs/common';
import {
    CODE_REVIEW_SETTINGS_LOG_REPOSITORY_TOKEN,
    ICodeReviewSettingsLogRepository,
} from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.repository.contract';
import {
    ActionType,
    ConfigLevel,
    UserInfo,
} from '@/config/types/general/codeReviewSettingsLog.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { GetAdditionalInfoHelper } from '@/shared/utils/helpers/getAdditionalInfo.helper';
import { PinoLoggerService } from '../logger/pino.service';

export interface ChangedDataToExport {
    actionDescription: string;
    previousValue: any;
    currentValue: any;
    description: string;
}

export interface BaseLogParams {
    organizationAndTeamData: OrganizationAndTeamData;
    userInfo: UserInfo;
    actionType: ActionType;
    configLevel?: ConfigLevel;
    repository?: { id: string; name?: string };
    directory?: { id?: string; path?: string };
}

export interface UnifiedLogParams extends BaseLogParams {
    entityType: string;
    entityName?: string;
    oldData?: any;
    newData?: any;
    customChangedData?: ChangedDataToExport[];
}

@Injectable()
export class UnifiedLogHandler {
    constructor(
        @Inject(CODE_REVIEW_SETTINGS_LOG_REPOSITORY_TOKEN)
        private readonly codeReviewSettingsLogRepository: ICodeReviewSettingsLogRepository,
        private readonly getAdditionalInfoHelper: GetAdditionalInfoHelper,
        private readonly logger: PinoLoggerService,
    ) {}

    public async logAction(params: UnifiedLogParams): Promise<void> {
        const {
            organizationAndTeamData,
            userInfo,
            actionType,
            configLevel,
            repository,
            directory,
            entityType,
            entityName,
            oldData,
            newData,
            customChangedData,
        } = params;

        const changedData =
            customChangedData ||
            this.generateChangedData({
                actionType,
                entityType,
                entityName,
                oldData,
                newData,
                userInfo,
            });

        try {
            if (configLevel === ConfigLevel.REPOSITORY && !repository?.name) {
                repository.name = await this.getRepositoryAdditionalInfo(
                    repository?.id,
                    organizationAndTeamData.organizationId,
                );
            }
        } catch (error) {
            this.logger.error({
                message: 'Error getting repository additional info',
                context: UnifiedLogHandler.name,
                error: error,
            });

            if (repository) {
                repository.name = 'Unknown';
            }
        }

        try {
            if (configLevel === ConfigLevel.DIRECTORY && !directory?.path) {
                directory.path = await this.getDirectoryAdditionalInfo(
                    directory?.id,
                    repository?.id,
                    organizationAndTeamData.organizationId,
                );
            }
        } catch (error) {
            this.logger.error({
                message: 'Error getting directory additional info',
                context: UnifiedLogHandler.name,
                error: error,
            });

            if (directory) {
                directory.path = 'Unknown';
            }
        }

        await this.codeReviewSettingsLogRepository.create({
            organizationId: organizationAndTeamData.organizationId,
            teamId: organizationAndTeamData.teamId,
            action: actionType,
            userInfo: {
                userId: userInfo.userId,
                userEmail: userInfo.userEmail,
            },
            configLevel,
            repository,
            directory,
            changedData,
        });
    }

    public async saveLogEntry(
        params: BaseLogParams & { changedData: ChangedDataToExport[] },
    ): Promise<void> {
        const {
            organizationAndTeamData,
            userInfo,
            actionType,
            configLevel,
            repository,
            directory,
            changedData,
        } = params;

        try {
            if (configLevel === ConfigLevel.REPOSITORY && !repository?.name) {
                repository.name = await this.getRepositoryAdditionalInfo(
                    repository?.id,
                    organizationAndTeamData.organizationId,
                );
            }
        } catch (error) {
            this.logger.error({
                message: 'Error getting repository additional info',
                context: UnifiedLogHandler.name,
                error: error,
            });
            if (repository) {
                repository.name = 'Unknown';
            }
        }

        try {
            if (configLevel === ConfigLevel.DIRECTORY && !directory?.path) {
                directory.path = await this.getDirectoryAdditionalInfo(
                    directory?.id,
                    repository?.id,
                    organizationAndTeamData.organizationId,
                );
            }
        } catch (error) {
            this.logger.error({
                message: 'Error getting directory additional info',
                context: UnifiedLogHandler.name,
                error: error,
            });
            if (directory) {
                directory.path = 'Unknown';
            }
        }

        await this.codeReviewSettingsLogRepository.create({
            organizationId: organizationAndTeamData.organizationId,
            teamId: organizationAndTeamData.teamId,
            action: actionType,
            userInfo: {
                userId: userInfo.userId,
                userEmail: userInfo.userEmail,
            },
            configLevel,
            repository,
            directory,
            changedData,
        });
    }

    private generateChangedData(params: {
        actionType: ActionType;
        entityType: string;
        entityName?: string;
        oldData?: any;
        newData?: any;
        userInfo: UserInfo;
    }): ChangedDataToExport[] {
        const {
            actionType,
            entityType,
            entityName,
            oldData,
            newData,
            userInfo,
        } = params;

        const actionDescription = this.generateActionDescription(
            entityType,
            actionType,
        );
        const description = this.generateDescription(
            actionType,
            entityType,
            entityName,
            userInfo.userEmail,
        );

        return [
            {
                actionDescription,
                previousValue: oldData || null,
                currentValue: newData || null,
                description,
            },
        ];
    }

    private generateActionDescription(
        entityType: string,
        actionType: ActionType,
    ): string {
        const entityDisplayNames = {
            kodyRule: 'Kody Rule',
            config: 'Configuration',
            repository: 'Repository',
            integration: 'Integration',
            user: 'User',
        };

        const actionDisplayNames = {
            [ActionType.CREATE]: 'Created',
            [ActionType.EDIT]: 'Edited',
            [ActionType.DELETE]: 'Deleted',
            [ActionType.ADD]: 'Added',
        };

        const entityDisplay =
            entityDisplayNames[entityType] ||
            this.capitalizeFirstLetter(entityType);
        const actionDisplay = actionDisplayNames[actionType] || actionType;

        return `${entityDisplay} ${actionDisplay}`;
    }

    private generateDescription(
        actionType: ActionType,
        entityType: string,
        entityName: string | undefined,
        userEmail: string,
    ): string {
        const actionVerbs = {
            [ActionType.CREATE]: 'created',
            [ActionType.EDIT]: 'edited',
            [ActionType.DELETE]: 'deleted',
            [ActionType.ADD]: 'added',
        };

        const verb = actionVerbs[actionType] || actionType.toLowerCase();
        const entityDisplay = entityName ? `"${entityName}"` : entityType;

        return `User ${userEmail} ${verb} ${entityDisplay}`;
    }

    private capitalizeFirstLetter(string: string): string {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    // Utility methods for value comparison and formatting
    public static hasChanged(oldValue: any, newValue: any): boolean {
        if (oldValue === newValue) return false;

        if (Array.isArray(oldValue) && Array.isArray(newValue)) {
            if (oldValue.length !== newValue.length) return true;
            return oldValue.some(
                (item, index) => !this.isEqual(item, newValue[index]),
            );
        }

        if (
            oldValue &&
            newValue &&
            typeof oldValue === 'object' &&
            typeof newValue === 'object'
        ) {
            const keysOld = Object.keys(oldValue);
            const keysNew = Object.keys(newValue);

            if (keysOld.length !== keysNew.length) return true;
            return keysOld.some(
                (key) => !this.isEqual(oldValue[key], newValue[key]),
            );
        }

        return true;
    }

    private static isEqual(a: any, b: any): boolean {
        if (a === b) return true;

        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            return a.every((item, index) => this.isEqual(item, b[index]));
        }

        if (a && b && typeof a === 'object' && typeof b === 'object') {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);

            if (keysA.length !== keysB.length) return false;
            return keysA.every((key) => this.isEqual(a[key], b[key]));
        }

        return false;
    }

    public static formatValue(value: any): string {
        if (value === null || value === undefined) {
            return 'none';
        }

        if (typeof value === 'boolean') {
            return value ? 'enabled' : 'disabled';
        }

        if (Array.isArray(value)) {
            return value.join(', ') || 'none';
        }

        if (typeof value === 'object') {
            return JSON.stringify(value);
        }

        return String(value);
    }

    private async getDirectoryAdditionalInfo(
        directoryId: string,
        repositoryId: string,
        organizationId: string,
        directoryPathParam?: string,
    ): Promise<string> {
        if (!directoryId || !repositoryId || !organizationId) {
            return '';
        }

        let directoryPath = '';

        if (!directoryPathParam) {
            directoryPath = await this.getDirectoryPath(
                directoryId,
                repositoryId,
                organizationId,
            );
        } else {
            directoryPath = directoryPathParam;
        }

        return directoryPath;
    }

    private async getRepositoryAdditionalInfo(
        repositoryId: string,
        organizationId: string,
        repositoryNameParam?: string,
    ): Promise<string> {
        if (!repositoryId || !organizationId) {
            return '';
        }

        let repositoryName = '';

        if (!repositoryNameParam) {
            repositoryName = await this.getRepositoryName(
                repositoryId,
                organizationId,
            );
        } else {
            repositoryName = repositoryNameParam;
        }

        return repositoryName;
    }

    private async getDirectoryPath(
        directoryId: string,
        repositoryId: string,
        organizationId: string,
    ): Promise<string> {
        const directoryPath =
            await this.getAdditionalInfoHelper.getDirectoryPathByOrganizationAndRepository(
                organizationId,
                repositoryId,
                directoryId,
            );
        return directoryPath;
    }

    private async getRepositoryName(
        repositoryId: string,
        organizationId: string,
    ): Promise<string> {
        const repositoryName =
            await this.getAdditionalInfoHelper.getRepositoryNameByOrganizationAndRepository(
                organizationId,
                repositoryId,
            );
        return repositoryName;
    }
}
