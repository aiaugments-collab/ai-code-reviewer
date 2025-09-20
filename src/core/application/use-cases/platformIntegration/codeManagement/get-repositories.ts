import { UserRequest } from '@/config/types/http/user-request.type';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';

export class GetRepositoriesUseCase implements IUseCase {
    constructor(
        private readonly codeManagementService: CodeManagementService,

        @Inject(REQUEST)
        private readonly request: UserRequest,
        private readonly logger: PinoLoggerService,

        private readonly authorizationService: AuthorizationService,
    ) {}

    public async execute(params: {
        teamId: string;
        organizationSelected: any;
        isSelected?: boolean;
    }) {
        try {
            const repositories =
                await this.codeManagementService.getRepositories({
                    organizationAndTeamData: {
                        organizationId: this.request.user.organization.uuid,
                        teamId: params?.teamId,
                    },
                    filters: {
                        organizationSelected: params?.organizationSelected,
                    },
                });

            const assignedRepositoryIds =
                await this.authorizationService.getRepositoryScope(
                    this.request.user,
                    Action.Read,
                    ResourceType.CodeReviewSettings,
                );

            let filteredRepositories = repositories;
            if (assignedRepositoryIds !== null) {
                filteredRepositories = filteredRepositories.filter((repo) =>
                    assignedRepositoryIds.includes(repo.id),
                );
            }

            if (params.isSelected !== undefined) {
                filteredRepositories = filteredRepositories.filter(
                    (repo) => repo.selected === Boolean(params.isSelected),
                );
            }

            return filteredRepositories;
        } catch (error) {
            this.logger.error({
                message: 'Error while getting repositories',
                context: GetRepositoriesUseCase.name,
                error: error,
                metadata: {
                    organizationAndTeamData: {
                        organizationId: this.request.user.organization.uuid,
                        teamId: params.teamId,
                    },
                },
            });
            return [];
        }
    }
}
