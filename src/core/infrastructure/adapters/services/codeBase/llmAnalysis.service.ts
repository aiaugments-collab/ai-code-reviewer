import { Injectable } from '@nestjs/common';
import { IAIAnalysisService } from '../../../../domain/codeBase/contracts/AIAnalysisService.contract';
import {
    FileChangeContext,
    AnalysisContext,
    AIAnalysisResult,
    CodeSuggestion,
    ReviewModeResponse,
    FileChange,
    ISafeguardResponse,
} from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PinoLoggerService } from '../logger/pino.service';

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { z } from 'zod';
import { LLMResponseProcessor } from './utils/transforms/llmResponseProcessor.transform';
import { prompt_validateImplementedSuggestions } from '@/shared/utils/langchainCommon/prompts/validateImplementedSuggestions';
import { prompt_selectorLightOrHeavyMode_system } from '@/shared/utils/langchainCommon/prompts/seletorLightOrHeavyMode';
import {
    prompt_codereview_system_gemini,
    prompt_codereview_user_deepseek,
    prompt_codereview_user_gemini,
    prompt_codereview_system_gemini_v2,
    prompt_codereview_user_gemini_v2,
} from '@/shared/utils/langchainCommon/prompts/configuration/codeReview';
import { prompt_severity_analysis_user } from '@/shared/utils/langchainCommon/prompts/severityAnalysis';
import { prompt_codeReviewSafeguard_system } from '@/shared/utils/langchainCommon/prompts';
import {
    LLMModelProvider,
    ParserType,
    PromptRole,
    PromptRunnerService,
    PromptScope,
} from '@kodus/kodus-common/llm';

// Interface for token tracking
interface TokenUsage {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    model?: string;
    runId?: string;
    parentRunId?: string;
    output_reasoning_tokens?: number;
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
                usage.output_reasoning_tokens =
                    metadata.output_token_details.reasoning;
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

export const LLM_ANALYSIS_SERVICE_TOKEN = Symbol('LLMAnalysisService');

@Injectable()
export class LLMAnalysisService implements IAIAnalysisService {
    private readonly tokenTracker: TokenTrackingHandler;
    private readonly llmResponseProcessor: LLMResponseProcessor;

    constructor(
        private readonly logger: PinoLoggerService,
        private readonly promptRunnerService: PromptRunnerService,
    ) {
        this.tokenTracker = new TokenTrackingHandler();
        this.llmResponseProcessor = new LLMResponseProcessor(logger);
    }

    //#region Helper Functions
    // Creates the prefix for the prompt cache (every prompt that uses file or codeDiff must start with this)
    private preparePrefixChainForCache(context: {
        patchWithLinesStr: string;
        fileContent: string;
        relevantContent: string;
        language: string;
        filePath: string;
        suggestions?: CodeSuggestion[];
        reviewMode: ReviewModeResponse;
    }) {
        if (!context?.patchWithLinesStr) {
            throw new Error('Required context parameters are missing');
        }

        const { reviewMode } = context;

        if (reviewMode === ReviewModeResponse.LIGHT_MODE) {
            return `
## Context

<codeDiff>
    ${context.patchWithLinesStr}
</codeDiff>

<filePath>
    ${context.filePath}
</filePath>

<suggestionsContext>
    ${JSON.stringify(context?.suggestions, null, 2) || 'No suggestions provided'}
</suggestionsContext>`;
        }

        return `
## Context

<fileContent>
    ${context.relevantContent || context.fileContent}
</fileContent>

<codeDiff>
    ${context.patchWithLinesStr}
</codeDiff>

<filePath>
    ${context.filePath}
</filePath>

<suggestionsContext>
${JSON.stringify(context?.suggestions, null, 2) || 'No suggestions provided'}
</suggestionsContext>`;
    }

    private async logTokenUsage(metadata: any) {
        // Log token usage for analysis and monitoring
        this.logger.log({
            message: 'Token usage',
            context: LLMAnalysisService.name,
            metadata: {
                ...metadata,
            },
        });
    }
    //#endregion

    //#region Analyze Code with AI
    async analyzeCodeWithAI(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        fileContext: FileChangeContext,
        reviewModeResponse: ReviewModeResponse,
        context: AnalysisContext,
    ): Promise<AIAnalysisResult> {
        const provider = LLMModelProvider.GEMINI_2_5_PRO;
        const fallbackProvider = LLMModelProvider.NOVITA_DEEPSEEK_V3;

        // Reset token tracking for new analysis
        this.tokenTracker.reset();

        // Prepare base context
        const baseContext = this.prepareAnalysisContext(fileContext, context);

        try {
            const analysis = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.STRING)
                .setLLMJsonMode(true)
                .setPayload(baseContext)
                .addPrompt({
                    prompt: prompt_codereview_system_gemini,
                    role: PromptRole.SYSTEM,
                    scope: PromptScope.MAIN,
                })
                .addPrompt({
                    prompt: prompt_codereview_user_gemini,
                    role: PromptRole.USER,
                    scope: PromptScope.MAIN,
                })
                .addPrompt({
                    prompt: prompt_codereview_user_deepseek,
                    role: PromptRole.USER,
                    scope: PromptScope.FALLBACK,
                })
                .setTemperature(0)
                .addCallbacks([this.tokenTracker])
                .addMetadata({
                    organizationId:
                        baseContext?.organizationAndTeamData?.organizationId,
                    teamId: baseContext?.organizationAndTeamData?.teamId,
                    pullRequestId: baseContext?.pullRequest?.number,
                    provider: provider,
                    fallbackProvider: fallbackProvider,
                    reviewMode: reviewModeResponse,
                })
                .setRunName('analyzeCodeWithAI')
                .execute();

            if (!analysis) {
                const message = `No analysis result for PR#${prNumber}`;
                this.logger.warn({
                    message,
                    context: LLMAnalysisService.name,
                    metadata: {
                        organizationAndTeamData:
                            baseContext?.organizationAndTeamData,
                        prNumber: baseContext?.pullRequest?.number,
                    },
                });
                throw new Error(message);
            }

            // Process result and tokens
            const analysisResult = this.llmResponseProcessor.processResponse(
                organizationAndTeamData,
                prNumber,
                analysis,
            );

            if (!analysisResult) {
                return null;
            }

            analysisResult.codeReviewModelUsed = {
                generateSuggestions: provider,
            };

            const tokenUsages = this.tokenTracker.getTokenUsages();
            await this.logTokenUsage({
                tokenUsages,
                organizationAndTeamData,
                prNumber,
                analysis,
            });

            return analysisResult;
        } catch (error) {
            this.logger.error({
                message: `Error during LLM code analysis for PR#${prNumber}`,
                context: LLMAnalysisService.name,
                metadata: {
                    organizationAndTeamData: context?.organizationAndTeamData,
                    prNumber: context?.pullRequest?.number,
                },
                error,
            });
            throw error;
        }
    }

    async analyzeCodeWithAI_v2(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        fileContext: FileChangeContext,
        reviewModeResponse: ReviewModeResponse,
        context: AnalysisContext,
    ): Promise<AIAnalysisResult> {
        const provider = LLMModelProvider.GEMINI_2_5_PRO;
        const fallbackProvider = LLMModelProvider.NOVITA_DEEPSEEK_V3;

        // Reset token tracking for new analysis
        this.tokenTracker.reset();

        // Prepare base context
        const baseContext = this.prepareAnalysisContext(fileContext, context);

        try {
            const schema = z.object({
                codeSuggestions: z.array(
                    z.object({
                        id: z.string().optional(),
                        relevantFile: z.string(),
                        language: z.string(),
                        suggestionContent: z.string(),
                        existingCode: z.string().optional(),
                        improvedCode: z.string(),
                        oneSentenceSummary: z.string().optional(),
                        relevantLinesStart: z.number().min(1).optional(),
                        relevantLinesEnd: z.number().min(1).optional(),
                        label: z.string(),
                        severity: z.string().optional(),
                        rankScore: z.number().optional(),
                    }),
                ),
                overallSummary: z.string(),
            });

            const analysis = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.ZOD, schema, {
                    provider: LLMModelProvider.OPENAI_GPT_4O_MINI,
                    fallbackProvider: LLMModelProvider.OPENAI_GPT_4O,
                })
                .setLLMJsonMode(true)
                .setPayload(baseContext)
                .addPrompt({
                    prompt: prompt_codereview_system_gemini_v2,
                    role: PromptRole.SYSTEM,
                    scope: PromptScope.MAIN,
                })
                .addPrompt({
                    prompt: prompt_codereview_user_gemini_v2,
                    role: PromptRole.USER,
                    scope: PromptScope.MAIN,
                })
                .addPrompt({
                    prompt: prompt_codereview_user_deepseek,
                    role: PromptRole.USER,
                    scope: PromptScope.FALLBACK,
                })
                .setTemperature(0)
                .addCallbacks([this.tokenTracker])
                .addMetadata({
                    organizationId:
                        baseContext?.organizationAndTeamData?.organizationId,
                    teamId: baseContext?.organizationAndTeamData?.teamId,
                    pullRequestId: baseContext?.pullRequest?.number,
                    provider: provider,
                    fallbackProvider: fallbackProvider,
                    reviewMode: reviewModeResponse,
                })
                .setRunName('analyzeCodeWithAI_v2')
                .setMaxReasoningTokens(3000)
                .execute();

            if (!analysis) {
                const message = `No analysis result for PR#${prNumber}`;
                this.logger.warn({
                    message,
                    context: LLMAnalysisService.name,
                    metadata: {
                        organizationAndTeamData:
                            baseContext?.organizationAndTeamData,
                        prNumber: baseContext?.pullRequest?.number,
                    },
                });
                throw new Error(message);
            }

            // Com o parser zod, a resposta já vem estruturada
            const analysisResult: AIAnalysisResult = {
                codeSuggestions:
                    analysis.codeSuggestions as Partial<CodeSuggestion>[],
                overallSummary: analysis.overallSummary,
                codeReviewModelUsed: {
                    generateSuggestions: provider,
                },
            };

            const tokenUsages = this.tokenTracker.getTokenUsages();
            await this.logTokenUsage({
                tokenUsages,
                organizationAndTeamData,
                prNumber,
                analysis,
            });

            return analysisResult;
        } catch (error) {
            this.logger.error({
                message: `Error during LLM code analysis for PR#${prNumber}`,
                context: LLMAnalysisService.name,
                metadata: {
                    organizationAndTeamData: context?.organizationAndTeamData,
                    prNumber: context?.pullRequest?.number,
                },
                error,
            });
            throw error;
        }
    }

    private prepareAnalysisContext(
        fileContext: FileChangeContext,
        context: AnalysisContext,
    ) {
        const baseContext = {
            pullRequest: context?.pullRequest,
            patchWithLinesStr: fileContext?.patchWithLinesStr,
            maxSuggestionsParams:
                context.codeReviewConfig?.suggestionControl?.maxSuggestions,
            language: context?.repository?.language,
            filePath: fileContext?.file?.filename,
            languageResultPrompt:
                context?.codeReviewConfig?.languageResultPrompt,
            reviewOptions: context?.codeReviewConfig?.reviewOptions,
            fileContent: fileContext?.file?.fileContent,
            limitationType:
                context?.codeReviewConfig?.suggestionControl?.limitationType,
            severityLevelFilter:
                context?.codeReviewConfig?.suggestionControl
                    ?.severityLevelFilter,
            groupingMode:
                context?.codeReviewConfig?.suggestionControl?.groupingMode,
            organizationAndTeamData: context?.organizationAndTeamData,
            relevantContent: fileContext?.relevantContent,
            prSummary: context?.pullRequest?.body,
        };

        return baseContext;
    }
    //#endregion

    //#region Generate Code Suggestions
    async generateCodeSuggestions(
        organizationAndTeamData: OrganizationAndTeamData,
        sessionId: string,
        question: string,
        parameters: any,
        reviewMode: ReviewModeResponse = ReviewModeResponse.LIGHT_MODE,
    ) {
        const provider =
            parameters.llmProvider || LLMModelProvider.GEMINI_2_5_PRO;
        const fallbackProvider =
            provider === LLMModelProvider.OPENAI_GPT_4O
                ? LLMModelProvider.GEMINI_2_5_PRO
                : LLMModelProvider.OPENAI_GPT_4O;

        // Reset token tracking for new suggestions
        this.tokenTracker.reset();

        try {
            const result = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.STRING)
                .setLLMJsonMode(true)
                .setPayload({ question })
                // legacy code compatibility when migrating to PromptRunnerService
                .addPrompt({
                    prompt: () => prompt_codereview_system_gemini({}),
                    role: PromptRole.SYSTEM,
                    scope: PromptScope.MAIN,
                })
                .addPrompt({
                    prompt: () => prompt_codereview_user_gemini({}),
                    role: PromptRole.USER,
                    scope: PromptScope.MAIN,
                })
                .addPrompt({
                    prompt: () => prompt_codereview_user_deepseek({}),
                    role: PromptRole.USER,
                    scope: PromptScope.FALLBACK,
                })
                .addMetadata({
                    organizationId: organizationAndTeamData?.organizationId,
                    teamId: organizationAndTeamData?.teamId,
                    sessionId,
                    provider,
                    fallbackProvider,
                    reviewMode,
                })
                .addCallbacks([this.tokenTracker])
                .setRunName('generateCodeSuggestions')
                .setTemperature(0)
                .execute();

            if (!result) {
                const message = `No code suggestions generated for session ${sessionId}`;
                this.logger.warn({
                    message,
                    context: LLMAnalysisService.name,
                    metadata: {
                        organizationAndTeamData,
                        sessionId,
                        parameters,
                    },
                });
                throw new Error(message);
            }

            // Log token usage
            const tokenUsages = this.tokenTracker.getTokenUsages();
            await this.logTokenUsage({
                tokenUsages,
                organizationAndTeamData,
                sessionId,
                parameters,
            });
            return result;
        } catch (error) {
            this.logger.error({
                message: `Error generating code suggestions`,
                error,
                context: LLMAnalysisService.name,
                metadata: {
                    organizationAndTeamData,
                    sessionId,
                    parameters,
                },
            });
            throw error;
        }
    }
    //#endregion

    //#region Severity Analysis
    async severityAnalysisAssignment(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        provider: LLMModelProvider,
        codeSuggestions: CodeSuggestion[],
    ): Promise<Partial<CodeSuggestion>[]> {
        const fallbackProvider =
            provider === LLMModelProvider.OPENAI_GPT_4O
                ? LLMModelProvider.NOVITA_DEEPSEEK_V3_0324
                : LLMModelProvider.OPENAI_GPT_4O;

        try {
            const result = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.STRING)
                .setLLMJsonMode(true)
                .setPayload(codeSuggestions)
                .addPrompt({
                    prompt: prompt_severity_analysis_user,
                    role: PromptRole.USER,
                })
                .addCallbacks([this.tokenTracker])
                .addMetadata({
                    organizationId: organizationAndTeamData?.organizationId,
                    teamId: organizationAndTeamData?.teamId,
                    pullRequestId: prNumber,
                    provider: provider,
                    fallbackProvider: fallbackProvider,
                })
                .setRunName('severityAnalysis')
                .setTemperature(0)
                .execute();

            if (!result) {
                const message = `No severity analysis result for PR#${prNumber}`;
                this.logger.warn({
                    message,
                    context: LLMAnalysisService.name,
                    metadata: {
                        organizationAndTeamData,
                        prNumber,
                    },
                });
                throw new Error(message);
            }

            const suggestionsWithSeverityAnalysis =
                this.llmResponseProcessor.processResponse(
                    organizationAndTeamData,
                    prNumber,
                    result,
                );

            const suggestionsWithSeverity =
                suggestionsWithSeverityAnalysis?.codeSuggestions || [];

            return suggestionsWithSeverity;
        } catch (error) {
            this.logger.error({
                message:
                    'Error executing validate implemented suggestions chain:',
                error,
                context: LLMAnalysisService.name,
                metadata: {
                    organizationAndTeamData,
                    prNumber,
                    provider,
                },
            });
        }

        return codeSuggestions;
    }
    //#endregion

    //#region Filter Suggestions Safe Guard
    async filterSuggestionsSafeGuard(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        file: any,
        relevantContent: string,
        codeDiff: string,
        suggestions: any[],
        languageResultPrompt: string,
        reviewMode: ReviewModeResponse,
    ): Promise<ISafeguardResponse> {
        try {
            suggestions?.forEach((suggestion) => {
                if (
                    suggestion &&
                    Object.prototype.hasOwnProperty.call(
                        suggestion,
                        'suggestionEmbedded',
                    )
                ) {
                    delete suggestion?.suggestionEmbedded;
                }
            });

            const provider = LLMModelProvider.GEMINI_2_5_PRO;
            const fallbackProvider = LLMModelProvider.VERTEX_CLAUDE_3_5_SONNET;

            this.tokenTracker.reset();

            const payload = {
                fileContent: file?.fileContent,
                relevantContent,
                patchWithLinesStr: codeDiff,
                language: file?.language,
                filePath: file?.filename,
                suggestions,
                languageResultPrompt,
                reviewMode,
            };

            const schema = z.object({
                codeSuggestions: z.array(
                    z
                        .object({
                            id: z.string(),
                            suggestionContent: z.string(),
                            existingCode: z.string(),
                            improvedCode: z.string().nullable(),
                            oneSentenceSummary: z.string(),
                            relevantLinesStart: z.number().min(1),
                            relevantLinesEnd: z.number().min(1),
                            label: z.string().optional(),
                            action: z.string(),
                            reason: z.string().optional(),
                        })
                        .refine(
                            (data) =>
                                data.suggestionContent &&
                                data.existingCode &&
                                data.oneSentenceSummary &&
                                data.relevantLinesStart &&
                                data.relevantLinesEnd &&
                                data.action,
                            {
                                message: 'All fields are required',
                            },
                        ),
                ),
            });

            const filteredSuggestions = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.ZOD, schema, {
                    provider: LLMModelProvider.OPENAI_GPT_4O_MINI,
                    fallbackProvider: LLMModelProvider.OPENAI_GPT_4O,
                })
                .setLLMJsonMode(true)
                .setPayload(payload)
                .addPrompt({
                    prompt: prompt_codeReviewSafeguard_system,
                    role: PromptRole.SYSTEM,
                })
                .addPrompt({
                    prompt: this.preparePrefixChainForCache(payload),
                    role: PromptRole.USER,
                })
                .addMetadata({
                    organizationId: organizationAndTeamData?.organizationId,
                    teamId: organizationAndTeamData?.teamId,
                    pullRequestId: prNumber,
                    provider: provider,
                    fallbackProvider: fallbackProvider,
                    reviewMode: reviewMode,
                })
                .setTemperature(0)
                .addCallbacks([this.tokenTracker])
                .setRunName('filterSuggestionsSafeGuard')
                .setMaxReasoningTokens(5000)
                .execute();

            if (!filteredSuggestions) {
                const message = `No response from safeguard for PR#${prNumber}`;
                this.logger.warn({
                    message,
                    context: LLMAnalysisService.name,
                    metadata: {
                        organizationAndTeamData,
                        prNumber,
                        file: file?.filename,
                    },
                });
                throw new Error(message);
            }

            const tokenUsages = this.tokenTracker.getTokenUsages();

            // Filter and update suggestions
            const suggestionsToUpdate =
                filteredSuggestions?.codeSuggestions?.filter(
                    (s) => s.action === 'update',
                );
            const suggestionsToDiscard = new Set(
                filteredSuggestions?.codeSuggestions
                    ?.filter((s) => s.action === 'discard')
                    .map((s) => s.id),
            );

            this.logTokenUsage({
                tokenUsages,
                pullRequestId: prNumber,
                fileContext: file?.filename,
                provider,
                organizationAndTeamData,
            });

            const filteredAndMappedSuggestions = suggestions
                ?.filter(
                    (suggestion) => !suggestionsToDiscard.has(suggestion.id),
                )
                ?.map((suggestion) => {
                    const updatedSuggestion = suggestionsToUpdate?.find(
                        (s) => s.id === suggestion.id,
                    );

                    if (!updatedSuggestion) {
                        return suggestion;
                    }

                    return {
                        ...suggestion,
                        suggestionContent: updatedSuggestion?.suggestionContent,
                        existingCode: updatedSuggestion?.existingCode,
                        improvedCode: updatedSuggestion?.improvedCode,
                        oneSentenceSummary:
                            updatedSuggestion?.oneSentenceSummary,
                        relevantLinesStart:
                            updatedSuggestion?.relevantLinesStart,
                        relevantLinesEnd: updatedSuggestion?.relevantLinesEnd,
                    };
                });

            return {
                suggestions: filteredAndMappedSuggestions,
                codeReviewModelUsed: {
                    safeguard: provider,
                },
            };
        } catch (error) {
            this.logger.error({
                message: `Error during suggestions safe guard analysis for PR#${prNumber}`,
                context: LLMAnalysisService.name,
                metadata: {
                    organizationAndTeamData,
                    prNumber,
                    file: file?.filename,
                },
                error,
            });
            return { suggestions };
        }
    }
    //#endregion

    //#region Validate Implemented Suggestions
    async validateImplementedSuggestions(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        provider: LLMModelProvider,
        codePatch: string,
        codeSuggestions: Partial<CodeSuggestion>[],
    ): Promise<Partial<CodeSuggestion>[]> {
        const fallbackProvider =
            provider === LLMModelProvider.OPENAI_GPT_4O
                ? LLMModelProvider.NOVITA_DEEPSEEK_V3_0324
                : LLMModelProvider.OPENAI_GPT_4O;

        const payload = {
            codePatch,
            codeSuggestions,
        };

        try {
            const result = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.STRING)
                .setLLMJsonMode(true)
                .setTemperature(0)
                .setPayload(payload)
                .addPrompt({
                    prompt: prompt_validateImplementedSuggestions,
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
                .setRunName('validateImplementedSuggestions')
                .execute();

            if (!result) {
                const message = `No response from validate implemented suggestions for PR#${prNumber}`;
                this.logger.warn({
                    message,
                    context: LLMAnalysisService.name,
                    metadata: {
                        organizationAndTeamData,
                        prNumber,
                        provider,
                    },
                });
                throw new Error(message);
            }

            const suggestionsWithImplementedStatus =
                this.llmResponseProcessor.processResponse(
                    organizationAndTeamData,
                    prNumber,
                    result,
                );

            const implementedSuggestions =
                suggestionsWithImplementedStatus?.codeSuggestions || [];

            return implementedSuggestions;
        } catch (error) {
            this.logger.error({
                message:
                    'Error executing validate implemented suggestions chain:',
                error,
                context: LLMAnalysisService.name,
                metadata: {
                    organizationAndTeamData,
                    prNumber,
                    provider,
                },
            });
        }

        return codeSuggestions;
    }
    //#endregion

    //#region Select Review Mode
    async selectReviewMode(
        organizationAndTeamData: OrganizationAndTeamData,
        prNumber: number,
        provider: LLMModelProvider,
        file: FileChange,
        codeDiff: string,
    ): Promise<ReviewModeResponse> {
        const fallbackProvider =
            provider === LLMModelProvider.OPENAI_GPT_4O
                ? LLMModelProvider.NOVITA_DEEPSEEK_V3_0324
                : LLMModelProvider.OPENAI_GPT_4O;

        const payload = {
            file,
            codeDiff,
        };

        try {
            const result = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.STRING)
                .setLLMJsonMode(true)
                .setTemperature(0)
                .setPayload(payload)
                .addPrompt({
                    prompt: prompt_selectorLightOrHeavyMode_system,
                    role: PromptRole.SYSTEM,
                })
                .addCallbacks([this.tokenTracker])
                .addMetadata({
                    organizationId: organizationAndTeamData?.organizationId,
                    teamId: organizationAndTeamData?.teamId,
                    pullRequestId: prNumber,
                    provider: provider,
                    fallbackProvider: fallbackProvider,
                })
                .setRunName('selectReviewMode')
                .execute();

            if (!result) {
                const message = `No response from select review mode for PR#${prNumber}`;
                this.logger.warn({
                    message,
                    context: LLMAnalysisService.name,
                    metadata: {
                        organizationAndTeamData,
                        prNumber,
                        provider,
                    },
                });
                throw new Error(message);
            }

            const reviewMode =
                this.llmResponseProcessor.processReviewModeResponse(
                    organizationAndTeamData,
                    prNumber,
                    result,
                );

            return reviewMode?.reviewMode || ReviewModeResponse.LIGHT_MODE;
        } catch (error) {
            this.logger.error({
                message: 'Error executing select review mode chain:',
                error,
                context: LLMAnalysisService.name,
                metadata: {
                    organizationAndTeamData,
                    prNumber,
                    provider,
                },
            });
            return ReviewModeResponse.LIGHT_MODE;
        }
    }
    //#endregion
}
