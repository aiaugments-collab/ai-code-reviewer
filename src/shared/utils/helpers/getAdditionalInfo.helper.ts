import { IParametersService, PARAMETERS_SERVICE_TOKEN } from '@/core/domain/parameters/contracts/parameters.service.contract';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import {
    IIntegrationService,
    INTEGRATION_SERVICE_TOKEN,
} from '@/core/domain/integrations/contracts/integration.service.contracts';
import {
    IIntegrationConfigService,
    INTEGRATION_CONFIG_SERVICE_TOKEN,
} from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { IntegrationConfigKey } from '@/shared/domain/enums/Integration-config-key.enum';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetAdditionalInfoHelper {
    constructor(
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,
        @Inject(INTEGRATION_SERVICE_TOKEN)
        private readonly integrationService: IIntegrationService,
        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IIntegrationConfigService,
    ) {}

    async getTeamIdByOrganizationAndRepository(
        organizationId: string,
        repositoryId: string,
    ): Promise<string> {
        // 1. Buscar todas as integrações ativas da organização
        const integrations = await this.integrationService.find({
            organization: { uuid: organizationId },
            status: true,
        });

        if (!integrations || integrations.length === 0) {
            throw new Error('No active integrations found for organization');
        }

        // 2. Para cada integração, buscar as integration configs com chave REPOSITORIES
        for (const integration of integrations) {
            const integrationConfigs = await this.integrationConfigService.find(
                {
                    integration: { uuid: integration.uuid },
                    configKey: IntegrationConfigKey.REPOSITORIES,
                },
            );

            if (!integrationConfigs || integrationConfigs.length === 0) {
                continue;
            }

            // 3. Buscar na lista de repositórios por um que tenha o mesmo id
            for (const config of integrationConfigs) {
                const repositories = config.configValue;

                if (Array.isArray(repositories)) {
                    const foundRepository = repositories.find(
                        (repo: any) =>
                            repo.id === repositoryId ||
                            repo.id === repositoryId.toString(),
                    );

                    if (foundRepository) {
                        // 4. Retornar o teamId dessa integration config
                        return config?.team?.uuid;
                    }
                }
            }
        }

        throw new Error(
            `Repository with id ${repositoryId} not found in any integration config`,
        );
    }

    async getDirectoryPathByOrganizationAndRepository(
        organizationId: string,
        repositoryId: string,
        directoryId: string,
    ): Promise<string> {
        if (!organizationId || !repositoryId || !directoryId) {
            return '';
        }

        // 1. Obter o teamId usando o método anterior
        const teamId = await this.getTeamIdByOrganizationAndRepository(
            organizationId,
            repositoryId,
        );

        // 2. Buscar na tabela PARAMETERS pela configKey CODE_REVIEW_CONFIG
        const codeReviewConfig = await this.parametersService.findByKey(
            ParametersKey.CODE_REVIEW_CONFIG,
            { organizationId, teamId },
        );

        if (!codeReviewConfig) {
            throw new Error('Code review config not found');
        }

        // 3. Buscar na lista de repositórios o que corresponde ao repositoryId
        const repositories = codeReviewConfig.configValue.repositories;
        if (!repositories || !Array.isArray(repositories)) {
            throw new Error('No repositories found in code review config');
        }

        const targetRepository = repositories.find(
            (repo: any) =>
                repo.id === repositoryId || repo.id === repositoryId.toString(),
        );

        if (!targetRepository) {
            throw new Error(
                `Repository with id ${repositoryId} not found in code review config`,
            );
        }

        // 4. Buscar no nó directories o path que corresponde ao directoryId
        const directories = targetRepository.directories;
        if (!directories || !Array.isArray(directories)) {
            throw new Error(
                `No directories found for repository ${repositoryId}`,
            );
        }

        const targetDirectory = directories.find(
            (dir: any) =>
                dir.id === directoryId || dir.id === directoryId.toString(),
        );

        if (!targetDirectory) {
            throw new Error(
                `Directory with id ${directoryId} not found for repository ${repositoryId}`,
            );
        }

        return targetDirectory.path;
    }

    async getRepositoryNameByOrganizationAndRepository(
        organizationId: string,
        repositoryId: string,
    ): Promise<string> {
        if (!organizationId || !repositoryId) {
            return '';
        }

        // 1. Obter o teamId usando o método anterior
        const teamId = await this.getTeamIdByOrganizationAndRepository(
            organizationId,
            repositoryId,
        );

        // 2. Buscar na tabela PARAMETERS pela configKey CODE_REVIEW_CONFIG
        const codeReviewConfig = await this.parametersService.findByKey(
            ParametersKey.CODE_REVIEW_CONFIG,
            { organizationId, teamId },
        );

        if (!codeReviewConfig) {
            throw new Error('Code review config not found');
        }

        // 3. Buscar na lista de repositórios o que corresponde ao repositoryId
        const repositories = codeReviewConfig.configValue.repositories;
        if (!repositories || !Array.isArray(repositories)) {
            throw new Error('No repositories found in code review config');
        }

        const targetRepository = repositories.find(
            (repo: any) =>
                repo.id === repositoryId || repo.id === repositoryId.toString(),
        );

        if (!targetRepository) {
            throw new Error(
                `Repository with id ${repositoryId} not found in code review config`,
            );
        }

        return targetRepository.name;
    }
}
