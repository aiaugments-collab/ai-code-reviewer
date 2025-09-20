import { IssueStatus } from '@/config/types/general/issues.type';
import { ISSUES_SERVICE_TOKEN } from '@/core/domain/issues/contracts/issues.service.contract';
import { IssuesEntity } from '@/core/domain/issues/entities/issues.entity';
import { IssuesService } from '@/core/infrastructure/adapters/services/issues/issues.service';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { LabelType } from '@/shared/utils/codeManagement/labels';
import { Injectable, Inject } from '@nestjs/common';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN } from '@/core/domain/codeBase/contracts/KodyIssuesManagement.contract';
import { KodyIssuesManagementService } from '@/ee/kodyIssuesManagement/service/kodyIssuesManagement.service';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import { REQUEST } from '@nestjs/core';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Injectable()
export class UpdateIssuePropertyUseCase implements IUseCase {
    constructor(
        @Inject(ISSUES_SERVICE_TOKEN)
        private readonly issuesService: IssuesService,

        @Inject(KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN)
        private readonly kodyIssuesManagementService: KodyIssuesManagementService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: {
                uuid: string;
                organization: { uuid: string };
            };
        },

        private readonly authorizationService: AuthorizationService,
    ) {}

    async execute(
        uuid: string,
        field: 'severity' | 'label' | 'status',
        value: string,
    ): Promise<IssuesEntity | null> {
        const issue = await this.issuesService.findById(uuid);

        if (!issue || !issue.repository?.id) {
            throw new Error('Issue not found');
        }

        await this.authorizationService.ensure({
            user: this.request.user,
            action: Action.Update,
            resource: ResourceType.Issues,
            repoIds: [issue.repository.id],
        });

        await this.kodyIssuesManagementService.clearIssuesCache(
            issue.organizationId,
        );

        switch (field) {
            case 'severity':
                return await this.issuesService.updateSeverity(
                    uuid,
                    value as SeverityLevel,
                );
            case 'label':
                return await this.issuesService.updateLabel(
                    uuid,
                    value as LabelType,
                );
            case 'status':
                return await this.issuesService.updateStatus(
                    uuid,
                    value as IssueStatus,
                );
            default:
                throw new Error(`Invalid field: ${field}`);
        }
    }
}
