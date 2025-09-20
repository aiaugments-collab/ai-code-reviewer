import {
    IIssuesService,
    ISSUES_SERVICE_TOKEN,
} from '@/core/domain/issues/contracts/issues.service.contract';
import { GetIssuesByFiltersDto } from '@/core/infrastructure/http/dtos/get-issues-by-filters.dto';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';
import { IIssue } from '@/core/domain/issues/interfaces/issues.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { KodyIssuesManagementService } from '@/ee/kodyIssuesManagement/service/kodyIssuesManagement.service';
import { KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN } from '@/core/domain/codeBase/contracts/KodyIssuesManagement.contract';
import { CacheService } from '@/shared/utils/cache/cache.service';
import { REQUEST } from '@nestjs/core';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Injectable()
export class GetIssuesByFiltersUseCase implements IUseCase {
    constructor(
        @Inject(ISSUES_SERVICE_TOKEN)
        private readonly issuesService: IIssuesService,

        private readonly logger: PinoLoggerService,

        @Inject(KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN)
        private readonly kodyIssuesManagementService: KodyIssuesManagementService,

        private readonly cacheService: CacheService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: {
                uuid: string;
                organization: { uuid: string };
            };
        },

        private readonly authorizationService: AuthorizationService,
    ) {}

    async execute(filters: GetIssuesByFiltersDto): Promise<IIssue[]> {
        try {
            const cacheKey = `issues_${filters.organizationId}`;

            let allIssues =
                await this.cacheService.getFromCache<IIssue[]>(cacheKey);

            if (!allIssues) {
                const organizationFilter =
                    await this.kodyIssuesManagementService.buildFilter({
                        organizationId: filters.organizationId,
                    });

                const issues =
                    await this.issuesService.findByFilters(organizationFilter);

                if (!issues || issues?.length === 0) {
                    return [];
                }

                allIssues = await Promise.all(
                    issues?.map(async (issue) => {
                        const age =
                            await this.kodyIssuesManagementService.ageCalculation(
                                issue,
                            );
                        return {
                            ...issue.toObject(),
                            age,
                        };
                    }),
                );

                await this.cacheService.addToCache(cacheKey, allIssues, 900000); //15 minutos
            }

            if (!allIssues || allIssues.length === 0) {
                return [];
            }

            let filteredIssues = allIssues;

            if (filters.status) {
                filteredIssues = filteredIssues.filter(
                    (issue) => issue.status === filters.status,
                );
            }

            if (filters.repositoryName) {
                filteredIssues = filteredIssues.filter(
                    (issue) =>
                        issue.repository?.name === filters.repositoryName,
                );
            }

            if (filters.severity) {
                filteredIssues = filteredIssues.filter(
                    (issue) => issue.severity === filters.severity,
                );
            }

            if (filters.category) {
                filteredIssues = filteredIssues.filter(
                    (issue) => issue.label === filters.category,
                );
            }

            if (filters.filePath) {
                filteredIssues = filteredIssues.filter((issue) =>
                    issue.filePath?.includes(filters.filePath),
                );
            }

            if (filters.title) {
                filteredIssues = filteredIssues.filter((issue) =>
                    issue.title
                        ?.toLowerCase()
                        .includes(filters.title.toLowerCase()),
                );
            }

            if (filters.prAuthor) {
                filteredIssues = filteredIssues.filter((issue) =>
                    issue.contributingSuggestions?.some(
                        (suggestion) =>
                            suggestion.prAuthor.name.toLowerCase() ===
                            filters.prAuthor.toLowerCase(),
                    ),
                );
            }

            if (filters.prNumber) {
                filteredIssues = filteredIssues.filter((issue) =>
                    issue.contributingSuggestions?.some(
                        (suggestion) =>
                            suggestion.prNumber === filters.prNumber,
                    ),
                );
            }

            const assignedRepositoryIds =
                await this.authorizationService.getRepositoryScope(
                    this.request.user,
                    Action.Read,
                    ResourceType.Issues,
                );

            if (assignedRepositoryIds !== null) {
                filteredIssues = filteredIssues.filter((issue) =>
                    assignedRepositoryIds.includes(issue.repository.id),
                );
            }

            return filteredIssues;
        } catch (error) {
            this.logger.error({
                context: GetIssuesByFiltersUseCase.name,
                message: 'Error getting issues by filters',
                error,
                metadata: {
                    organizationId: filters.organizationId,
                    filters,
                },
            });

            return [];
        }
    }
}
