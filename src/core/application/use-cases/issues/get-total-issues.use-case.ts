import { KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN } from '@/core/domain/codeBase/contracts/KodyIssuesManagement.contract';
import {
    IIssuesService,
    ISSUES_SERVICE_TOKEN,
} from '@/core/domain/issues/contracts/issues.service.contract';
import { PERMISSIONS_SERVICE_TOKEN } from '@/core/domain/permissions/contracts/permissions.service.contract';
import { GetIssuesByFiltersDto } from '@/core/infrastructure/http/dtos/get-issues-by-filters.dto';
import { KodyIssuesManagementService } from '@/ee/kodyIssuesManagement/service/kodyIssuesManagement.service';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { UserRequest } from '@/config/types/http/user-request.type';

@Injectable()
export class GetTotalIssuesUseCase implements IUseCase {
    constructor(
        @Inject(ISSUES_SERVICE_TOKEN)
        private readonly issuesService: IIssuesService,

        @Inject(KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN)
        private readonly kodyIssuesManagementService: KodyIssuesManagementService,

        @Inject(REQUEST)
        private readonly request: UserRequest,

        private readonly authorizationService: AuthorizationService,
    ) {}

    async execute(filters: GetIssuesByFiltersDto): Promise<number> {
        const newFilters: Parameters<
            typeof this.kodyIssuesManagementService.buildFilter
        >[0] = { ...filters };

        if (!newFilters?.organizationId) {
            newFilters.organizationId = this.request.user.organization.uuid;
        }

        const assignedRepositoryIds =
            await this.authorizationService.getRepositoryScope(
                this.request.user,
                Action.Read,
                ResourceType.Issues,
            );

        if (assignedRepositoryIds !== null) {
            newFilters.repositoryIds = assignedRepositoryIds;
        }

        const filter =
            await this.kodyIssuesManagementService.buildFilter(newFilters);
        return this.issuesService.count(filter);
    }
}
