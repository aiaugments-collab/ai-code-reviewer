import { Injectable } from '@nestjs/common';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { RunnableSequence } from '@langchain/core/runnables';
import { CustomStringOutputParser } from '@/shared/utils/langchainCommon/customStringOutputParser';
import { tryParseJSONObject } from '@/shared/utils/transforms/json';
import { Inject } from '@nestjs/common';
import {
    prompt_kodyissues_merge_suggestions_into_issues_system,
    prompt_kodyissues_resolve_issues_system,
} from '@/shared/utils/langchainCommon/prompts/kodyIssuesManagement';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { contextToGenerateIssues } from '../kodyIssuesManagement/domain/kodyIssuesManagement.interface';
import {
    LLMProviderService,
    LLMModelProvider,
    PromptRunnerService,
    ParserType,
    PromptRole,
} from '@kodus/kodus-common/llm';

export const KODY_ISSUES_ANALYSIS_SERVICE_TOKEN = Symbol(
    'KodyIssuesAnalysisService',
);

type SystemPromptFn = () => string;
type UserPromptFn = (input: any) => string;

@Injectable()
export class KodyIssuesAnalysisService {
    constructor(
        private readonly logger: PinoLoggerService,

        private readonly llmProviderService: LLMProviderService,

        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,

        private readonly promptRunnerService: PromptRunnerService,
    ) {}

    async mergeSuggestionsIntoIssues(
        organizationAndTeamData: OrganizationAndTeamData,
        pullRequest: any,
        promptData: any,
    ): Promise<any> {
        try {
            const provider = LLMModelProvider.GEMINI_2_5_PRO;
            const fallbackProvider = LLMModelProvider.VERTEX_CLAUDE_3_5_SONNET;

            const result = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.STRING)
                .setLLMJsonMode(true)
                .setPayload(promptData)
                .addPrompt({
                    prompt: prompt_kodyissues_merge_suggestions_into_issues_system,
                    role: PromptRole.SYSTEM,
                })
                .addPrompt({
                    prompt: (input) => JSON.stringify(input, null, 2),
                    role: PromptRole.USER,
                })
                .addMetadata({
                    organizationAndTeamData: organizationAndTeamData,
                    prNumber: pullRequest.number,
                    provider: provider,
                    fallbackProvider: fallbackProvider,
                })
                .setRunName('mergeSuggestionsIntoIssues')
                .addTags([
                    ...this.buildTags(provider, 'primary'),
                    ...this.buildTags(fallbackProvider, 'fallback'),
                ])
                .setTemperature(0)
                .execute();

            if (!result) {
                const message = `No response from LLM for PR#${pullRequest.number}`;
                this.logger.warn({
                    message,
                    context: KodyIssuesAnalysisService.name,
                    metadata: {
                        organizationAndTeamData,
                        prNumber: pullRequest.number,
                    },
                });
                throw new Error(message);
            }

            return this.processLLMResponse(
                result,
                organizationAndTeamData.organizationId,
            );
        } catch (error) {
            this.logger.error({
                message: 'Error in mergeSuggestionsIntoIssues',
                context: KodyIssuesAnalysisService.name,
                error,
                metadata: {
                    organizationAndTeamData,
                    prNumber: pullRequest.number,
                },
            });
            throw error;
        }
    }

    async resolveExistingIssues(
        context: Pick<
            contextToGenerateIssues,
            'organizationAndTeamData' | 'repository' | 'pullRequest'
        >,
        promptData: any,
    ): Promise<any> {
        try {
            const provider = LLMModelProvider.GEMINI_2_5_PRO;
            const fallbackProvider = LLMModelProvider.VERTEX_CLAUDE_3_5_SONNET;

            const result = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.STRING)
                .setLLMJsonMode(true)
                .setPayload(promptData)
                .addPrompt({
                    prompt: prompt_kodyissues_resolve_issues_system,
                    role: PromptRole.SYSTEM,
                })
                .addPrompt({
                    prompt: (input) => JSON.stringify(input, null, 2),
                    role: PromptRole.USER,
                })
                .addMetadata({
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                    provider: provider,
                    fallbackProvider: fallbackProvider,
                })
                .setRunName('resolveExistingIssues')
                .addTags([
                    ...this.buildTags(provider, 'primary'),
                    ...this.buildTags(fallbackProvider, 'fallback'),
                ])
                .setTemperature(0)
                .execute();

            if (!result) {
                const message = `No response from LLM for PR#${context.pullRequest.number}`;
                this.logger.warn({
                    message,
                    context: KodyIssuesAnalysisService.name,
                    metadata: {
                        organizationAndTeamData:
                            context.organizationAndTeamData,
                        prNumber: context.pullRequest.number,
                    },
                });
                throw new Error(message);
            }

            return this.processLLMResponse(
                result,
                context.organizationAndTeamData.organizationId,
            );
        } catch (error) {
            this.logger.error({
                message: 'Error in resolveExistingIssues',
                context: KodyIssuesAnalysisService.name,
                error,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                },
            });
            throw error;
        }
    }

    private buildTags(
        provider: LLMModelProvider,
        tier: 'primary' | 'fallback',
    ) {
        return [`model:${provider}`, `tier:${tier}`, 'kodyIssues'];
    }

    private processLLMResponse(response: string, organizationId: string): any {
        try {
            if (!response) {
                return null;
            }

            let cleanResponse = response;
            if (response.startsWith('```')) {
                cleanResponse = response
                    .replace(/^```json\n/, '')
                    .replace(/\n```(\n)?$/, '')
                    .trim();
            }

            const parsedResponse = tryParseJSONObject(cleanResponse);

            if (!parsedResponse) {
                this.logger.error({
                    message: 'Failed to parse LLM response',
                    context: KodyIssuesAnalysisService.name,
                    metadata: { originalResponse: response, organizationId },
                });
                return null;
            }

            return parsedResponse;
        } catch (error) {
            this.logger.error({
                message: 'Error processing LLM response',
                context: KodyIssuesAnalysisService.name,
                error,
                metadata: { response, organizationId },
            });
            return null;
        }
    }
}
