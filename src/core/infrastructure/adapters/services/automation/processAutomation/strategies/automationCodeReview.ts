import {
    AUTOMATION_EXECUTION_SERVICE_TOKEN,
    IAutomationExecutionService,
} from '@/core/domain/automation/contracts/automation-execution.service';
import {
    AUTOMATION_SERVICE_TOKEN,
    IAutomationService,
} from '@/core/domain/automation/contracts/automation.service';
import { IAutomationFactory } from '@/core/domain/automation/contracts/processAutomation/automation.factory';
import {
    ITeamAutomationService,
    TEAM_AUTOMATION_SERVICE_TOKEN,
} from '@/core/domain/automation/contracts/team-automation.service';
import { AutomationType } from '@/core/domain/automation/enums/automation-type';
import { Inject, Injectable } from '@nestjs/common';
import { IAutomation } from '@/core/domain/automation/interfaces/automation.interface';
import { ITeamAutomation } from '@/core/domain/automation/interfaces/team-automation.interface';
import { AutomationStatus } from '@/core/domain/automation/enums/automation-status';
import { PinoLoggerService } from '../../../logger/pino.service';
import { CodeReviewHandlerService } from '../../../codeBase/codeReviewHandlerService.service';
import { IAutomationExecution } from '@/core/domain/automation/interfaces/automation-execution.interface';
import {
    IOrganizationService,
    ORGANIZATION_SERVICE_TOKEN,
} from '@/core/domain/organization/contracts/organization.service.contract';
import {
    CODE_REVIEW_EXECUTION_SERVICE,
    ICodeReviewExecutionService,
} from '@/core/domain/codeReviewExecutions/contracts/codeReviewExecution.service.contract';
import { stat } from 'fs';

@Injectable()
export class AutomationCodeReviewService
    implements Omit<IAutomationFactory, 'stop'>
{
    automationType = AutomationType.AUTOMATION_CODE_REVIEW;

    constructor(
        @Inject(TEAM_AUTOMATION_SERVICE_TOKEN)
        private readonly teamAutomationService: ITeamAutomationService,

        @Inject(AUTOMATION_SERVICE_TOKEN)
        private readonly automationService: IAutomationService,

        @Inject(AUTOMATION_EXECUTION_SERVICE_TOKEN)
        private readonly automationExecutionService: IAutomationExecutionService,

        @Inject(ORGANIZATION_SERVICE_TOKEN)
        private readonly organizationService: IOrganizationService,

        private readonly codeReviewHandlerService: CodeReviewHandlerService,

        @Inject(CODE_REVIEW_EXECUTION_SERVICE)
        private readonly codeReviewExecutionService: ICodeReviewExecutionService,

        private readonly logger: PinoLoggerService,
    ) {}

    async setup(payload?: any): Promise<any> {
        try {
            // Fetch automation ID
            const automation: IAutomation = (
                await this.automationService.find({
                    automationType: this.automationType,
                })
            )[0];

            const teamAutomation: ITeamAutomation = {
                status: false,
                automation: {
                    uuid: automation.uuid,
                },
                team: {
                    uuid: payload.teamId,
                },
            };

            await this.teamAutomationService.register(teamAutomation);
        } catch (error) {
            this.logger.error({
                message: 'Error creating automation for the team',
                context: AutomationCodeReviewService.name,
                error: error,
                metadata: payload,
            });
        }
    }

    async run?(payload?: any): Promise<any> {
        const {
            organizationAndTeamData,
            repository,
            branch,
            pullRequest,
            platformType,
            teamAutomationId,
            origin,
            action,
        } = payload;

        let execution: IAutomationExecution | null = null;

        try {
            this.logger.log({
                message: `Started Handling pull request for ${repository?.name} - ${branch} - PR#${pullRequest?.number}`,
                context: AutomationCodeReviewService.name,
                metadata: {
                    organizationAndTeamData,
                },
            });

            const organization = await this.organizationService.findOne({
                uuid: organizationAndTeamData.organizationId,
                status: true,
            });

            if (!organization) {
                this.logger.warn({
                    message: `No organization found with ID ${organizationAndTeamData.organizationId}`,
                    context: AutomationCodeReviewService.name,
                    metadata: {
                        organizationAndTeamData,
                        repository,
                        pullRequestNumber: pullRequest?.number,
                    },
                });
                return 'No organization found for the provided ID';
            }

            execution = await this.createAutomationExecution(
                payload,
                AutomationStatus.IN_PROGRESS, // in the future maybe pending?
                'Automation started',
            );
            if (!execution) {
                this.logger.warn({
                    message: `Could not create code review execution for PR #${pullRequest?.number}`,
                    context: AutomationCodeReviewService.name,
                    metadata: {
                        organizationAndTeamData,
                        repository,
                        pullRequestNumber: pullRequest?.number,
                    },
                });
                return 'Could not create code review execution';
            }

            const result =
                await this.codeReviewHandlerService.handlePullRequest(
                    {
                        ...organizationAndTeamData,
                        organizationName: organization.name,
                    },
                    repository,
                    branch,
                    pullRequest,
                    platformType,
                    teamAutomationId,
                    origin || 'automation',
                    action,
                );

            await this._handleExecutionCompletion(execution, result, payload);
            return 'Automation executed successfully';
        } catch (error) {
            await this._handleExecutionError(execution, error, payload);
            return 'Error executing automation';
        }
    }

    private async createAutomationExecution(
        payload: any,
        status: AutomationStatus,
        message: string,
    ) {
        const {
            organizationAndTeamData,
            pullRequest,
            repository,
            teamAutomationId,
            platformType,
            origin,
        } = payload;

        try {
            return await this.automationExecutionService.createCodeReview(
                {
                    status,
                    dataExecution: {
                        platformType,
                        organizationAndTeamData,
                        pullRequestNumber: pullRequest?.number,
                        repositoryId: repository?.id,
                    },
                    teamAutomation: { uuid: teamAutomationId },
                    origin: origin || 'System',
                    pullRequestNumber: pullRequest?.number,
                    repositoryId: repository?.id,
                },
                message,
            );
        } catch (error) {
            this.logger.error({
                message: 'Error creating automation execution',
                context: AutomationCodeReviewService.name,
                error,
                metadata: { teamAutomationId, status },
            });
            return null;
        }
    }

    private async updateAutomationExecution(
        entity: IAutomationExecution,
        status: AutomationStatus,
        message: string,
        data: any,
    ) {
        try {
            const errorMessage = [
                AutomationStatus.ERROR,
                AutomationStatus.SKIPPED,
            ].includes(status)
                ? message
                : undefined;

            await this.automationExecutionService.updateCodeReview(
                { uuid: entity.uuid },
                {
                    status,
                    dataExecution: { ...entity.dataExecution, ...data },
                    errorMessage,
                },
                message,
            );
        } catch (error) {
            this.logger.error({
                message: 'Error updating automation execution',
                context: AutomationCodeReviewService.name,
                error,
                metadata: { executionUuid: entity.uuid, status },
            });
        }
    }

    private async _handleExecutionCompletion(
        execution: IAutomationExecution,
        result: any,
        payload: any,
    ) {
        if (!result) {
            await this.updateAutomationExecution(
                execution,
                AutomationStatus.ERROR,
                'Error processing the pull request: handler returned no result.',
                this._buildExecutionData(payload),
            );
            return;
        }

        const finalStatus =
            result.statusInfo?.status || AutomationStatus.SUCCESS;
        const finalMessage =
            result.statusInfo?.message || 'Automation completed successfully.';
        const newData = this._buildExecutionData(payload, result);

        await this.updateAutomationExecution(
            execution,
            finalStatus,
            finalMessage,
            newData,
        );

        this.logger.log({
            message: `Successfully handled pull request for PR#${payload.pullRequest?.number}`,
            context: AutomationCodeReviewService.name,
            metadata: {
                organizationAndTeamData: payload.organizationAndTeamData,
                ...result,
            },
        });
    }

    private async _handleExecutionError(
        execution: IAutomationExecution,
        error: any,
        payload: any,
    ) {
        const errorMessage =
            error.message ||
            'An unexpected error occurred during code review automation.';

        this.logger.error({
            message: errorMessage,
            context: AutomationCodeReviewService.name,
            error,
            metadata: payload,
        });

        await this.updateAutomationExecution(
            execution,
            AutomationStatus.ERROR,
            errorMessage,
            this._buildExecutionData(payload),
        );
    }

    private _buildExecutionData(payload: any, result?: any): any {
        const {
            codeManagementEvent,
            platformType,
            organizationAndTeamData,
            pullRequest,
            repository,
        } = payload;

        const baseData = {
            codeManagementEvent,
            platformType,
            organizationAndTeamData,
            pullRequestNumber: pullRequest?.number,
            repositoryId: repository?.id,
        };

        if (!result) {
            return baseData;
        }

        const validLastAnalyzedCommit =
            result.lastAnalyzedCommit &&
            typeof result.lastAnalyzedCommit === 'object' &&
            Object.keys(result.lastAnalyzedCommit).length > 0;

        if (validLastAnalyzedCommit) {
            Object.assign(baseData, {
                lastAnalyzedCommit: result.lastAnalyzedCommit,
                commentId: result.commentId,
                noteId: result.noteId,
                threadId: result.threadId,
                automaticReviewStatus: result.automaticReviewStatus,
            });
        }

        return baseData;
    }
}
