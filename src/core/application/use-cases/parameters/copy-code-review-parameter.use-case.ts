import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    PARAMETERS_SERVICE_TOKEN,
    IParametersService,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { CopyCodeReviewParameterDTO } from '@/core/infrastructure/http/dtos/copy-code-review-parameter.dto';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import {
    ICodeReviewSettingsLogService,
    CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN,
} from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.service.contract';
import { ActionType } from '@/config/types/general/codeReviewSettingsLog.type';

import { v4 as uuidv4 } from 'uuid';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Injectable()
export class CopyCodeReviewParameterUseCase {
    constructor(
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,

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

        private readonly authorizationService: AuthorizationService,
    ) {}

    async execute(body: CopyCodeReviewParameterDTO) {
        const {
            targetDirectoryPath,
            teamId,
            targetRepositoryId,
            sourceRepositoryId,
        } = body;

        try {
            if (!this.request.user.organization.uuid) {
                throw new Error('Organization ID not found');
            }

            await this.authorizationService.ensure({
                user: this.request.user,
                action: Action.Read,
                resource: ResourceType.CodeReviewSettings,
                repoIds: [sourceRepositoryId],
            });

            await this.authorizationService.ensure({
                user: this.request.user,
                action: Action.Create,
                resource: ResourceType.CodeReviewSettings,
                repoIds: [targetRepositoryId],
            });

            const organizationAndTeamData: OrganizationAndTeamData = {
                organizationId: this.request.user.organization.uuid,
                teamId: teamId,
            };

            const codeReviewConfig = await this.parametersService.findByKey(
                ParametersKey.CODE_REVIEW_CONFIG,
                organizationAndTeamData,
            );

            if (!codeReviewConfig) {
                throw new Error('Code review config not found');
            }

            const codeReviewConfigValue = codeReviewConfig.configValue;

            // Se targetPath está presente, é uma cópia para diretório
            if (targetDirectoryPath) {
                return this.copyToDirectory(
                    body,
                    codeReviewConfigValue,
                    organizationAndTeamData,
                );
            } else {
                // Comportamento original - cópia para repositório
                return this.copyToRepository(
                    body,
                    codeReviewConfigValue,
                    organizationAndTeamData,
                );
            }
        } catch (error) {
            this.logger.error({
                message: 'Could not copy code review parameter',
                context: CopyCodeReviewParameterUseCase.name,
                serviceName: 'CopyCodeReviewParameterUseCase',
                error: error,
                metadata: {
                    body,
                    organizationAndTeamData: {
                        organizationId: this.request.user.organization.uuid,
                        teamId: teamId,
                    },
                },
            });
            throw error;
        }
    }

    private async copyToDirectory(
        body: CopyCodeReviewParameterDTO,
        codeReviewConfigValue: any,
        organizationAndTeamData: OrganizationAndTeamData,
    ) {
        const {
            sourceRepositoryId,
            targetRepositoryId,
            targetDirectoryPath,
            teamId,
        } = body;

        const sourceRepository =
            sourceRepositoryId === 'global'
                ? codeReviewConfigValue.global
                : codeReviewConfigValue.repositories.find(
                      (repository) => repository.id === sourceRepositoryId,
                  );

        if (!sourceRepository) {
            throw new Error('Source repository not found');
        }

        let targetRepository = codeReviewConfigValue.repositories.find(
            (repository) => repository.id === targetRepositoryId,
        );

        if (!targetRepository) {
            throw new Error('Target repository not found');
        }

        let updatedRepositories;
        let updatedTargetRepository;

        // Check if the repository is already configured
        const repositoryAlreadyConfigured =
            targetRepository.isSelected === true;

        if (!repositoryAlreadyConfigured) {
            // If the repository is not configured, copy the configuration from the source to the repository
            const {
                id,
                name,
                isSelected,
                directories,
                ...repositoryConfigFromSource
            } = sourceRepository;

            updatedTargetRepository = {
                ...targetRepository,
                ...repositoryConfigFromSource,
                isSelected: true,
                directories: targetRepository.directories || [],
            };
        } else {
            // If the repository is already configured, keep the current configuration
            updatedTargetRepository = { ...targetRepository };
        }

        // Add/update directory configuration
        const existingDirectories = updatedTargetRepository.directories || [];
        const existingDirectoryIndex = existingDirectories.findIndex(
            (dir) => dir.path === targetDirectoryPath,
        );

        let updatedDirectories;
        if (existingDirectoryIndex >= 0) {
            // Update existing directory
            updatedDirectories = existingDirectories.map((dir, index) =>
                index === existingDirectoryIndex
                    ? this.createDirectoryConfig(
                          sourceRepository,
                          targetDirectoryPath,
                          dir.id,
                      )
                    : dir,
            );
        } else {
            // Add new directory
            updatedDirectories = [
                ...existingDirectories,
                this.createDirectoryConfig(
                    sourceRepository,
                    targetDirectoryPath,
                ),
            ];
        }

        updatedTargetRepository.directories = updatedDirectories;

        updatedRepositories = codeReviewConfigValue.repositories.map(
            (repository) =>
                repository.id === targetRepositoryId
                    ? updatedTargetRepository
                    : repository,
        );

        const updatedConfigValue = {
            ...codeReviewConfigValue,
            repositories: updatedRepositories,
        };

        const updated = await this.parametersService.createOrUpdateConfig(
            ParametersKey.CODE_REVIEW_CONFIG,
            updatedConfigValue,
            organizationAndTeamData,
        );

        await this.logDirectoryCopy(
            body,
            sourceRepository,
            organizationAndTeamData,
        );

        this.logger.log({
            message: `Code review parameter copied to directory successfully${!repositoryAlreadyConfigured ? ' (repository configuration also created)' : ''}`,
            context: CopyCodeReviewParameterUseCase.name,
            serviceName: 'CopyCodeReviewParameterUseCase',
            metadata: {
                body,
                organizationAndTeamData,
                repositoryAlreadyConfigured,
            },
        });

        return updated;
    }

    private async copyToRepository(
        body: CopyCodeReviewParameterDTO,
        codeReviewConfigValue: any,
        organizationAndTeamData: OrganizationAndTeamData,
    ) {
        const { sourceRepositoryId, targetRepositoryId } = body;

        const sourceRepository =
            sourceRepositoryId === 'global'
                ? codeReviewConfigValue.global
                : codeReviewConfigValue.repositories.find(
                      (repository) => repository.id === sourceRepositoryId,
                  );

        const targetRepository = codeReviewConfigValue.repositories.find(
            (repository) => repository.id === targetRepositoryId,
        );

        if (!sourceRepository || !targetRepository) {
            throw new Error('Source or target repository not found');
        }

        const updatedTarget = {
            ...sourceRepository,
            id: targetRepository.id,
            name: targetRepository.name,
            isSelected: true,
            ...(targetRepository.directories && {
                directories: targetRepository.directories,
            }),
        };

        const updatedRepositories = codeReviewConfigValue.repositories.map(
            (repository) =>
                repository.id === targetRepositoryId
                    ? updatedTarget
                    : repository,
        );

        const updatedConfigValue = {
            ...codeReviewConfigValue,
            repositories: updatedRepositories,
        };

        const updated = await this.parametersService.createOrUpdateConfig(
            ParametersKey.CODE_REVIEW_CONFIG,
            updatedConfigValue,
            organizationAndTeamData,
        );

        await this.logRepositoryCopy(
            body,
            sourceRepository,
            targetRepository,
            organizationAndTeamData,
        );

        this.logger.log({
            message: 'Code review parameter copied successfully',
            context: CopyCodeReviewParameterUseCase.name,
            serviceName: 'CopyCodeReviewParameterUseCase',
            metadata: {
                body,
                organizationAndTeamData,
            },
        });

        return updated;
    }

    private createDirectoryConfig(
        sourceConfig: any,
        targetPath: string,
        existingId?: string,
    ): any {
        // Remove repository specific properties if they exist
        const { id, name, isSelected, directories, ...directoryConfig } =
            sourceConfig;

        return {
            id: existingId || uuidv4(),
            name: this.extractDirectoryNameFromPath(targetPath),
            path: targetPath,
            isSelected: true,
            ...directoryConfig,
        };
    }

    private extractDirectoryNameFromPath(path: string): string {
        const segments = path.split('/');
        return segments[segments.length - 1];
    }

    private async logDirectoryCopy(
        body: CopyCodeReviewParameterDTO,
        sourceRepository: any,
        organizationAndTeamData: OrganizationAndTeamData,
    ) {
        try {
            this.codeReviewSettingsLogService.registerRepositoriesLog({
                organizationAndTeamData: {
                    ...organizationAndTeamData,
                    organizationId: this.request.user.organization.uuid,
                },
                userInfo: {
                    userId: this.request.user.uuid,
                    userEmail: this.request.user.email,
                },
                actionType: ActionType.ADD,
                sourceRepository:
                    body.sourceRepositoryId === 'global'
                        ? { id: 'global', name: 'Global Settings' }
                        : {
                              id: sourceRepository.id,
                              name: sourceRepository.name,
                          },
                targetDirectory: {
                    id: '',
                    path: body.targetDirectoryPath,
                },
            });
        } catch (error) {
            this.logger.error({
                message: 'Error saving code review settings log for directory',
                error: error,
                context: CopyCodeReviewParameterUseCase.name,
                metadata: {
                    organizationAndTeamData: organizationAndTeamData,
                },
            });
        }
    }

    private async logRepositoryCopy(
        body: CopyCodeReviewParameterDTO,
        sourceRepository: any,
        targetRepository: any,
        organizationAndTeamData: OrganizationAndTeamData,
    ) {
        try {
            this.codeReviewSettingsLogService.registerRepositoriesLog({
                organizationAndTeamData: {
                    ...organizationAndTeamData,
                    organizationId: this.request.user.organization.uuid,
                },
                userInfo: {
                    userId: this.request.user.uuid,
                    userEmail: this.request.user.email,
                },
                actionType: ActionType.ADD,
                sourceRepository:
                    body.sourceRepositoryId === 'global'
                        ? { id: 'global', name: 'Global Settings' }
                        : {
                              id: sourceRepository.id,
                              name: sourceRepository.name,
                          },
                targetRepository: {
                    id: targetRepository.id,
                    name: targetRepository.name,
                },
            });
        } catch (error) {
            this.logger.error({
                message: 'Error saving code review settings log',
                error: error,
                context: CopyCodeReviewParameterUseCase.name,
                metadata: {
                    organizationAndTeamData: organizationAndTeamData,
                },
            });
        }
    }
}
