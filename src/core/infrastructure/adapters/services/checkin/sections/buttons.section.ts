import { Inject, Injectable } from '@nestjs/common';
import { PinoLoggerService } from '../../logger/pino.service';
import { safelyParseMessageContent } from '@/shared/utils/safelyParseMessageContent';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PromptService } from '../../prompt.service';
import {
    MODEL_STRATEGIES,
    LLMModelProvider,
    LLMProviderService,
} from '@kodus/kodus-common/llm';

@Injectable()
export class ButtonsSection {
    constructor(
        private readonly llmProviderService: LLMProviderService,

        private readonly logger: PinoLoggerService,

        private readonly promptService: PromptService,
    ) {}

    id() {
        return 'buttons';
    }

    name() {
        return '🎮 Deep Dive Buttons';
    }

    description() {
        return 'Displays deep dive buttons';
    }

    required() {
        return true;
    }

    async execute(
        organizationAndTeamData: OrganizationAndTeamData,
        sections: any,
        teamId: string,
    ) {
        const dynamicButtons = await this.generateDynamicButtons(
            organizationAndTeamData,
            sections,
        );
        const defaultButtons = this.generateDefaultButtons(teamId);

        const allButtons = [...dynamicButtons, ...defaultButtons];

        return {
            sectionId: this.id(),
            sectionName: this.name(),
            sectionData: allButtons,
            possibleToMutate: false,
        };
    }

    private async generateDynamicButtons(
        organizationAndTeamData,
        sections: any,
    ) {
        const promptGenerateWeekResume =
            await this.promptService.getCompleteContextPromptByName(
                'prompt_weeklyCheckinQuestions',
                {
                    organizationAndTeamData,
                    payload: JSON.stringify(sections),
                    promptIsForChat: false,
                },
            );

        const llm = this.llmProviderService.getLLMProvider({
            model: LLMModelProvider.OPENAI_GPT_4O,
            temperature: 0,
            jsonMode: true,
        });

        const { buttons } = safelyParseMessageContent(
            (
                await llm.invoke(
                    await promptGenerateWeekResume.format({
                        organizationAndTeamData,
                        payload: JSON.stringify(sections),
                        promptIsForChat: false,
                    }),
                    {
                        metadata: {
                            module: 'CheckinSections',
                            teamId: organizationAndTeamData.teamId,
                            submodule: 'GenerateDynamicButtons',
                        },
                    },
                )
            ).content,
        );

        return buttons;
    }

    private generateDefaultButtons(teamId: string) {
        return [
            {
                type: 'button_link',
                text: 'View in cockpit',
                url: 'https://app.kodus.io/cockpit',
            },
            {
                type: 'button_link',
                text: 'Muted items control',
                url: `https://app.kodus.io/teams/parameters/${teamId}/kody`,
            },
        ];
    }
}
