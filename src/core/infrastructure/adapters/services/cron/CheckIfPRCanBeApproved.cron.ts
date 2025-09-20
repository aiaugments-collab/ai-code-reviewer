import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLoggerService } from '../logger/pino.service';
import {
    TEAM_SERVICE_TOKEN,
    ITeamService,
} from '@/core/domain/team/contracts/team.service.contract';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { IntegrationCategory } from '@/shared/domain/enums/integration-category.enum';
import { IntegrationStatusFilter } from '@/core/domain/team/interfaces/team.interface';
import { STATUS } from '@/config/types/database/status.type';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { PullRequestsEntity } from '@/core/domain/pullRequests/entities/pullRequests.entity';
import {
    IPullRequestsService,
    PULL_REQUESTS_SERVICE_TOKEN,
} from '@/core/domain/pullRequests/contracts/pullRequests.service.contracts';
import { CodeManagementService } from '../platformIntegration/codeManagement.service';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import {
    CodeReviewConfig,
    CodeReviewConfigWithRepositoryInfo,
} from '@/config/types/general/codeReview.type';
import { PullRequestState } from '@/shared/domain/enums/pullRequestState.enum';
import { AzureRepoCommentTypeString } from '@/core/domain/azureRepos/entities/azureRepoExtras.type';
import {
    AUTOMATION_EXECUTION_SERVICE_TOKEN,
    IAutomationExecutionService,
} from '@/core/domain/automation/contracts/automation-execution.service';
import { AutomationStatus } from '@/core/domain/automation/enums/automation-status';
import { AutomationType } from '@/core/domain/automation/enums/automation-type';
import {
    AUTOMATION_SERVICE_TOKEN,
    IAutomationService,
} from '@/core/domain/automation/contracts/automation.service';
import {
    TEAM_AUTOMATION_SERVICE_TOKEN,
    ITeamAutomationService,
} from '@/core/domain/automation/contracts/team-automation.service';

const API_CRON_CHECK_IF_PR_SHOULD_BE_APPROVED =
    process.env.API_CRON_CHECK_IF_PR_SHOULD_BE_APPROVED;

@Injectable()
export class CheckIfPRCanBeApprovedCronProvider {
    constructor(
        private readonly logger: PinoLoggerService,

        @Inject(TEAM_SERVICE_TOKEN)
        private readonly teamService: ITeamService,

        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,

        @Inject(PULL_REQUESTS_SERVICE_TOKEN)
        private readonly pullRequestService: IPullRequestsService,

        private readonly codeManagementService: CodeManagementService,

        @Inject(AUTOMATION_EXECUTION_SERVICE_TOKEN)
        private readonly automationExecutionService: IAutomationExecutionService,

        @Inject(AUTOMATION_SERVICE_TOKEN)
        private readonly automationService: IAutomationService,

        @Inject(TEAM_AUTOMATION_SERVICE_TOKEN)
        private readonly teamAutomationService: ITeamAutomationService,
    ) {}

    @Cron(API_CRON_CHECK_IF_PR_SHOULD_BE_APPROVED, {
        name: 'CHECK IF PR SHOULD BE APPROVED',
        timeZone: 'America/Sao_Paulo',
    })
    async handleCron() {
        try {
            this.logger.log({
                message: 'Check if PR can be approved cron started',
                context: CheckIfPRCanBeApprovedCronProvider.name,
                metadata: {
                    timestamp: new Date().toISOString(),
                },
            });

            const teams = await this.teamService.findTeamsWithIntegrations({
                integrationCategories: [IntegrationCategory.CODE_MANAGEMENT],
                integrationStatus: IntegrationStatusFilter.CONFIGURED,
                status: STATUS.ACTIVE,
            });

            if (!teams || teams.length === 0) {
                this.logger.log({
                    message: 'No teams found',
                    context: CheckIfPRCanBeApprovedCronProvider.name,
                    metadata: {
                        timestamp: new Date().toISOString(),
                    },
                });

                return;
            }

            for (const team of teams) {
                const organizationId = team.organization?.uuid;
                const teamId = team.uuid;

                const organizationAndTeamData: OrganizationAndTeamData = {
                    organizationId,
                    teamId,
                };

                const codeReviewParameter =
                    await this.parametersService.findByKey(
                        ParametersKey.CODE_REVIEW_CONFIG,
                        organizationAndTeamData,
                    );

                if (!codeReviewParameter || !codeReviewParameter?.configValue) {
                    this.logger.error({
                        message: 'Code review parameter configs not found',
                        context: CheckIfPRCanBeApprovedCronProvider.name,
                        metadata: {
                            timestamp: new Date().toISOString(),
                            organizationAndTeamData,
                        },
                    });

                    continue;
                }

                const codeReviewConfig = codeReviewParameter?.configValue as {
                    global: CodeReviewConfig;
                    repositories: CodeReviewConfigWithRepositoryInfo[];
                };

                if (
                    !codeReviewParameter ||
                    !codeReviewConfig ||
                    !Array.isArray(codeReviewConfig.repositories) ||
                    codeReviewConfig.repositories.length < 1
                ) {
                    this.logger.error({
                        message:
                            'No repositories were found on the code review parameter config value',
                        context: CheckIfPRCanBeApprovedCronProvider.name,
                        metadata: {
                            organizationAndTeamData,
                            timestamp: new Date().toISOString(),
                        },
                    });

                    continue;
                }

                const codeReviewAutomation = await this.automationService.find({
                    automationType: AutomationType.AUTOMATION_CODE_REVIEW,
                });

                if (
                    !codeReviewAutomation ||
                    codeReviewAutomation.length === 0
                ) {
                    this.logger.error({
                        message: 'Code review automation not found',
                        context: CheckIfPRCanBeApprovedCronProvider.name,
                        metadata: {
                            organizationAndTeamData,
                            timestamp: new Date().toISOString(),
                        },
                    });
                    continue;
                }

                const teamAutomation = await this.teamAutomationService.find({
                    team: { uuid: team.uuid },
                    automation: { uuid: codeReviewAutomation[0].uuid },
                });

                if (!teamAutomation || teamAutomation.length === 0) {
                    this.logger.error({
                        message: 'Team automation for code review not found',
                        context: CheckIfPRCanBeApprovedCronProvider.name,
                        metadata: {
                            organizationAndTeamData,
                            timestamp: new Date().toISOString(),
                        },
                    });
                    continue;
                }

                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                const automationExecutions =
                    await this.automationExecutionService.findByPeriodAndTeamAutomationId(
                        sevenDaysAgo,
                        new Date(),
                        teamAutomation[0].uuid,
                    );

                const automationExecutionsPRs = automationExecutions?.map(
                    (execution) => execution?.dataExecution?.pullRequestNumber,
                );

                const openPullRequests = await this.pullRequestService.find({
                    status: PullRequestState.OPENED,
                    organizationId: organizationId,
                    number: { $in: automationExecutionsPRs },
                } as any);

                this.logger.log({
                    message: 'Open pull requests found',
                    context: CheckIfPRCanBeApprovedCronProvider.name,
                    metadata: {
                        openPullRequests: openPullRequests?.length,
                        organizationAndTeamData: {
                            organizationId,
                            teamId,
                        },
                    },
                });

                if (!openPullRequests || openPullRequests?.length === 0) {
                    continue;
                }

                openPullRequests?.map(async (pr) => {
                    const repository = pr.repository;

                    const codeReviewConfigFromRepo =
                        codeReviewConfig?.repositories?.find(
                            (codeReviewConfigRepo) =>
                                codeReviewConfigRepo.id === repository.id,
                        );

                    if (
                        !codeReviewConfig?.global?.pullRequestApprovalActive &&
                        !codeReviewConfigFromRepo?.pullRequestApprovalActive
                    ) {
                        return;
                    }

                    if (
                        codeReviewConfigFromRepo?.pullRequestApprovalActive ===
                        false
                    ) {
                        return;
                    }

                    await this.shouldApprovePR({
                        organizationAndTeamData,
                        pr,
                    });
                });
            }
        } catch (error) {
            this.logger.error({
                message: 'Error checking if PR can be approved generator cron',
                context: CheckIfPRCanBeApprovedCronProvider.name,
                error,
                metadata: {
                    timestamp: new Date().toISOString(),
                },
            });
        }
    }

    private async shouldApprovePR({
        organizationAndTeamData,
        pr,
    }: {
        organizationAndTeamData: OrganizationAndTeamData;
        pr: PullRequestsEntity;
    }): Promise<boolean> {
        const repository = pr.repository;
        const prNumber = pr.number;
        const platformType = pr.provider as PlatformType;

        const codeManagementRequestData = {
            organizationAndTeamData,
            repository: {
                id: repository.id,
                name: repository.name,
            },
            prNumber: prNumber,
        };
        try {
            let isPlatformTypeGithub: boolean =
                platformType === PlatformType.GITHUB;

            let reviewComments: any[];
            if (isPlatformTypeGithub) {
                reviewComments =
                    await this.codeManagementService.getPullRequestReviewThreads(
                        codeManagementRequestData,
                        PlatformType.GITHUB,
                    );
            } else {
                reviewComments =
                    await this.codeManagementService.getPullRequestReviewComments(
                        codeManagementRequestData,
                        platformType,
                    );
            }

            this.logger.log({
                message: `Review comments found for PR#${prNumber}`,
                context: CheckIfPRCanBeApprovedCronProvider.name,
                metadata: {
                    reviewComments: reviewComments?.length,
                    organizationAndTeamData,
                    prNumber,
                    repository: {
                        name: repository.name,
                        id: repository.id,
                    },
                },
            });

            if (platformType === PlatformType.AZURE_REPOS) {
                reviewComments = reviewComments.filter(
                    (comment) =>
                        comment?.commentType ===
                        AzureRepoCommentTypeString.CODE,
                );
            }

            if (!reviewComments || reviewComments.length < 1) {
                return false;
            }

            const isEveryReviewCommentResolved = reviewComments?.every(
                (reviewComment) => reviewComment.isResolved,
            );

            if (isEveryReviewCommentResolved) {
                this.logger.log({
                    message: `Is every review comment resolved for PR#${prNumber}`,
                    context: CheckIfPRCanBeApprovedCronProvider.name,
                    metadata: {
                        isEveryReviewCommentResolved,
                        organizationAndTeamData,
                        prNumber,
                        repository: {
                            name: repository.name,
                            id: repository.id,
                        },
                    },
                });

                await this.codeManagementService.checkIfPullRequestShouldBeApproved(
                    {
                        organizationAndTeamData,
                        prNumber,
                        repository: {
                            name: repository.name,
                            id: repository.id,
                        },
                    },
                    platformType,
                );
                return true;
            }
        } catch (error) {
            this.logger.error({
                message: 'Error in shouldApprovePR',
                context: CheckIfPRCanBeApprovedCronProvider.name,
                metadata: {
                    organizationAndTeamData,
                    platformType,
                    prNumber: pr.number,
                    repository: {
                        name: repository.name,
                        id: repository.id,
                    },
                },
                error,
            });

            return false;
        }
    }
}
