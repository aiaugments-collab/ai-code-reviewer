import { Inject, Injectable } from '@nestjs/common';
import {
    FileChangeContext,
    AnalysisContext,
    AIAnalysisResult,
    CodeSuggestion,
    ReviewModeResponse,
    ReviewOptions,
    SuggestionControlConfig,
} from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { tryParseJSONObject } from '@/shared/utils/transforms/json';
import Anthropic from '@anthropic-ai/sdk';
import { getKodyRulesForFile } from '@/shared/utils/glob-utils';
import {
    KodyRulesClassifierSchema,
    kodyRulesClassifierSchema,
    prompt_kodyrules_classifier_system,
    prompt_kodyrules_classifier_user,
    prompt_kodyrules_extract_id_system,
    prompt_kodyrules_extract_id_user,
    prompt_kodyrules_guardian_system,
    prompt_kodyrules_guardian_user,
    prompt_kodyrules_suggestiongeneration_system,
    prompt_kodyrules_suggestiongeneration_user,
    prompt_kodyrules_updatestdsuggestions_system,
    prompt_kodyrules_updatestdsuggestions_user,
} from '@/shared/utils/langchainCommon/prompts/kodyRules';
import {
    IKodyRule,
    KodyRulesScope,
} from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import { IAIAnalysisService } from '@/core/domain/codeBase/contracts/AIAnalysisService.contract';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { KodyRulesService } from '../kodyRules/service/kodyRules.service';
import { KODY_RULES_SERVICE_TOKEN } from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { LabelType } from '@/shared/utils/codeManagement/labels';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { IKodyRulesAnalysisService } from '@/core/domain/codeBase/contracts/KodyRulesAnalysisService.contract';
import {
    LLMProviderService,
    LLMModelProvider,
    PromptRunnerService,
    ParserType,
    PromptRole,
} from '@kodus/kodus-common/llm';
import { z } from 'zod';

// Interface for extended context used in Kody Rules analysis
interface KodyRulesExtendedContext {
    // Properties from base context (prepareAnalysisContext)
    pullRequest: any;
    patchWithLinesStr: string;
    maxSuggestionsParams?: number;
    language?: string;
    filePath: string;
    languageResultPrompt?: string;
    reviewOptions?: ReviewOptions;
    fileContent?: string;
    limitationType?: string;
    severityLevelFilter?: SeverityLevel;
    organizationAndTeamData: OrganizationAndTeamData;
    kodyRules: Array<Partial<IKodyRule>>;

    // Extended properties added during analysis
    standardSuggestions?: AIAnalysisResult;
    updatedSuggestions?: AIAnalysisResult;
    filteredKodyRules?: Array<Partial<IKodyRule>>;
}

// Interface for token tracking
interface TokenUsage {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    model?: string;
    runId?: string;
    parentRunId?: string;
}

// Handler for token tracking
class TokenTrackingHandler extends BaseCallbackHandler {
    name = 'TokenTrackingHandler';
    tokenUsages: TokenUsage[] = [];

    private extractUsageMetadata(output: any): TokenUsage {
        try {
            // Attempts to extract information from different locations in the response
            const usage: TokenUsage = {};

            // Extracts token information
            if (output?.llmOutput?.tokenUsage) {
                Object.assign(usage, output.llmOutput.tokenUsage);
            } else if (output?.llmOutput?.usage) {
                Object.assign(usage, output.llmOutput.usage);
            } else if (output?.generations?.[0]?.[0]?.message?.usage_metadata) {
                const metadata =
                    output.generations[0][0].message.usage_metadata;
                usage.input_tokens = metadata.input_tokens;
                usage.output_tokens = metadata.output_tokens;
                usage.total_tokens = metadata.total_tokens;
            }

            // Extracts model
            usage.model =
                output?.llmOutput?.model ||
                output?.generations?.[0]?.[0]?.message?.response_metadata
                    ?.model ||
                'unknown';

            return usage;
        } catch (error) {
            console.error('Error extracting usage metadata:', error);
            return {};
        }
    }

    async handleLLMEnd(
        output: any,
        runId: string,
        parentRunId?: string,
        tags?: string[],
    ) {
        const usage = this.extractUsageMetadata(output);

        if (Object.keys(usage).length > 0) {
            this.tokenUsages.push({
                ...usage,
                runId,
                parentRunId,
            });
        }
    }

    getTokenUsages(): TokenUsage[] {
        return this.tokenUsages;
    }

    reset() {
        this.tokenUsages = [];
    }
}

export const KODY_RULES_ANALYSIS_SERVICE_TOKEN = Symbol(
    'KodyRulesAnalysisService',
);

type SystemPromptFn = () => string;
type UserPromptFn = (input: any) => string;

@Injectable()
export class KodyRulesAnalysisService implements IKodyRulesAnalysisService {
    private readonly anthropic: Anthropic;
    private readonly tokenTracker: TokenTrackingHandler;

    @Inject(KODY_RULES_SERVICE_TOKEN)
    private readonly kodyRulesService: KodyRulesService;

    constructor(
        private readonly logger: PinoLoggerService,
        private readonly promptRunnerService: PromptRunnerService,
    ) {
        this.anthropic = new Anthropic({
            apiKey: process.env.API_ANTHROPIC_API_KEY,
        });
        this.tokenTracker = new TokenTrackingHandler();
    }

    private async buildKodyRuleLinkAndRepalceIds(
        foundIds: string[],
        updatedContent: string,
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
    ): Promise<string> {
        // Processar todos os IDs encontrados
        for (const ruleId of foundIds) {
            try {
                const rule = await this.kodyRulesService.findById(ruleId);

                if (!rule) {
                    continue;
                }

                const baseUrl = process.env.API_USER_INVITE_BASE_URL || '';
                let ruleLink: string;

                if (rule.repositoryId === 'global') {
                    ruleLink = `${baseUrl}/settings/code-review/global/kody-rules/${ruleId}`;
                } else {
                    ruleLink = `${baseUrl}/settings/code-review/${rule.repositoryId}/kody-rules/${ruleId}`;
                }

                const escapeMarkdownSyntax = (text: string): string =>
                    text.replace(/([\[\]\\`*_{}()#+\-.!])/g, '\\$1');
                const markdownLink = `[${escapeMarkdownSyntax(rule.title)}](${ruleLink})`;

                // Verificar se o ID está entre crases simples `id`
                const singleBacktickPattern = new RegExp(
                    `\`${this.escapeRegex(ruleId)}\``,
                    'g',
                );
                if (singleBacktickPattern.test(updatedContent)) {
                    updatedContent = updatedContent.replace(
                        singleBacktickPattern,
                        markdownLink,
                    );
                    continue;
                }

                // Verificar se o ID está entre blocos de código ```id```
                const tripleBacktickPattern = new RegExp(
                    `\`\`\`${this.escapeRegex(ruleId)}\`\`\``,
                    'g',
                );
                if (tripleBacktickPattern.test(updatedContent)) {
                    updatedContent = updatedContent.replace(
                        tripleBacktickPattern,
                        markdownLink,
                    );
                    continue;
                }

                const idPattern = new RegExp(this.escapeRegex(ruleId), 'g');
                updatedContent = updatedContent.replace(
                    idPattern,
                    markdownLink,
                );
            } catch (error) {
                this.logger.error({
                    message: 'Error fetching Kody Rule details',
                    context: KodyRulesAnalysisService.name,
                    error: error,
                    metadata: {
                        ruleId,
                        organizationAndTeamData,
                        prNumber,
                    },
                });
                continue;
            }
        }

        return updatedContent;
    }

    // Função auxiliar para escapar caracteres especiais no regex
    private escapeRegex(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private async replaceKodyRuleIdsWithLinks(
        suggestions: AIAnalysisResult,
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
    ): Promise<AIAnalysisResult> {
        if (!suggestions?.codeSuggestions?.length) {
            return suggestions;
        }

        const updatedSuggestions = await Promise.all(
            suggestions.codeSuggestions.map(async (suggestion) => {
                try {
                    if (suggestion?.label === LabelType.KODY_RULES) {
                        let updatedContent =
                            suggestion?.suggestionContent || '';

                        const uuidRegex =
                            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
                        let foundIds: string[] =
                            updatedContent.match(uuidRegex) || [];

                        if (!foundIds?.length) {
                            let extractedIds: string[] = [];

                            const brokenIds = (suggestion as any)
                                ?.brokenKodyRulesIds;

                            const violatedIds = (suggestion as any)
                                ?.violatedKodyRulesIds;

                            if (suggestion?.suggestionContent) {
                                if (brokenIds?.length > 0) {
                                    const firstRuleId = brokenIds[0];
                                    updatedContent += `\n\nKody Rule violation: ${firstRuleId}`;
                                    foundIds = [firstRuleId];
                                } else if (violatedIds?.length > 0) {
                                    const firstRuleId = violatedIds[0];
                                    updatedContent += `\n\nKody Rule violation: ${firstRuleId}`;
                                    foundIds = [firstRuleId];
                                } else {
                                    extractedIds =
                                        await this.extractKodyRuleIdsFromContent(
                                            updatedContent,
                                            organizationAndTeamData,
                                            prNumber,
                                            suggestion,
                                        );
                                    if (extractedIds.length > 0) {
                                        foundIds = extractedIds;
                                    }
                                }
                            }
                        }

                        const updatedContentWithLinks =
                            await this.buildKodyRuleLinkAndRepalceIds(
                                foundIds,
                                updatedContent,
                                organizationAndTeamData,
                                prNumber,
                            );

                        return {
                            ...suggestion,
                            suggestionContent: updatedContentWithLinks,
                        };
                    }

                    return suggestion;
                } catch (error) {
                    this.logger.error({
                        message:
                            'Error processing suggestion for Kody Rule links',
                        context: KodyRulesAnalysisService.name,
                        error,
                        metadata: {
                            suggestionId: suggestion.id,
                            organizationAndTeamData,
                            prNumber,
                        },
                    });
                    return suggestion;
                }
            }),
        );

        return {
            ...suggestions,
            codeSuggestions: updatedSuggestions,
        };
    }

    private async extractKodyRuleIdsFromContent(
        updatedContent: string,
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        suggestion: Partial<CodeSuggestion>,
    ): Promise<string[]> {
        try {
            const provider = LLMModelProvider.GEMINI_2_5_FLASH;
            const fallbackProvider = LLMModelProvider.GEMINI_2_5_PRO;

            const extraction = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.STRING)
                .setLLMJsonMode(true)
                .setPayload({
                    suggestionContent: updatedContent,
                })
                .addPrompt({
                    prompt: prompt_kodyrules_extract_id_system,
                    role: PromptRole.SYSTEM,
                })
                .addPrompt({
                    prompt: prompt_kodyrules_extract_id_user,
                    role: PromptRole.USER,
                })
                .addMetadata({
                    organizationId: organizationAndTeamData?.organizationId,
                    teamId: organizationAndTeamData?.teamId,
                    pullRequestId: prNumber,
                    provider: provider,
                    fallbackProvider: fallbackProvider,
                })
                .addCallbacks([this.tokenTracker])
                .addTags([
                    ...this.buildTags(provider, 'primary'),
                    ...this.buildTags(fallbackProvider, 'fallback'),
                ])
                .setRunName('extractKodyRuleIdsFromContent')
                .setTemperature(0)
                .execute();

            if (!extraction) {
                const message = `No Kody Rule IDs extracted from content for PR#${prNumber}`;
                this.logger.warn({
                    message,
                    context: KodyRulesAnalysisService.name,
                    metadata: {
                        organizationAndTeamData,
                        prNumber,
                        suggestionId: suggestion.id,
                    },
                });
                throw new Error(message);
            }

            if (extraction) {
                const cleanResponse = extraction.replace(/```json\n|```/g, '');
                const parsedIds = tryParseJSONObject(cleanResponse);

                if (parsedIds?.ids?.length) {
                    return parsedIds.ids;
                }
            }
        } catch (error) {
            this.logger.error({
                message: 'Error in LLM fallback for ID extraction',
                context: KodyRulesAnalysisService.name,
                error,
                metadata: {
                    suggestionId: suggestion.id,
                    organizationAndTeamData,
                    prNumber,
                },
            });
        }

        return [];
    }

    async analyzeCodeWithAI(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        fileContext: FileChangeContext,
        reviewModeResponse: ReviewModeResponse.HEAVY_MODE,
        context: AnalysisContext,
        suggestions?: AIAnalysisResult,
    ): Promise<AIAnalysisResult> {
        const hasCodeSuggestions =
            !!suggestions &&
            !!suggestions?.codeSuggestions &&
            suggestions?.codeSuggestions?.length > 0;

        const provider = LLMModelProvider.GEMINI_2_5_PRO;
        const fallbackProvider = LLMModelProvider.VERTEX_CLAUDE_3_5_SONNET;
        // Reset token tracking for new analysis
        this.tokenTracker.reset();

        // Prepare base context
        const baseContext = await this.prepareAnalysisContext(
            fileContext,
            context,
        );

        // Verify if there are Kody Rules applicable for this file
        if (!baseContext.kodyRules?.length) {
            this.logger.log({
                message: `No Kody Rules applicable for file: ${fileContext?.file?.filename} from PR#${prNumber}`,
                context: KodyRulesAnalysisService.name,
                metadata: {
                    organizationAndTeamData,
                    prNumber,
                    filename: fileContext?.file?.filename,
                    kodyRulesCount: baseContext.kodyRules?.length || 0,
                },
            });

            return {
                codeSuggestions: [],
                overallSummary: '',
            };
        }

        let extendedContext = {
            ...baseContext,
            standardSuggestions: hasCodeSuggestions ? suggestions : undefined,
            updatedSuggestions: undefined,
            filteredKodyRules: undefined,
        };

        try {
            const classifier = this.getClassifier(
                provider,
                fallbackProvider,
                extendedContext,
            );
            const updater = this.getUpdater(
                provider,
                fallbackProvider,
                extendedContext,
            );
            const guardian = this.getGuardian(
                provider,
                fallbackProvider,
                extendedContext,
            );

            // These chains do not depend on each other, so we can run them in parallel
            const [classifiedRulesResult, updateStandardSuggestionsResult] =
                await Promise.all([
                    classifier.execute(),
                    hasCodeSuggestions
                        ? updater?.execute()
                        : Promise.resolve(undefined),
                ]);

            const classifiedRules = this.processClassifierResponse(
                baseContext.kodyRules,
                classifiedRulesResult,
            );

            const updatedSuggestions = this.processUpdatedSuggestions(
                organizationAndTeamData,
                prNumber,
                updateStandardSuggestionsResult,
                fileContext,
                provider,
                extendedContext,
            );

            if (!classifiedRules || classifiedRules?.length === 0) {
                if (updatedSuggestions) {
                    return this.addSeverityToSuggestions(
                        updatedSuggestions,
                        context?.codeReviewConfig?.kodyRules || [],
                    );
                }

                return {
                    codeSuggestions: [],
                    overallSummary: '',
                };
            }

            extendedContext = {
                ...extendedContext,
                filteredKodyRules: classifiedRules,
                updatedSuggestions: updatedSuggestions
                    ? updatedSuggestions
                    : undefined,
            };

            const generator = this.getGenerator(
                provider,
                fallbackProvider,
                extendedContext,
            );

            const generatedKodyRulesSuggestionsResult =
                await generator.execute();

            const generatedKodyRulesSuggestions = this.processLLMResponse(
                organizationAndTeamData,
                prNumber,
                generatedKodyRulesSuggestionsResult,
                fileContext,
                provider,
                extendedContext,
            );

            let finalOutput = {
                codeSuggestions: [
                    ...generatedKodyRulesSuggestions?.codeSuggestions,
                ],
                overallSummary:
                    updatedSuggestions?.overallSummary ||
                    generatedKodyRulesSuggestions?.overallSummary ||
                    '',
            };

            if (updatedSuggestions) {
                finalOutput.codeSuggestions = [
                    ...finalOutput.codeSuggestions,
                    ...updatedSuggestions?.codeSuggestions,
                ];
            }

            const finalOutputWithLinks = await this.replaceKodyRuleIdsWithLinks(
                finalOutput,
                organizationAndTeamData,
                prNumber,
            );

            return this.addSeverityToSuggestions(
                finalOutputWithLinks,
                context?.codeReviewConfig?.kodyRules || [],
            );
        } catch (error) {
            this.logger.error({
                message: `Error during LLM code analysis for PR#${prNumber}`,
                context: KodyRulesAnalysisService.name,
                metadata: {
                    organizationAndTeamData: context?.organizationAndTeamData,
                    prNumber: context?.pullRequest?.number,
                },
                error,
            });
            throw error;
        }
    }

    private getClassifier(
        provider: LLMModelProvider,
        fallbackProvider: LLMModelProvider,
        context: KodyRulesExtendedContext,
    ) {
        return this.promptRunnerService
            .builder()
            .setProviders({
                main: provider,
                fallback: fallbackProvider,
            })
            .setParser(ParserType.ZOD, kodyRulesClassifierSchema, {
                provider: LLMModelProvider.OPENAI_GPT_4O_MINI,
                fallbackProvider: LLMModelProvider.OPENAI_GPT_4O,
            })
            .setLLMJsonMode(true)
            .setTemperature(0)
            .setPayload(context)
            .addPrompt({
                prompt: prompt_kodyrules_classifier_system,
                role: PromptRole.SYSTEM,
            })
            .addPrompt({
                prompt: prompt_kodyrules_classifier_user,
                role: PromptRole.USER,
            })
            .addMetadata({
                organizationId:
                    context?.organizationAndTeamData?.organizationId,
                teamId: context?.organizationAndTeamData?.teamId,
                pullRequestId: context?.pullRequest?.number,
                provider,
                fallbackProvider,
            })
            .addCallbacks([this.tokenTracker])
            .addTags([
                ...this.buildTags(provider, 'primary'),
                ...this.buildTags(fallbackProvider, 'fallback'),
            ])
            .setRunName('classifierKodyRulesAnalyzeCodeWithAI');
    }

    private getUpdater(
        provider: LLMModelProvider,
        fallbackProvider: LLMModelProvider,
        context: KodyRulesExtendedContext,
    ) {
        return this.promptRunnerService
            .builder()
            .setProviders({
                main: provider,
                fallback: fallbackProvider,
            })
            .setParser(ParserType.STRING)
            .setLLMJsonMode(true)
            .setTemperature(0)
            .setPayload(context)
            .addPrompt({
                prompt: prompt_kodyrules_updatestdsuggestions_system,
                role: PromptRole.SYSTEM,
            })
            .addPrompt({
                prompt: prompt_kodyrules_updatestdsuggestions_user,
                role: PromptRole.USER,
            })
            .addMetadata({
                organizationId:
                    context?.organizationAndTeamData?.organizationId,
                teamId: context?.organizationAndTeamData?.teamId,
                pullRequestId: context?.pullRequest?.number,
                provider,
                fallbackProvider,
            })
            .addCallbacks([this.tokenTracker])
            .addTags([
                ...this.buildTags(provider, 'primary'),
                ...this.buildTags(fallbackProvider, 'fallback'),
            ])
            .setRunName('updateStandardSuggestionsAnalyzeCodeWithAI');
    }

    private getGuardian(
        provider: LLMModelProvider,
        fallbackProvider: LLMModelProvider,
        context: KodyRulesExtendedContext,
    ) {
        return this.promptRunnerService
            .builder()
            .setProviders({
                main: provider,
                fallback: fallbackProvider,
            })
            .setParser(ParserType.STRING)
            .setLLMJsonMode(true)
            .setTemperature(0)
            .setPayload(context)
            .addPrompt({
                prompt: prompt_kodyrules_guardian_system,
                role: PromptRole.SYSTEM,
            })
            .addPrompt({
                prompt: prompt_kodyrules_guardian_user,
                role: PromptRole.USER,
            })
            .addMetadata({
                organizationId:
                    context?.organizationAndTeamData?.organizationId,
                teamId: context?.organizationAndTeamData?.teamId,
                pullRequestId: context?.pullRequest?.number,
                provider,
                fallbackProvider,
            })
            .addCallbacks([this.tokenTracker])
            .addTags([
                ...this.buildTags(provider, 'primary'),
                ...this.buildTags(fallbackProvider, 'fallback'),
            ])
            .setRunName('guardianKodyRulesAnalyzeCodeWithAI');
    }

    private getGenerator(
        provider: LLMModelProvider,
        fallbackProvider: LLMModelProvider,
        context: KodyRulesExtendedContext,
    ) {
        return this.promptRunnerService
            .builder()
            .setProviders({
                main: provider,
                fallback: fallbackProvider,
            })
            .setParser(ParserType.STRING)
            .setLLMJsonMode(true)
            .setTemperature(0)
            .setPayload(context)
            .addPrompt({
                prompt: prompt_kodyrules_suggestiongeneration_system,
                role: PromptRole.SYSTEM,
            })
            .addPrompt({
                prompt: prompt_kodyrules_suggestiongeneration_user,
                role: PromptRole.USER,
            })
            .addMetadata({
                organizationId:
                    context?.organizationAndTeamData?.organizationId,
                teamId: context?.organizationAndTeamData?.teamId,
                pullRequestId: context?.pullRequest?.number,
                provider,
                fallbackProvider,
            })
            .addCallbacks([this.tokenTracker])
            .addTags([
                ...this.buildTags(provider, 'primary'),
                ...this.buildTags(fallbackProvider, 'fallback'),
            ])
            .setRunName('generateKodyRulesSuggestionsAnalyzeCodeWithAI');
    }

    private addSeverityToSuggestions(
        suggestions: AIAnalysisResult,
        kodyRules: Array<Partial<IKodyRule>>,
    ): AIAnalysisResult {
        if (!suggestions?.codeSuggestions?.length || !kodyRules?.length) {
            return suggestions;
        }

        const updatedSuggestions = suggestions.codeSuggestions.map(
            (suggestion: CodeSuggestion & { brokenKodyRulesIds: string[] }) => {
                if (!suggestion.brokenKodyRulesIds?.length) {
                    return suggestion;
                }

                // For each broken rule, find the severity in kodyRules
                const severities = suggestion.brokenKodyRulesIds
                    .map((ruleId) => {
                        const rule = kodyRules.find((kr) => kr.uuid === ruleId);
                        return rule?.severity;
                    })
                    .filter(Boolean);

                // If there are severities, use the first one
                if (severities && severities.length > 0) {
                    return {
                        ...suggestion,
                        severity: severities[0]?.toLowerCase(),
                    };
                }

                return suggestion;
            },
        );

        return {
            ...suggestions,
            codeSuggestions: updatedSuggestions,
        };
    }

    private async prepareAnalysisContext(
        fileContext: FileChangeContext,
        context: AnalysisContext,
    ) {
        const kodyRulesFiltered = getKodyRulesForFile(
            fileContext.file.filename,
            context?.codeReviewConfig?.kodyRules || [],
        )
            ?.filter(
                (rule) => !rule.scope || rule.scope === KodyRulesScope.FILE,
            )
            ?.map((rule) => ({
                uuid: rule?.uuid,
                rule: rule?.rule,
                severity: rule?.severity,
                examples: rule?.examples ?? [],
            }));

        const baseContext = {
            pullRequest: context?.pullRequest,
            patchWithLinesStr: fileContext?.patchWithLinesStr,
            maxSuggestionsParams:
                context?.codeReviewConfig?.suggestionControl?.maxSuggestions,
            language: context?.repository?.language,
            filePath: fileContext?.file?.filename,
            languageResultPrompt:
                context?.codeReviewConfig?.languageResultPrompt,
            reviewOptions: context?.codeReviewConfig?.reviewOptions,
            fileContent: fileContext?.file?.fileContent,
            limitationType:
                context?.codeReviewConfig?.suggestionControl?.limitationType,
            // ✨ MODIFICAÇÃO: só passa severityLevelFilter se deve aplicar filtros
            severityLevelFilter: this.shouldPassSeverityFilter(
                context?.codeReviewConfig?.suggestionControl,
            )
                ? context?.codeReviewConfig?.suggestionControl
                      ?.severityLevelFilter
                : undefined,
            organizationAndTeamData: context?.organizationAndTeamData,
            kodyRules: kodyRulesFiltered,
        };

        return baseContext;
    }

    /**
     * ✨ SIMPLIFICADO: Determina se deve passar severityLevelFilter para análise de Kody Rules
     */
    private shouldPassSeverityFilter(
        suggestionControl?: SuggestionControlConfig,
    ): boolean {
        if (!suggestionControl) {
            return false;
        }

        // Retorna true apenas se filtros estão explicitamente habilitados para Kody Rules
        return suggestionControl.applyFiltersToKodyRules === true;
    }

    private getBasePromptBuilder(
        provider: LLMModelProvider,
        baseContext: KodyRulesExtendedContext,
        fallbackProvider?: LLMModelProvider,
    ) {
        let fallbackProviderToUse = fallbackProvider;
        if (!fallbackProviderToUse)
            fallbackProviderToUse =
                provider === LLMModelProvider.GEMINI_2_5_PRO
                    ? LLMModelProvider.VERTEX_CLAUDE_3_5_SONNET
                    : LLMModelProvider.GEMINI_2_5_FLASH;

        return this.promptRunnerService
            .builder()
            .setProviders({
                main: provider,
                fallback: fallbackProvider,
            })
            .setParser(ParserType.STRING)
            .setLLMJsonMode(true)
            .addMetadata({
                organizationId:
                    baseContext?.organizationAndTeamData?.organizationId,
                teamId: baseContext?.organizationAndTeamData?.teamId,
                pullRequestId: baseContext?.pullRequest?.number,
                provider: provider,
                fallbackProvider: fallbackProvider,
            })
            .addCallbacks([this.tokenTracker])
            .addTags([
                ...this.buildTags(provider, 'primary'),
                ...this.buildTags(fallbackProvider, 'fallback'),
            ])
            .setTemperature(0);
    }

    private processClassifierResponse(
        allRules: Array<Partial<IKodyRule> | IKodyRule>,
        response: KodyRulesClassifierSchema,
    ): Array<Partial<IKodyRule> | IKodyRule> | null {
        try {
            if (!response || !response.rules?.length) {
                this.logger.warn({
                    message: 'No rules found in classifier response',
                    context: KodyRulesAnalysisService.name,
                    metadata: {
                        allRules,
                        response,
                    },
                });
                return null;
            }

            const responseMap = new Map(
                response.rules.map((rule) => [rule.uuid, rule.reason]),
            );

            return allRules
                .filter((rule) => rule.uuid && responseMap.has(rule.uuid))
                .map((rule) => {
                    const baseRule = { ...rule };
                    const reason = responseMap.get(rule.uuid!);
                    return { ...baseRule, reason } as Partial<IKodyRule>;
                });
        } catch (error) {
            this.logger.error({
                message: 'Error processing classifier response',
                context: KodyRulesAnalysisService.name,
                error,
                metadata: {
                    allRules,
                    response,
                },
            });
            return null;
        }
    }

    private processSuggestionLabels(
        suggestions: CodeSuggestion[],
        reviewOptions: ReviewOptions,
    ): CodeSuggestion[] {
        const availableLabels = Object.keys(reviewOptions);

        return suggestions.map((suggestion) => {
            if (
                (suggestion.label ?? '') === '' ||
                !availableLabels.includes(suggestion?.label)
            ) {
                return {
                    ...suggestion,
                    label: 'kody_rules',
                };
            }

            return suggestion;
        });
    }

    private processLLMResponse(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        response: string,
        fileContext: FileChangeContext,
        provider: LLMModelProvider,
        extendedContext: KodyRulesExtendedContext,
    ): AIAnalysisResult | null {
        try {
            if (!response) {
                return null;
            }

            let cleanResponse = response;

            if (response?.startsWith('```')) {
                cleanResponse = response
                    .replace(/^```json\n/, '')
                    .replace(/\n```(\n)?$/, '')
                    .trim();
            }

            let parsedResponse = tryParseJSONObject(cleanResponse);

            if (!parsedResponse) {
                this.logger.error({
                    message: 'Failed to parse LLM response',
                    context: KodyRulesAnalysisService.name,
                    metadata: {
                        originalResponse: response,
                        cleanResponse,
                        prNumber,
                    },
                });
                return null;
            }

            // Normalize the types of fields that may come as strings
            if (parsedResponse?.codeSuggestions) {
                parsedResponse.codeSuggestions =
                    parsedResponse.codeSuggestions.map((suggestion) => ({
                        ...suggestion,
                        relevantLinesStart:
                            Number(suggestion.relevantLinesStart) || undefined,
                        relevantLinesEnd:
                            Number(suggestion.relevantLinesEnd) || undefined,
                    }));
            }

            if (parsedResponse?.codeSuggestions) {
                parsedResponse.codeSuggestions =
                    parsedResponse.codeSuggestions.map((suggestion) => {
                        if (!suggestion?.id || !uuidValidate(suggestion?.id)) {
                            return {
                                ...suggestion,
                                id: uuidv4(),
                            };
                        }
                        return suggestion;
                    });

                if (extendedContext?.reviewOptions) {
                    parsedResponse.codeSuggestions =
                        this.processSuggestionLabels(
                            parsedResponse.codeSuggestions,
                            extendedContext.reviewOptions,
                        );
                } else {
                    parsedResponse.codeSuggestions =
                        parsedResponse.codeSuggestions.map((suggestion) => ({
                            ...suggestion,
                            label: suggestion.label ?? 'kody_rules',
                        }));
                }
            }

            this.logTokenUsage({
                tokenUsages: parsedResponse.codeSuggestions,
                pullRequestId: prNumber,
                fileContext: fileContext?.file?.filename,
                provider,
                organizationAndTeamData,
            });

            return {
                codeSuggestions: parsedResponse.codeSuggestions || [],
                overallSummary: parsedResponse.overallSummary || '',
            };
        } catch (error) {
            this.logger.error({
                message: `Error processing LLM response for PR#${prNumber}`,
                context: KodyRulesAnalysisService.name,
                error,
                metadata: {
                    organizationAndTeamData,
                    prNumber,
                    response,
                },
            });
            return null;
        }
    }

    /**
     * Specifically processes updatedSuggestions with differentiated logic
     * for violated vs broken kody rules
     */
    private processUpdatedSuggestions(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        response: string,
        fileContext: FileChangeContext,
        provider: LLMModelProvider,
        extendedContext: KodyRulesExtendedContext,
    ): AIAnalysisResult | null {
        // Tipo específico para a resposta do UPDATE
        interface KodyRulesUpdateResponse {
            overallSummary?: string;
            codeSuggestions?: Array<{
                id?: string;
                relevantFile?: string;
                language?: string;
                suggestionContent?: string;
                existingCode?: string;
                improvedCode?: string;
                oneSentenceSummary?: string;
                relevantLinesStart?: number | string;
                relevantLinesEnd?: number | string;
                label?: string;
                severity?: string;
                violatedKodyRulesIds?: string[];
                brokenKodyRulesIds?: string[];
            }>;
        }

        try {
            if (!response) {
                return null;
            }

            let cleanResponse = response;
            if (response?.startsWith('```')) {
                cleanResponse = response
                    .replace(/^```json\n/, '')
                    .replace(/\n```(\n)?$/, '')
                    .trim();
            }

            const parsedResponse = tryParseJSONObject(
                cleanResponse,
            ) as KodyRulesUpdateResponse | null;

            if (!parsedResponse) {
                this.logger.error({
                    message: 'Failed to parse UPDATE response',
                    context: KodyRulesAnalysisService.name,
                    metadata: {
                        organizationAndTeamData,
                        originalResponse: response,
                        cleanResponse,
                        prNumber,
                    },
                });
                return null;
            }

            const processedSuggestions: CodeSuggestion[] = [];

            if (parsedResponse.codeSuggestions) {
                for (const suggestion of parsedResponse.codeSuggestions) {
                    const normalizedSuggestion: CodeSuggestion = {
                        id:
                            !suggestion?.id || !uuidValidate(suggestion?.id)
                                ? uuidv4()
                                : suggestion.id,
                        relevantFile: suggestion.relevantFile || '',
                        language: suggestion.language,
                        suggestionContent: suggestion.suggestionContent || '',
                        existingCode: suggestion.existingCode,
                        improvedCode: suggestion.improvedCode,
                        oneSentenceSummary: suggestion.oneSentenceSummary,
                        relevantLinesStart:
                            Number(suggestion.relevantLinesStart) || undefined,
                        relevantLinesEnd:
                            Number(suggestion.relevantLinesEnd) || undefined,
                        label: suggestion.label,
                        severity: suggestion.severity,
                    };

                    // "Has violated" means a standard suggestion violates a kody rule, so we silently fix it.
                    const hasViolated =
                        suggestion.violatedKodyRulesIds?.length &&
                        suggestion.violatedKodyRulesIds.length > 0;

                    // "Has broken" means that a standard suggestion could potentially be a kody rule, so we merge it
                    const hasBroken =
                        suggestion.brokenKodyRulesIds?.length &&
                        suggestion.brokenKodyRulesIds.length > 0;

                    if (hasBroken) {
                        processedSuggestions.push({
                            ...normalizedSuggestion,
                            label: 'kody_rules',
                            brokenKodyRulesIds: suggestion.brokenKodyRulesIds,
                        });
                    } else if (hasViolated) {
                        processedSuggestions.push({
                            ...normalizedSuggestion,
                            label: suggestion.label,
                            // violatedKodyRulesIds is just for internal use, so we don't save it
                        });
                    } else {
                        processedSuggestions.push(normalizedSuggestion);
                    }
                }
            }

            return {
                codeSuggestions: processedSuggestions,
                overallSummary: parsedResponse.overallSummary || '',
            };
        } catch (error) {
            this.logger.error({
                message: `Error processing UPDATE response for PR#${prNumber}`,
                context: KodyRulesAnalysisService.name,
                error,
                metadata: {
                    organizationAndTeamData,
                    prNumber,
                    response,
                    filename: fileContext?.file?.filename,
                },
            });
            return null;
        }
    }

    private buildTags(
        provider: LLMModelProvider,
        tier: 'primary' | 'fallback',
    ) {
        return [`model:${provider}`, `tier:${tier}`, 'kodyRules'];
    }

    private async logTokenUsage(metadata: any) {
        // Log token usage para análise e monitoramento
        this.logger.log({
            message: 'Token usage',
            context: KodyRulesAnalysisService.name,
            metadata: {
                ...metadata,
            },
        });
    }
}
