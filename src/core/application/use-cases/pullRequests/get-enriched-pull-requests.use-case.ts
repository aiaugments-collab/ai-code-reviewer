import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { EnrichedPullRequestsQueryDto } from '@/core/infrastructure/http/dtos/enriched-pull-requests-query.dto';
import { EnrichedPullRequestResponse } from '@/core/infrastructure/http/dtos/enriched-pull-request-response.dto';
import {
    PaginatedEnrichedPullRequestsResponse,
    PaginationMetadata,
} from '@/core/infrastructure/http/dtos/paginated-enriched-pull-requests.dto';
import {
    AUTOMATION_EXECUTION_SERVICE_TOKEN,
    IAutomationExecutionService,
} from '@/core/domain/automation/contracts/automation-execution.service';
import {
    PULL_REQUESTS_SERVICE_TOKEN,
    IPullRequestsService,
} from '@/core/domain/pullRequests/contracts/pullRequests.service.contracts';
import {
    CODE_REVIEW_EXECUTION_SERVICE,
    ICodeReviewExecutionService,
} from '@/core/domain/codeReviewExecutions/contracts/codeReviewExecution.service.contract';
import { UserRequest } from '@/config/types/http/user-request.type';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Injectable()
export class GetEnrichedPullRequestsUseCase implements IUseCase {
    constructor(
        private readonly logger: PinoLoggerService,

        @Inject(AUTOMATION_EXECUTION_SERVICE_TOKEN)
        private readonly automationExecutionService: IAutomationExecutionService,

        @Inject(PULL_REQUESTS_SERVICE_TOKEN)
        private readonly pullRequestsService: IPullRequestsService,

        @Inject(CODE_REVIEW_EXECUTION_SERVICE)
        private readonly codeReviewExecutionService: ICodeReviewExecutionService,

        @Inject(REQUEST)
        private readonly request: UserRequest,

        private readonly authorizationService: AuthorizationService,
    ) {}

    async execute(
        query: EnrichedPullRequestsQueryDto,
    ): Promise<PaginatedEnrichedPullRequestsResponse> {
        const { repositoryId, repositoryName, limit = 30, page = 1 } = query;

        if (!this.request.user?.organization?.uuid) {
            this.logger.warn({
                message: 'No organization found in request',
                context: GetEnrichedPullRequestsUseCase.name,
            });
            throw new Error('No organization found in request');
        }

        if (repositoryId) {
            await this.authorizationService.ensure({
                user: this.request.user,
                action: Action.Read,
                resource: ResourceType.PullRequests,
                repoIds: [repositoryId],
            });
        }

        const organizationId = this.request.user.organization.uuid;

        try {
            const automationExecutions =
                await this.automationExecutionService.find({
                    teamAutomation: {
                        team: {
                            organization: {
                                uuid: organizationId,
                            },
                        },
                    },
                });

            if (!automationExecutions || automationExecutions.length === 0) {
                this.logger.warn({
                    message: 'No automation executions found for organization',
                    context: GetEnrichedPullRequestsUseCase.name,
                    metadata: { organizationId },
                });
                return {
                    data: [],
                    pagination: {
                        currentPage: page,
                        totalPages: 0,
                        totalItems: 0,
                        itemsPerPage: limit,
                        hasNextPage: false,
                        hasPreviousPage: false,
                    },
                };
            }

            const executionsWithPR = automationExecutions.filter(
                (execution) =>
                    execution.pullRequestNumber && execution.repositoryId,
            );

            if (executionsWithPR.length === 0) {
                this.logger.warn({
                    message: 'No automation executions with PR data found',
                    context: GetEnrichedPullRequestsUseCase.name,
                    metadata: { organizationId },
                });
                return {
                    data: [],
                    pagination: {
                        currentPage: page,
                        totalPages: 0,
                        totalItems: 0,
                        itemsPerPage: limit,
                        hasNextPage: false,
                        hasPreviousPage: false,
                    },
                };
            }

            let filteredExecutions = executionsWithPR;
            if (repositoryId) {
                filteredExecutions = executionsWithPR.filter(
                    (execution) => execution.repositoryId === repositoryId,
                );
            }

            const enrichedPullRequests: EnrichedPullRequestResponse[] = [];

            for (const execution of filteredExecutions) {
                try {
                    // Buscar PR no MongoDB
                    const pullRequest =
                        await this.pullRequestsService.findByNumberAndRepositoryId(
                            execution.pullRequestNumber!,
                            execution.repositoryId!,
                            { organizationId },
                        );

                    if (!pullRequest) {
                        this.logger.warn({
                            message: 'Pull request not found in MongoDB',
                            context: GetEnrichedPullRequestsUseCase.name,
                            metadata: {
                                prNumber: execution.pullRequestNumber,
                                repositoryId: execution.repositoryId,
                                organizationId,
                            },
                        });
                        continue;
                    }

                    // Aplicar filtro por nome do repositório se fornecido
                    if (
                        repositoryName &&
                        pullRequest.repository.name !== repositoryName
                    ) {
                        continue;
                    }

                    // Buscar timeline de code review executions da tabela específica
                    const codeReviewExecutions =
                        await this.codeReviewExecutionService.find({
                            automationExecution: { uuid: execution.uuid },
                        });

                    // Filtrar apenas PRs que têm histórico de code review
                    if (
                        !codeReviewExecutions ||
                        codeReviewExecutions.length === 0
                    ) {
                        this.logger.debug({
                            message: 'Skipping PR without code review history',
                            context: GetEnrichedPullRequestsUseCase.name,
                            metadata: {
                                prNumber: execution.pullRequestNumber,
                                repositoryId: execution.repositoryId,
                                executionUuid: execution.uuid,
                            },
                        });
                        continue;
                    }

                    const codeReviewTimeline = codeReviewExecutions.map(
                        (cre) => ({
                            uuid: cre.uuid,
                            createdAt: cre.createdAt,
                            updatedAt: cre.updatedAt,
                            status: cre.status,
                            message: cre.message,
                        }),
                    );

                    // Extrair dados enriquecidos do dataExecution
                    const enrichedData = this.extractEnrichedData(
                        execution.dataExecution,
                    );

                    const enrichedPR: EnrichedPullRequestResponse = {
                        // Dados do PR
                        prId: pullRequest.uuid!,
                        prNumber: pullRequest.number,
                        title: pullRequest.title,
                        status: pullRequest.status,
                        merged: pullRequest.merged,
                        url: pullRequest.url,
                        baseBranchRef: pullRequest.baseBranchRef,
                        headBranchRef: pullRequest.headBranchRef,
                        repositoryName: pullRequest.repository.name,
                        repositoryId: pullRequest.repository.id,
                        openedAt: pullRequest.openedAt,
                        closedAt: pullRequest.closedAt,
                        createdAt: pullRequest.createdAt,
                        updatedAt: pullRequest.updatedAt,
                        provider: pullRequest.provider,
                        author: {
                            id: pullRequest.user.id,
                            username: pullRequest.user.username,
                            name: pullRequest.user.name,
                        },
                        isDraft: pullRequest.isDraft,

                        // Dados da execução de automação
                        automationExecution: {
                            uuid: execution.uuid,
                            status: execution.status,
                            errorMessage: execution.errorMessage,
                            createdAt: execution.createdAt!,
                            updatedAt: execution.updatedAt!,
                            origin: execution.origin,
                        },

                        // Timeline
                        codeReviewTimeline,

                        // Dados enriquecidos
                        enrichedData,
                    };

                    enrichedPullRequests.push(enrichedPR);
                } catch (error) {
                    this.logger.error({
                        message: 'Error processing automation execution',
                        context: GetEnrichedPullRequestsUseCase.name,
                        error,
                        metadata: {
                            executionUuid: execution.uuid,
                            prNumber: execution.pullRequestNumber,
                            repositoryId: execution.repositoryId,
                        },
                    });
                    // Continue processing other executions
                }
            }

            const assignedRepositoryIds =
                await this.authorizationService.getRepositoryScope(
                    this.request.user,
                    Action.Read,
                    ResourceType.PullRequests,
                );

            let filteredByAssignedRepos = enrichedPullRequests;
            if (assignedRepositoryIds !== null) {
                filteredByAssignedRepos = filteredByAssignedRepos.filter((pr) =>
                    assignedRepositoryIds.includes(pr.repositoryId),
                );
            }

            // 5. Ordenar por data de criação (mais recentes primeiro)
            filteredByAssignedRepos.sort(
                (a, b) =>
                    new Date(b.automationExecution.createdAt).getTime() -
                    new Date(a.automationExecution.createdAt).getTime(),
            );

            // 6. Aplicar paginação
            const totalItems = filteredByAssignedRepos.length;
            const totalPages = Math.ceil(totalItems / limit);
            const offset = (page - 1) * limit;
            const paginatedData = filteredByAssignedRepos.slice(
                offset,
                offset + limit,
            );

            const paginationMetadata: PaginationMetadata = {
                currentPage: page,
                totalPages,
                totalItems,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            };

            this.logger.log({
                message:
                    'Successfully retrieved enriched pull requests with code review history',
                context: GetEnrichedPullRequestsUseCase.name,
                metadata: {
                    organizationId,
                    totalExecutions: automationExecutions.length,
                    executionsWithPR: executionsWithPR.length,
                    filteredExecutions: filteredExecutions.length,
                    totalItems,
                    page,
                    limit,
                    returnedItems: paginatedData.length,
                },
            });

            return {
                data: paginatedData,
                pagination: paginationMetadata,
            };
        } catch (error) {
            this.logger.error({
                message: 'Error getting enriched pull requests',
                context: GetEnrichedPullRequestsUseCase.name,
                error,
                metadata: { repositoryId, repositoryName },
            });
            throw error;
        }
    }

    private extractEnrichedData(dataExecution: any) {
        if (!dataExecution) return undefined;

        return {
            repository: dataExecution.repository
                ? {
                      id: dataExecution.repository.id,
                      name: dataExecution.repository.name,
                  }
                : undefined,
            pullRequest: dataExecution.pullRequest
                ? {
                      number: dataExecution.pullRequest.number,
                      title: dataExecution.pullRequest.title,
                      url: dataExecution.pullRequest.url,
                  }
                : undefined,
            team: dataExecution.team
                ? {
                      name: dataExecution.team.name,
                      uuid: dataExecution.team.uuid,
                  }
                : undefined,
            automation: dataExecution.automation
                ? {
                      name: dataExecution.automation.name,
                      type: dataExecution.automation.type,
                  }
                : undefined,
        };
    }
}
