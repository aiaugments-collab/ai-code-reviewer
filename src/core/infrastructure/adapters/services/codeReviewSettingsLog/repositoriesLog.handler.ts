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

export interface RepositoriesLogParams extends BaseLogParams {
    addedRepositories?: Array<{ id: string; name: string }>;
    removedRepositories?: Array<{ id: string; name: string }>;
    sourceRepository?: { id: string; name: string };
    targetRepository?: { id: string; name: string };
    targetDirectory?: { id?: string; path: string };
}

export interface RepositoryConfigRemovalParams extends BaseLogParams {
    repository: { id: string; name: string };
}

export interface DirectoryConfigRemovalParams extends BaseLogParams {
    repository: { id: string; name?: string };
    directory: { id: string; path?: string };
}

@Injectable()
export class RepositoriesLogHandler {
    constructor(private readonly unifiedLogHandler: UnifiedLogHandler) {}

    public async logRepositoriesAction(
        params: RepositoriesLogParams,
    ): Promise<void> {
        const {
            organizationAndTeamData,
            userInfo,
            actionType,
            addedRepositories = [],
            removedRepositories = [],
            sourceRepository,
            targetRepository,
            targetDirectory,
        } = params;

        // Handle copy operation
        if (
            actionType === ActionType.ADD &&
            sourceRepository &&
            (targetRepository || targetDirectory)
        ) {
            if (targetRepository) {
                await this.logCopyRepositoryOperation({
                    organizationAndTeamData,
                    userInfo,
                    sourceRepository,
                    targetRepository,
                });
            }

            if (targetDirectory) {
                await this.logCopyDirectoryOperation({
                    organizationAndTeamData,
                    userInfo,
                    sourceRepository,
                    targetDirectory,
                });
            }

            return;
        }

        // Handle add/remove operations
        if (
            addedRepositories.length === 0 &&
            removedRepositories.length === 0
        ) {
            return;
        }

        const changedData = this.generateRepositoryChangedData(
            addedRepositories,
            removedRepositories,
            userInfo.userEmail,
        );

        await this.unifiedLogHandler.saveLogEntry({
            organizationAndTeamData,
            userInfo,
            actionType,
            configLevel: ConfigLevel.GLOBAL,
            repository: undefined,
            changedData,
        });
    }

    public async logRepositoryConfigurationRemoval(
        params: RepositoryConfigRemovalParams,
    ): Promise<void> {
        const { organizationAndTeamData, userInfo, repository } = params;

        const changedData: ChangedDataToExport[] = [
            {
                actionDescription: 'Repository Configuration Removed',
                previousValue: {
                    id: repository.id,
                    name: repository.name,
                    configType: 'specific',
                },
                currentValue: {
                    id: repository.id,
                    name: repository.name,
                    configType: 'global',
                },
                description: `User ${userInfo.userEmail} removed configuration for repository "${repository.name}", now this repository will be reviewed according to global settings`,
            },
        ];

        await this.unifiedLogHandler.saveLogEntry({
            organizationAndTeamData,
            userInfo,
            actionType: ActionType.DELETE,
            configLevel: ConfigLevel.REPOSITORY,
            repository,
            changedData,
        });
    }

    public async logDirectoryConfigurationRemoval(
        params: DirectoryConfigRemovalParams,
    ): Promise<void> {
        const { organizationAndTeamData, userInfo, repository, directory } =
            params;

        const directoryLabel = directory.path || directory.id;
        const repositoryLabel = repository.name || repository.id;

        const changedData: ChangedDataToExport[] = [
            {
                actionDescription: 'Directory Configuration Removed',
                previousValue: {
                    id: directory.id,
                    path: directory.path,
                    configType: 'specific',
                },
                currentValue: {
                    id: directory.id,
                    path: directory.path,
                    configType: 'repository',
                },
                description: `User ${userInfo.userEmail} removed configuration for directory "${directoryLabel}" in repository "${repositoryLabel}"`,
            },
        ];

        await this.unifiedLogHandler.saveLogEntry({
            organizationAndTeamData,
            userInfo,
            actionType: ActionType.DELETE,
            configLevel: ConfigLevel.DIRECTORY,
            repository: { id: repository.id, name: repository.name },
            directory: { id: directory.id, path: directory.path },
            changedData,
        });
    }

    private async logCopyRepositoryOperation(params: {
        organizationAndTeamData: any;
        userInfo: any;
        sourceRepository: { id: string; name: string };
        targetRepository: { id: string; name: string };
    }): Promise<void> {
        const {
            organizationAndTeamData,
            userInfo,
            sourceRepository,
            targetRepository,
        } = params;

        const isSourceGlobal = sourceRepository.id === 'global';
        const sourceName = isSourceGlobal
            ? 'Global Settings'
            : sourceRepository.name;

        const changedData: ChangedDataToExport[] = [
            {
                actionDescription: 'Repository Configuration Copied',
                previousValue: null,
                currentValue: {
                    sourceRepository: {
                        id: sourceRepository.id,
                        name: sourceName,
                        isGlobal: isSourceGlobal,
                    },
                    targetRepository: {
                        id: targetRepository.id,
                        name: targetRepository.name,
                    },
                },
                description: `User ${userInfo.userEmail} copied code review configuration from ${isSourceGlobal ? 'Global Settings' : `"${sourceName}"`} to repository "${targetRepository.name}"`,
            },
        ];

        await this.unifiedLogHandler.saveLogEntry({
            organizationAndTeamData,
            userInfo,
            actionType: ActionType.ADD,
            configLevel: ConfigLevel.REPOSITORY,
            repository: targetRepository,
            changedData,
        });
    }

    private async logCopyDirectoryOperation(params: {
        organizationAndTeamData: any;
        userInfo: any;
        sourceRepository: { id: string; name: string };
        targetDirectory: { id?: string; path: string };
    }): Promise<void> {
        const {
            organizationAndTeamData,
            userInfo,
            sourceRepository,
            targetDirectory,
        } = params;

        const isSourceGlobal = sourceRepository.id === 'global';
        const sourceName = isSourceGlobal
            ? 'Global Settings'
            : sourceRepository.name;

        const changedData: ChangedDataToExport[] = [
            {
                actionDescription: 'Directory Configuration Copied',
                previousValue: null,
                currentValue: {
                    sourceRepository: {
                        id: sourceRepository.id,
                        name: sourceName,
                        isGlobal: isSourceGlobal,
                    },
                    targetDirectory: {
                        id: targetDirectory.id,
                        path: targetDirectory.path,
                    },
                },
                description: `User ${userInfo.userEmail} copied code review configuration from ${isSourceGlobal ? 'Global Settings' : `"${sourceName}"`} to directory "${targetDirectory.path}"`,
            },
        ];

        await this.unifiedLogHandler.saveLogEntry({
            organizationAndTeamData,
            userInfo,
            actionType: ActionType.ADD,
            configLevel: ConfigLevel.DIRECTORY,
            directory: targetDirectory,
            changedData,
        });
    }

    private generateRepositoryChangedData(
        addedRepositories: Array<{ id: string; name: string }>,
        removedRepositories: Array<{ id: string; name: string }>,
        userEmail: string,
    ): ChangedDataToExport[] {
        const changedData: ChangedDataToExport[] = [];

        addedRepositories.forEach((repo) => {
            changedData.push({
                actionDescription: 'Repository Added',
                previousValue: null,
                currentValue: {
                    id: repo.id,
                    name: repo.name,
                },
                description: `User ${userEmail} added repository "${repo.name}" to code review settings`,
            });
        });

        removedRepositories.forEach((repo) => {
            changedData.push({
                actionDescription: 'Repository Removed',
                previousValue: {
                    id: repo.id,
                    name: repo.name,
                },
                currentValue: null,
                description: `User ${userEmail} removed repository "${repo.name}" from code review settings`,
            });
        });

        return changedData;
    }
}
