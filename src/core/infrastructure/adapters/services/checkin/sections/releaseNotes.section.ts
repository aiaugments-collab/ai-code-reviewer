import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    IIntegrationConfigService,
    INTEGRATION_CONFIG_SERVICE_TOKEN,
} from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { STRING_TIME_INTERVAL } from '@/core/domain/integrationConfigs/enums/stringTimeInterval.enum';
import { ColumnsConfigKey } from '@/core/domain/integrationConfigs/types/projectManagement/columns.type';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { ProjectManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/projectManagement.service';
import { PromptService } from '@/core/infrastructure/adapters/services/prompt.service';
import { IntegrationConfigKey } from '@/shared/domain/enums/Integration-config-key.enum';
import { PullRequestState } from '@/shared/domain/enums/pullRequestState.enum';
import { safelyParseMessageContent } from '@/shared/utils/safelyParseMessageContent';
import { Inject, Injectable } from '@nestjs/common';
import * as moment from 'moment-timezone';
import { PinoLoggerService } from '../../logger/pino.service';
import {
    MODEL_STRATEGIES,
    LLMModelProvider,
    LLMProviderService,
} from '@kodus/kodus-common/llm';

@Injectable()
export class ReleaseNotesSection {
    constructor(
        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IIntegrationConfigService,

        private readonly llmProviderService: LLMProviderService,

        private readonly promptService: PromptService,

        private readonly projectManagementService: ProjectManagementService,

        private readonly codeManagementService: CodeManagementService,

        private readonly logger: PinoLoggerService,
    ) {}

    id() {
        return 'releaseNotes';
    }

    name() {
        return '🚀 Release Notes';
    }

    description() {
        return 'Displays the deliveries that happened in the last 7 days.';
    }

    async execute(
        organizationAndTeamData: OrganizationAndTeamData,
        stringTimeInterval?: STRING_TIME_INTERVAL,
    ) {
        try {
            const columnsConfigKey =
                await this.integrationConfigService.findIntegrationConfigFormatted<
                    ColumnsConfigKey[]
                >(
                    IntegrationConfigKey.COLUMNS_MAPPING,
                    organizationAndTeamData,
                );

            const doneColumn = columnsConfigKey
                .filter(
                    (columnConfig: ColumnsConfigKey) =>
                        columnConfig.column === 'done',
                )
                .map((columnConfig: ColumnsConfigKey) => columnConfig.id);

            const doneTasks =
                await this.projectManagementService.getAllIssuesInWIPOrDoneMovementByPeriod(
                    {
                        organizationAndTeamData,
                        filters: {
                            statusesIds: doneColumn,
                            stringTimeInterval,
                        },
                    },
                );

            const isGitConnected =
                await this.codeManagementService.verifyConnection({
                    organizationAndTeamData,
                });

            let closedPRs;

            const startDate = moment().subtract(7, 'days').toDate();
            const endDate = moment().toDate();

            if (isGitConnected?.isSetupComplete) {
                closedPRs = await this.codeManagementService.getPullRequests({
                    organizationAndTeamData,
                    filters: {
                        state: PullRequestState.CLOSED,
                        startDate,
                        endDate,
                    },
                });
            }

            if (doneTasks?.length <= 0 && closedPRs?.length <= 0) {
                return [];
            }

            const promptGenerateWeekResume =
                await this.promptService.getCompleteContextPromptByName(
                    'prompt_releaseNotes',
                    {
                        organizationAndTeamData,
                        payload: `Closed Tasks: ${JSON.stringify(doneTasks)} \n\n ${isGitConnected ? `Closed Pull Requests: ${JSON.stringify(closedPRs)}` : ''}`,
                        promptIsForChat: false,
                    },
                );

            const llm = this.llmProviderService.getLLMProvider({
                model: MODEL_STRATEGIES[LLMModelProvider.OPENAI_GPT_4O]
                    .modelName,
                temperature: 0,
                jsonMode: true,
            });

            const categories = safelyParseMessageContent(
                (
                    await llm.invoke(
                        await promptGenerateWeekResume.format({
                            organizationAndTeamData,
                            payload: `Closed Tasks: ${JSON.stringify(doneTasks)} \n\n ${isGitConnected ? `Closed Pull Requests: ${JSON.stringify(closedPRs)}` : ''}`,
                            promptIsForChat: false,
                        }),
                        {
                            metadata: {
                                module: 'AutomationWeeklyCheckin',
                                teamId: organizationAndTeamData.teamId,
                                submodule: 'WeekResume',
                            },
                        },
                    )
                ).content,
            ).categories;

            return {
                sectionId: this.id(),
                sectionName: this.name(),
                sectionData: categories,
                possibleToMutate: false,
            };
        } catch (error) {
            this.logger.error({
                message: 'Error processing release notes section',
                context: ReleaseNotesSection.name,
                error: error,
                metadata: { organizationAndTeamData },
            });

            return {
                sectionId: this.id(),
                sectionName: this.name(),
                sectionData: [],
                possibleToMutate: false,
            };
        }
    }
}
