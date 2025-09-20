import { Inject, Injectable } from '@nestjs/common';
import { DeleteIntegrationUseCase } from './delete-integration.use-case';
import { PARAMETERS_SERVICE_TOKEN } from '@/core/domain/parameters/contracts/parameters.service.contract';
import { IParametersService } from '@/core/domain/parameters/contracts/parameters.service.contract';
import { PULL_REQUEST_MESSAGES_SERVICE_TOKEN } from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { IPullRequestMessagesService } from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { KODY_RULES_SERVICE_TOKEN } from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { IKodyRulesService } from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { KodyRulesStatus } from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import { ConfigLevel } from '@/config/types/general/pullRequestMessages.type';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';

@Injectable()
export class DeleteIntegrationAndRepositoriesUseCase {
    constructor(
        private readonly deleteIntegrationUseCase: DeleteIntegrationUseCase,

        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,

        @Inject(PULL_REQUEST_MESSAGES_SERVICE_TOKEN)
        private readonly pullRequestMessagesService: IPullRequestMessagesService,

        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(params: {
        organizationId: string;
        teamId: string;
    }): Promise<void> {
        const { organizationId, teamId } = params;

        try {
            // 1. First, get the list of repositories before deleting the configurations
            const repositoriesIds = await this.getRepositoriesIds(
                teamId,
                organizationId,
            );

            this.logger.log({
                message:
                    'Starting complete integration and repositories deletion',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                metadata: {
                    organizationId,
                    teamId,
                    repositoriesCount: repositoriesIds.length,
                },
            });

            // 2. Execute the existing deleteIntegrationUseCase (remove integration and config repositories)
            await this.deleteIntegrationUseCase.execute(params);

            this.logger.log({
                message: 'Integration deleted successfully',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                metadata: { organizationId, teamId },
            });

            // 3. Remove the repositories array from the code_review_config parameter
            await this.removeRepositoriesFromCodeReviewConfig(
                teamId,
                organizationId,
            );

            this.logger.log({
                message: 'Repositories removed from code review config',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                metadata: { organizationId, teamId },
            });

            // 4. Delete pullRequestMessages associated with the repositories
            await this.deletePullRequestMessages(
                organizationId,
                repositoriesIds,
            );

            this.logger.log({
                message: 'Pull request messages deleted successfully',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                metadata: {
                    organizationId,
                    teamId,
                    repositoriesCount: repositoriesIds.length,
                },
            });

            // 5. Inativar Kody rules associadas aos repositórios
            await this.inactivateKodyRules(organizationId, repositoriesIds);

            this.logger.log({
                message: 'Kody rules inactivated successfully',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                metadata: {
                    organizationId,
                    teamId,
                    repositoriesCount: repositoriesIds.length,
                },
            });

            this.logger.log({
                message:
                    'Complete integration and repositories deletion finished successfully',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                metadata: {
                    organizationId,
                    teamId,
                    repositoriesCount: repositoriesIds.length,
                },
            });
        } catch (error) {
            this.logger.error({
                message:
                    'Error during complete integration and repositories deletion',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                error: error,
                metadata: { organizationId, teamId },
            });
            throw error;
        }
    }

    private async getRepositoriesIds(
        teamId: string,
        organizationId: string,
    ): Promise<string[]> {
        try {
            // Get the code_review_config parameter to get the list of repositories
            const codeReviewConfig = await this.parametersService.findOne({
                configKey: ParametersKey.CODE_REVIEW_CONFIG,
                team: { uuid: teamId },
            });

            if (!codeReviewConfig?.configValue?.repositories) {
                this.logger.warn({
                    message: 'No repositories found in code review config',
                    context: DeleteIntegrationAndRepositoriesUseCase.name,
                    metadata: { teamId },
                });
                return [];
            }

            const repositories = codeReviewConfig.configValue.repositories;
            return repositories.map((repo: any) => repo.id.toString());
        } catch (error) {
            this.logger.error({
                message: 'Error getting repositories IDs',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                error: error,
                metadata: {
                    organizationAndTeamData: {
                        teamId,
                        organizationId,
                    },
                },
            });
            throw error;
        }
    }

    private async removeRepositoriesFromCodeReviewConfig(
        teamId: string,
        organizationId: string,
    ): Promise<void> {
        try {
            const codeReviewConfig = await this.parametersService.findOne({
                configKey: ParametersKey.CODE_REVIEW_CONFIG,
                team: { uuid: teamId },
            });

            if (!codeReviewConfig) {
                this.logger.warn({
                    message: 'Code review config not found',
                    context: DeleteIntegrationAndRepositoriesUseCase.name,
                    metadata: {
                        organizationAndTeamData: {
                            teamId,
                            organizationId,
                        },
                    },
                });
                return;
            }

            // Remove the repositories array from the configValue
            const updatedConfigValue = {
                ...codeReviewConfig.configValue,
                repositories: [],
            };

            await this.parametersService.createOrUpdateConfig(
                ParametersKey.CODE_REVIEW_CONFIG,
                updatedConfigValue,
                {
                    organizationId,
                    teamId,
                },
            );
        } catch (error) {
            this.logger.error({
                message: 'Error removing repositories from code review config',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                error: error,
                metadata: {
                    organizationAndTeamData: {
                        teamId,
                        organizationId,
                    },
                },
            });
            throw error;
        }
    }

    private async deletePullRequestMessages(
        organizationId: string,
        repositoriesIds: string[],
    ): Promise<void> {
        try {
            const deletionPromises = repositoriesIds.map(
                async (repositoryId) => {
                    try {
                        const wasDeleted =
                            await this.pullRequestMessagesService.deleteByFilter(
                                {
                                    organizationId,
                                    repositoryId,
                                    configLevel: ConfigLevel.REPOSITORY,
                                },
                            );

                        this.logger.log({
                            message: 'Pull request messages deletion attempt',
                            context:
                                DeleteIntegrationAndRepositoriesUseCase.name,
                            metadata: {
                                organizationId,
                                repositoryId,
                                wasDeleted,
                            },
                        });

                        return wasDeleted;
                    } catch (error) {
                        this.logger.error({
                            message:
                                'Error deleting pull request messages for repository',
                            context:
                                DeleteIntegrationAndRepositoriesUseCase.name,
                            error: error,
                            metadata: {
                                organizationId,
                                repositoryId,
                            },
                        });
                        return false;
                    }
                },
            );

            await Promise.all(deletionPromises);
        } catch (error) {
            this.logger.error({
                message: 'Error deleting pull request messages',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                error: error,
                metadata: {
                    organizationId,
                    repositoriesCount: repositoriesIds.length,
                },
            });
            throw error;
        }
    }

    private async inactivateKodyRules(
        organizationId: string,
        repositoriesIds: string[],
    ): Promise<void> {
        try {
            const inactivationPromises = repositoriesIds.map(
                async (repositoryId) => {
                    try {
                        const result =
                            await this.kodyRulesService.updateRulesStatusByFilter(
                                organizationId,
                                repositoryId,
                                undefined,
                                KodyRulesStatus.DELETED,
                            );

                        this.logger.log({
                            message: 'Kody rules inactivation attempt',
                            context:
                                DeleteIntegrationAndRepositoriesUseCase.name,
                            metadata: {
                                organizationId,
                                repositoryId,
                                wasInactivated: !!result,
                            },
                        });

                        return result;
                    } catch (error) {
                        this.logger.error({
                            message:
                                'Error inactivating Kody rules for repository',
                            context:
                                DeleteIntegrationAndRepositoriesUseCase.name,
                            error: error,
                            metadata: {
                                organizationId,
                                repositoryId,
                            },
                        });
                        // Do not fail the main process if there is an error in a specific repository
                        return null;
                    }
                },
            );

            await Promise.all(inactivationPromises);
        } catch (error) {
            this.logger.error({
                message: 'Error inactivating Kody rules',
                context: DeleteIntegrationAndRepositoriesUseCase.name,
                error: error,
                metadata: {
                    organizationId,
                    repositoriesCount: repositoriesIds.length,
                },
            });
            throw error;
        }
    }
}
