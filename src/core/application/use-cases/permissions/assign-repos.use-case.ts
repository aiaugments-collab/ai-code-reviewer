import {
    IIntegrationConfigService,
    INTEGRATION_CONFIG_SERVICE_TOKEN,
} from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import {
    IPermissionsService,
    PERMISSIONS_SERVICE_TOKEN,
} from '@/core/domain/permissions/contracts/permissions.service.contract';
import { Repositories } from '@/core/domain/platformIntegrations/types/codeManagement/repositories.type';
import {
    IUsersService,
    USER_SERVICE_TOKEN,
} from '@/core/domain/user/contracts/user.service.contract';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { IntegrationConfigKey } from '@/shared/domain/enums/Integration-config-key.enum';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class AssignReposUseCase implements IUseCase {
    constructor(
        @Inject(USER_SERVICE_TOKEN)
        private readonly userService: IUsersService,

        @Inject(PERMISSIONS_SERVICE_TOKEN)
        private readonly permissionsService: IPermissionsService,

        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IIntegrationConfigService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(params: { userId: string; repoIds: string[] }) {
        try {
            const { userId, repoIds } = params;

            const user = await this.userService.findOne({ uuid: userId });
            if (!user) {
                throw new Error('User not found');
            }

            const integrationConfigs =
                await this.integrationConfigService.findOne({
                    configKey: IntegrationConfigKey.REPOSITORIES,
                    integration: {
                        organization: {
                            uuid: user.organization?.uuid,
                        },
                    },
                });
            if (!integrationConfigs) {
                throw new Error(
                    'Integration configurations not found for the organization',
                );
            }

            const configuredRepos =
                (integrationConfigs.configValue as Repositories[]) || [];
            const configuredRepoIds = configuredRepos.map((repo) => repo.id);

            const validRepoIds = repoIds.filter((id) =>
                configuredRepoIds.includes(id),
            );
            if (validRepoIds.length === 0) {
                throw new Error(
                    'None of the provided repository IDs are valid',
                );
            }

            const permissions = await this.permissionsService.findOne({
                user: { uuid: userId },
            });

            if (!permissions) {
                this.logger.warn({
                    message: `No permissions found for user. Creating new permissions record.`,
                    metadata: { userId, assignedRepositoryIds: validRepoIds },
                    context: AssignReposUseCase.name,
                });

                await this.permissionsService.create({
                    user: { uuid: userId },
                    permissions: { assignedRepositoryIds: validRepoIds },
                });

                return validRepoIds;
            }

            await this.permissionsService.update(permissions.uuid, {
                permissions: { assignedRepositoryIds: validRepoIds },
            });

            this.logger.log({
                message: `Assigned repositories to user with UUID: ${userId}`,
                context: AssignReposUseCase.name,
                metadata: { assignedRepositoryIds: validRepoIds },
            });

            return validRepoIds;
        } catch (error) {
            this.logger.error({
                message: 'Error assigning repositories to user',
                error,
                context: AssignReposUseCase.name,
                metadata: { params },
            });

            throw error;
        }
    }
}
