import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { ParametersEntity } from '@/core/domain/parameters/entities/parameters.entity';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { DeleteRepositoryCodeReviewParameterDto } from '@/core/infrastructure/http/dtos/delete-repository-code-review-parameter.dto';
import {
    ICodeReviewSettingsLogService,
    CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN,
} from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.service.contract';
import { ActionType, ConfigLevel } from '@/config/types/general/codeReviewSettingsLog.type';
import { Request } from 'express';
import { RepositoryWithDirectoriesException } from '@/shared/infrastructure/filters/repository-with-directories.exception';
import { DeleteByRepositoryOrDirectoryPullRequestMessagesUseCase } from '../pullRequestMessages/delete-by-repository-or-directory.use-case';
import {
    IKodyRulesService,
    KODY_RULES_SERVICE_TOKEN,
} from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { KodyRulesStatus } from '@/core/domain/kodyRules/interfaces/kodyRules.interface';

@Injectable()
export class DeleteRepositoryCodeReviewParameterUseCase {
    constructor(
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,

        @Inject(CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN)
        private readonly codeReviewSettingsLogService: ICodeReviewSettingsLogService,

        private readonly deletePullRequestMessagesUseCase: DeleteByRepositoryOrDirectoryPullRequestMessagesUseCase,

        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        private readonly logger: PinoLoggerService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: {
                uuid: string;
                email: string;
                organization: { uuid: string };
            };
        },
    ) {}

    async execute(
        body: DeleteRepositoryCodeReviewParameterDto,
    ): Promise<ParametersEntity | boolean> {
        const { teamId, repositoryId, directoryId } = body;

        try {
            if (!this.request.user.organization.uuid) {
                throw new Error('Organization ID not found');
            }

            const organizationAndTeamData: OrganizationAndTeamData = {
                organizationId: this.request.user.organization.uuid,
                teamId: teamId,
            };

            // Buscar a configuração atual de code review
            const codeReviewConfig = await this.parametersService.findByKey(
                ParametersKey.CODE_REVIEW_CONFIG,
                organizationAndTeamData,
            );

            if (!codeReviewConfig) {
                throw new Error('Code review config not found');
            }

            const codeReviewConfigValue = codeReviewConfig.configValue;

            let updatedData;

            if (repositoryId && directoryId) {
                updatedData = await this.deleteDirectoryConfig(
                    organizationAndTeamData,
                    codeReviewConfigValue,
                    repositoryId,
                    directoryId,
                );
            } else if (repositoryId && !directoryId) {
                updatedData = await this.deleteRepositoryConfig(
                    organizationAndTeamData,
                    codeReviewConfigValue,
                    repositoryId,
                );
            }

            return updatedData;
        } catch (error) {
            this.logger.error({
                message:
                    'Could not delete repository from code review configuration',
                context: DeleteRepositoryCodeReviewParameterUseCase.name,
                serviceName: 'DeleteRepositoryCodeReviewParameterUseCase',
                error: error,
                metadata: {
                    repositoryId,
                    teamId,
                    organizationAndTeamData: {
                        organizationId: this.request.user.organization.uuid,
                        teamId: teamId,
                    },
                },
            });
            throw error;
        }
    }

    private async deleteRepositoryConfig(
        organizationAndTeamData: OrganizationAndTeamData,
        codeReviewConfigValue: any,
        repositoryId: string,
    ) {
        // Verificar se o repositório existe na configuração e capturar suas informações
        const repositoryToRemove = codeReviewConfigValue.repositories?.find(
            (repository: any) => repository.id === repositoryId,
        );

        if (!repositoryToRemove) {
            throw new Error('Repository not found in configuration');
        }

        // Verificar se o repositório possui diretórios configurados
        if (
            repositoryToRemove.directories &&
            repositoryToRemove.directories.length > 0
        ) {
            throw new RepositoryWithDirectoriesException();
        }

        // Remover o repositório específico do array
        const updatedRepositories = codeReviewConfigValue.repositories.map(
            (repository: any) => {
                if (repository.id === repositoryId) {
                    return {
                        id: repository.id,
                        name: repository.name,
                    };
                }
                return repository;
            },
        );

        // Atualizar a configuração com os repositórios filtrados
        const updatedConfigValue = {
            ...codeReviewConfigValue,
            repositories: updatedRepositories,
        };

        const updated = await this.parametersService.createOrUpdateConfig(
            ParametersKey.CODE_REVIEW_CONFIG,
            updatedConfigValue,
            organizationAndTeamData,
        );

        this.logger.log({
            message:
                'Repository removed from code review configuration successfully',
            context: DeleteRepositoryCodeReviewParameterUseCase.name,
            serviceName: 'DeleteRepositoryCodeReviewParameterUseCase',
            metadata: {
                repositoryId,
                organizationAndTeamData,
                remainingRepositories: updatedRepositories.length,
            },
        });

        try {
            // Deletar pull request messages relacionadas ao repositório
            const prMessageDeleted = await this.deletePullRequestMessagesUseCase.execute({
                organizationId: organizationAndTeamData.organizationId,
                repositoryId: repositoryId,
            });

            this.logger.log({
                message: 'Pull request messages deletion completed for repository',
                context: DeleteRepositoryCodeReviewParameterUseCase.name,
                metadata: {
                    repositoryId,
                    organizationAndTeamData,
                    prMessageDeleted,
                },
            });

            // Atualizar status das Kody Rules do repositório para inactive
            try {
                const kodyRulesUpdated = await this.kodyRulesService.updateRulesStatusByFilter(
                    organizationAndTeamData.organizationId,
                    repositoryId,
                    undefined,
                    KodyRulesStatus.DELETED,
                );

                this.logger.log({
                    message: 'Kody rules status updated for deleted repository',
                    context: DeleteRepositoryCodeReviewParameterUseCase.name,
                    metadata: {
                        repositoryId,
                        organizationAndTeamData,
                        kodyRulesUpdated: !!kodyRulesUpdated,
                    },
                });
            } catch (kodyRulesError) {
                this.logger.error({
                    message: 'Error updating Kody rules status for deleted repository',
                    context: DeleteRepositoryCodeReviewParameterUseCase.name,
                    error: kodyRulesError,
                    metadata: {
                        repositoryId,
                        organizationAndTeamData,
                    },
                });
                // Não falhar o processo principal se houver erro nas Kody Rules
            }

            this.codeReviewSettingsLogService.registerRepositoryConfigurationRemoval(
                {
                    organizationAndTeamData,
                    userInfo: {
                        userId: this.request.user.uuid,
                        userEmail: this.request.user.email,
                    },
                    repository: {
                        id: repositoryToRemove.id,
                        name: repositoryToRemove.name,
                    },
                    actionType: ActionType.DELETE,
                },
            );
            return updated;
        } catch (error) {
            this.logger.error({
                message:
                    'Could not delete repository from code review configuration',
                context: DeleteRepositoryCodeReviewParameterUseCase.name,
                serviceName: 'DeleteRepositoryCodeReviewParameterUseCase',
                error: error,
                metadata: {
                    organizationAndTeamData,
                },
            });
            return updated;
        }
    }

    private async deleteDirectoryConfig(
        organizationAndTeamData: OrganizationAndTeamData,
        codeReviewConfigValue: any,
        repositoryId: string,
        directoryId: string,
    ) {
        // Encontrar o repositório alvo
        const repository = codeReviewConfigValue.repositories?.find(
            (repo: any) => repo.id === repositoryId,
        );

        if (!repository) {
            throw new Error('Repository not found in configuration');
        }

        // Verificar se o diretório existe
        const directoryToRemove = repository.directories?.find(
            (dir: any) => dir.id === directoryId,
        );

        if (!directoryToRemove) {
            throw new Error('Directory not found in configuration');
        }

        // Remover o diretório específico do repositório
        const updatedDirectories = (repository.directories || []).filter(
            (dir: any) => dir.id !== directoryId,
        );

        // Atualizar o array de repositórios com o repositório modificado
        const updatedRepositories = (
            codeReviewConfigValue.repositories || []
        ).map((repo: any) => {
            if (repo.id === repositoryId) {
                const updatedRepo = { ...repo };

                // Se não há mais diretórios, remover a propriedade directories
                if (updatedDirectories.length === 0) {
                    delete updatedRepo.directories;
                } else {
                    updatedRepo.directories = updatedDirectories;
                }

                return updatedRepo;
            }
            return repo;
        });

        // Atualizar a configuração com os repositórios atualizados
        const updatedConfigValue = {
            ...codeReviewConfigValue,
            repositories: updatedRepositories,
        };

        const updated = await this.parametersService.createOrUpdateConfig(
            ParametersKey.CODE_REVIEW_CONFIG,
            updatedConfigValue,
            organizationAndTeamData,
        );

        this.logger.log({
            message:
                'Directory removed from repository configuration successfully',
            context: DeleteRepositoryCodeReviewParameterUseCase.name,
            serviceName: 'DeleteRepositoryCodeReviewParameterUseCase',
            metadata: {
                repositoryId,
                directoryId,
                organizationAndTeamData,
                remainingDirectories: updatedDirectories.length,
            },
        });

        try {
            // Deletar pull request messages relacionadas ao diretório
            const prMessageDeleted = await this.deletePullRequestMessagesUseCase.execute({
                organizationId: organizationAndTeamData.organizationId,
                repositoryId: repositoryId,
                directoryId: directoryId,
            });

            this.logger.log({
                message: 'Pull request messages deletion completed for directory',
                context: DeleteRepositoryCodeReviewParameterUseCase.name,
                metadata: {
                    repositoryId,
                    directoryId,
                    organizationAndTeamData,
                    prMessageDeleted,
                },
            });

            // Atualizar status das Kody Rules do diretório para inactive
            try {
                const kodyRulesUpdated = await this.kodyRulesService.updateRulesStatusByFilter(
                    organizationAndTeamData.organizationId,
                    repositoryId,
                    directoryId,
                    KodyRulesStatus.DELETED,
                );

                this.logger.log({
                    message: 'Kody rules status updated for deleted directory',
                    context: DeleteRepositoryCodeReviewParameterUseCase.name,
                    metadata: {
                        repositoryId,
                        directoryId,
                        organizationAndTeamData,
                        kodyRulesUpdated: !!kodyRulesUpdated,
                    },
                });
            } catch (kodyRulesError) {
                this.logger.error({
                    message: 'Error updating Kody rules status for deleted directory',
                    context: DeleteRepositoryCodeReviewParameterUseCase.name,
                    error: kodyRulesError,
                    metadata: {
                        repositoryId,
                        directoryId,
                        organizationAndTeamData,
                    },
                });
                // Não falhar o processo principal se houver erro nas Kody Rules
            }

            // Log específico de remoção de diretório
            await this.codeReviewSettingsLogService.registerDirectoryConfigurationRemoval(
                {
                    organizationAndTeamData,
                    userInfo: {
                        userId: this.request.user.uuid,
                        userEmail: this.request.user.email,
                    },
                    repository: {
                        id: repository.id,
                        name: repository.name,
                    },
                    directory: {
                        id: directoryToRemove.id,
                        path: directoryToRemove.path,
                    },
                    actionType: ActionType.DELETE,
                },
            );
            return updated;
        } catch (error) {
            this.logger.error({
                message:
                    'Could not delete directory from repository configuration',
                context: DeleteRepositoryCodeReviewParameterUseCase.name,
                serviceName: 'DeleteRepositoryCodeReviewParameterUseCase',
                error: error,
                metadata: {
                    organizationAndTeamData,
                    repositoryId,
                    directoryId,
                },
            });
            return updated;
        }
    }
}
