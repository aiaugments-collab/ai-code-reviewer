import {
    AgentInputEnum,
    getResultContent,
    getResultError,
    LLMAdapter,
    ResponseSynthesisContext,
    SynthesisStrategy,
    SynthesizedResponse,
    UNIFIED_STATUS,
} from '../../core/types/allTypes.js';
import { createLogger } from '../../observability/index.js';
import { isErrorResult } from '../../core/utils/tool-result-parser.js';
import { getObservability } from '../../observability/index.js';
import { SPAN_NAMES } from '../../observability/semantic-conventions.js';

export class ResponseSynthesizer {
    private logger = createLogger('response-synthesizer');

    constructor(
        private llmAdapter: LLMAdapter,
        private llmDefaults?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
            maxReasoningTokens?: number;
            stop?: string[];
        },
    ) {
        this.logger.info('Response Synthesizer initialized', {
            llmProvider: llmAdapter.getProvider?.()?.name || 'unknown',
            supportsStructured:
                llmAdapter.supportsStructuredGeneration?.() || false,
        });
    }

    async synthesize(
        context: ResponseSynthesisContext,
        strategy: SynthesisStrategy = 'conversational',
    ): Promise<SynthesizedResponse> {
        const startTime = Date.now();

        this.logger.info('Starting response synthesis', {
            originalQuery: context.originalQuery.substring(0, 100),
            plannerType: context.plannerType,
            resultsCount: context.executionResults.length,
            strategy,
            stepsExecuted: context.metadata.completedSteps,
        });

        const observability = getObservability();
        return await observability.trace(
            SPAN_NAMES.AGENT_SYNTHESIZE,
            async () => {
                try {
                    const analysis = this.analyzeExecutionResults(context);
                    const synthesizedContent =
                        await this.applySynthesisStrategy(
                            strategy,
                            context,
                            analysis,
                        );

                    const response: SynthesizedResponse = {
                        content: synthesizedContent,
                        needsClarification: analysis.hasAmbiguousResults,
                        includesError: analysis.hasErrors,
                        metadata: {
                            synthesisStrategy: strategy,
                            discoveryCount: analysis.rawResults.length,
                            primaryFindings: analysis.rawResults
                                .slice(0, 3)
                                .map((r) =>
                                    typeof r === 'string'
                                        ? r
                                        : JSON.stringify(r).substring(0, 100),
                                ),
                            synthesisTime: Date.now() - startTime,
                        },
                    };

                    return response;
                } catch (error) {
                    this.logger.error(
                        'Response synthesis failed',
                        error as Error,
                        {
                            originalQuery: context.originalQuery.substring(
                                0,
                                100,
                            ),
                            strategy,
                        },
                    );

                    return this.createFallbackResponse(context, error as Error);
                }
            },
            {
                attributes: {
                    plannerType: context.plannerType,
                    stepsExecuted: context.metadata.completedSteps,
                    totalSteps: context.metadata.totalSteps,
                    correlationId:
                        getObservability().getContext()?.correlationId || '',
                },
            },
        );
    }

    private analyzeExecutionResults(context: ResponseSynthesisContext) {
        const rawResults: unknown[] = [];
        const errors: string[] = [];
        const warnings: string[] = [];
        let hasAmbiguousResults = false;

        context.executionResults.forEach((result, resultIndex) => {
            if (isErrorResult(result)) {
                const errorMsg = getResultError(result);
                if (errorMsg) {
                    errors.push(`Step ${resultIndex + 1}: ${errorMsg}`);
                }
            } else {
                const content = getResultContent(result);
                if (content) {
                    rawResults.push(content);
                }
            }
        });

        if (context.planSteps) {
            context.planSteps.forEach((step) => {
                if (step.status === UNIFIED_STATUS.FAILED) {
                    errors.push(`Failed: ${step.description}`);
                } else if (
                    step.status === UNIFIED_STATUS.COMPLETED &&
                    step.result
                ) {
                    rawResults.push(step.result);
                }
            });
        }

        if (rawResults.length === 0 && errors.length === 0) {
            hasAmbiguousResults = true;
            warnings.push('No clear results found');
        }

        return {
            rawResults,
            errors,
            warnings,
            hasErrors: errors.length > 0,
            hasAmbiguousResults,
            successRate:
                context.metadata.completedSteps / context.metadata.totalSteps,
        };
    }

    private async applySynthesisStrategy(
        strategy: SynthesisStrategy,
        context: ResponseSynthesisContext,
        analysis: ReturnType<
            typeof ResponseSynthesizer.prototype.analyzeExecutionResults
        >,
    ): Promise<string> {
        switch (strategy) {
            case 'conversational':
                return this.conversationalSynthesis(context, analysis);
            case 'summary':
                return this.summarySynthesis(context, analysis);
            case 'problem-solution':
                return this.problemSolutionSynthesis(context, analysis);
            case 'technical':
                return this.technicalSynthesis(context, analysis);
            default:
                return this.conversationalSynthesis(context, analysis);
        }
    }

    private composeStructuredExecutionTrace(
        context: ResponseSynthesisContext,
        analysis: ReturnType<
            typeof ResponseSynthesizer.prototype.analyzeExecutionResults
        >,
    ): string {
        const hasData =
            analysis.rawResults.length > 0 ||
            analysis.errors.length > 0 ||
            context.planSteps?.length;

        if (!hasData) {
            return 'No execution data available.';
        }

        const parts: string[] = [];

        // Use planSteps if available (more structured), otherwise fallback to executionResults
        if (context.planSteps && context.planSteps.length > 0) {
            const successSteps = context.planSteps.filter(
                (step) => step.status === UNIFIED_STATUS.COMPLETED,
            );
            const failedSteps = context.planSteps.filter(
                (step) => step.status === UNIFIED_STATUS.FAILED,
            );
            const skippedSteps = context.planSteps.filter(
                (step) => step.status === UNIFIED_STATUS.SKIPPED,
            );

            if (successSteps.length > 0) {
                parts.push('<success>');
                successSteps.forEach((step) => {
                    parts.push(`  <step id="${step.id}" status="completed">`);
                    parts.push(
                        `    <description>${step.description}</description>`,
                    );
                    if (step.result) {
                        const resultStr =
                            typeof step.result === 'string'
                                ? step.result
                                : JSON.stringify(step.result);
                        parts.push(`<output>${resultStr}</output>`);
                    }
                    parts.push('</step>');
                });
                parts.push('</success>');
            }

            if (failedSteps.length > 0) {
                parts.push('<errors>');
                failedSteps.forEach((step) => {
                    parts.push(`  <step id="${step.id}" status="failed">`);
                    parts.push(
                        `    <description>${step.description}</description>`,
                    );
                    if (step.result) {
                        const errorStr =
                            typeof step.result === 'string'
                                ? step.result
                                : JSON.stringify(step.result);
                        parts.push(`    <error>${errorStr}</error>`);
                    }
                    parts.push('</step>');
                });
                parts.push('</errors>');
            }

            if (skippedSteps.length > 0) {
                parts.push('<skipped>');
                skippedSteps.forEach((step) => {
                    parts.push(`  <step id="${step.id}" status="skipped">`);
                    parts.push(
                        `    <description>${step.description}</description>`,
                    );
                    parts.push('  </step>');
                });
                parts.push('</skipped>');
            }
        } else {
            // Fallback to analysis data if planSteps not available
            if (analysis.rawResults.length > 0) {
                parts.push('<success>');
                analysis.rawResults.forEach((result, idx) => {
                    const resultStr =
                        typeof result === 'string'
                            ? result
                            : JSON.stringify(result);
                    parts.push(`  <result index="${idx + 1}">`);
                    parts.push(`    <output>${resultStr}</output>`);
                    parts.push('  </result>');
                });
                parts.push('</success>');
            }

            if (analysis.errors.length > 0) {
                parts.push('<errors>');
                analysis.errors.forEach((error, idx) => {
                    parts.push(`  <error index="${idx + 1}">`);
                    parts.push(`    <message>${error}</message>`);
                    parts.push('  </error>');
                });
                parts.push('</errors>');
            }
        }

        return parts.length > 0
            ? parts.join('\n')
            : 'No structured execution data available.';
    }

    private async conversationalSynthesis(
        context: ResponseSynthesisContext,
        analysis: ReturnType<
            typeof ResponseSynthesizer.prototype.analyzeExecutionResults
        >,
    ): Promise<string> {
        const prompt = `
You are the Final Responder. Your job is to turn tool **EXECUTION RESULTS** into a clear answer to the **USER REQUEST**.

## Inputs
- USER REQUEST: the user's original message.
- EXECUTION RESULTS: a JSON array of tool outputs (may be empty or partially failing).

## Output rules
- Reply in the **same language** as the user.
- Be **direct, specific, and concise**. Pull only what matters from EXECUTION RESULTS.
- If a tool error occurred or results are empty/partial, **state it briefly** and suggest the next step.
- **Never** invent IDs, Identificators, links, numbers, or facts that aren't in EXECUTION RESULTS or the request.
- Do **not** mention internal planning, tools, or chain-of-thought.

## Missing-info detector (agnostic)
If the user asked you to deliver/post something to an **external destination** (e.g., workspace, page, channel, document, issue) and the EXECUTION RESULTS / CONTEXT do **not** include the required **resource identifier(s)** (such as a URL/ID/path/project key):
1) Provide the analysis/summary locally in your reply, and
2) Ask **exactly** for the minimum missing field(s) in **one short question**:
   - If the request names a platform but not the identifier → ask only for the identifier:
     “To proceed, please share the destination’s identifier (for that platform), e.g., a URL or ID.”
   - If the request does **not** name a platform → ask for both:
     “Which destination should I use? Please provide the platform and the resource identifier (URL or ID).”
Do not guess platforms or IDs. Do not claim the action was performed.

## Structure
1) **Brief confirmation** of what was asked.
2) **What we found**: 3–8 bullets of concrete facts from EXECUTION RESULTS (titles, states, links, key diffs/values).
3) **(Optional) Ready-to-share snippet**: a clean, copy-pastable message the user can post elsewhere.
4) **Next step**:
   - If anything is missing to complete the request, ask for it in **one line** (per the rules above).
   - Otherwise, say you’re ready to proceed.

## Formatting
- Use short headings and bullets; avoid long paragraphs.
- If a URL appears in EXECUTION RESULTS, you may include it verbatim.
- If there’s a diff or code, include a **small excerpt (≤20 lines)** or summarize it.

## Safety & Tone
- Neutral, helpful, professional.
- No placeholders like “TBD”.
- No apologies unless there’s a real error.

Now produce the response using USER REQUEST and EXECUTION RESULTS.

USER REQUEST: "${context.originalQuery}"

EXECUTION RESULTS:
${this.composeStructuredExecutionTrace(context, analysis)}
`;

        try {
            const response = await this.llmAdapter.call({
                messages: [{ role: AgentInputEnum.USER, content: prompt }],
                model: this.llmDefaults?.model,
                temperature: this.llmDefaults?.temperature,
                maxTokens: this.llmDefaults?.maxTokens,
                maxReasoningTokens: this.llmDefaults?.maxReasoningTokens,
                stop: this.llmDefaults?.stop,
                signal: context.signal,
            });

            return (
                response.content || this.createBasicResponse(context, analysis)
            );
        } catch (error) {
            this.logger.warn('LLM synthesis failed, using basic response', {
                error: (error as Error).message,
            });
            return this.createBasicResponse(context, analysis);
        }
    }

    private async summarySynthesis(
        context: ResponseSynthesisContext,
        analysis: ReturnType<
            typeof ResponseSynthesizer.prototype.analyzeExecutionResults
        >,
    ): Promise<string> {
        const prompt = `Create a summary response for the user's request.

USER REQUEST: "${context.originalQuery}"

EXECUTION RESULTS:
${analysis.rawResults.length > 0 ? JSON.stringify(analysis.rawResults, null, 2) : 'No data found.'}

ERRORS (if any):
${analysis.errors.length > 0 ? analysis.errors.join('\n') : 'None'}

EXECUTION STATS:
- Steps completed: ${context.metadata.completedSteps}/${context.metadata.totalSteps}
- Success rate: ${Math.round(analysis.successRate * 100)}%

INSTRUCTIONS:
- Create a clear summary in the same language as the user's request
- Include the main findings from the results
- Mention any errors if they occurred
- Include execution statistics
- Format as a well-structured summary

Response:`;

        try {
            const response = await this.llmAdapter.call({
                messages: [{ role: AgentInputEnum.USER, content: prompt }],
                model: this.llmDefaults?.model,
                temperature: this.llmDefaults?.temperature,
                maxTokens: this.llmDefaults?.maxTokens,
                maxReasoningTokens: this.llmDefaults?.maxReasoningTokens,
                stop: this.llmDefaults?.stop,
                signal: context.signal,
            });
            return (
                response.content || this.createBasicResponse(context, analysis)
            );
        } catch (error) {
            this.logger.warn('LLM summary synthesis failed', {
                error: (error as Error).message,
            });
            return this.createBasicResponse(context, analysis);
        }
    }

    private async problemSolutionSynthesis(
        context: ResponseSynthesisContext,
        analysis: ReturnType<
            typeof ResponseSynthesizer.prototype.analyzeExecutionResults
        >,
    ): Promise<string> {
        const prompt = `Analyze the request and provide a problem-solution focused response.

USER REQUEST: "${context.originalQuery}"

RESULTS:
${analysis.rawResults.length > 0 ? JSON.stringify(analysis.rawResults, null, 2) : 'No results found.'}

ISSUES/ERRORS:
${analysis.errors.length > 0 ? analysis.errors.join('\n') : 'No issues found.'}

EXECUTION INFO:
- Success rate: ${Math.round(analysis.successRate * 100)}%
- Steps completed: ${context.metadata.completedSteps}/${context.metadata.totalSteps}

INSTRUCTIONS:
- Respond in the same language as the user's request
- Focus on problems found and their solutions
- Highlight any issues that need attention
- Suggest actionable next steps
- Be constructive and solution-oriented

Response:`;

        try {
            const response = await this.llmAdapter.call({
                messages: [{ role: AgentInputEnum.USER, content: prompt }],
                signal: context.signal,
            });
            return (
                response.content || this.createBasicResponse(context, analysis)
            );
        } catch (error) {
            this.logger.warn('LLM problem-solution synthesis failed', {
                error: (error as Error).message,
            });
            return this.createBasicResponse(context, analysis);
        }
    }

    private async technicalSynthesis(
        context: ResponseSynthesisContext,
        analysis: ReturnType<
            typeof ResponseSynthesizer.prototype.analyzeExecutionResults
        >,
    ): Promise<string> {
        const planStepsInfo = context.planSteps
            ? context.planSteps.map((step) => ({
                  id: step.id,
                  description: step.description,
                  status: step.status,
                  result: step.result,
              }))
            : [];

        const prompt = `Generate a technical analysis report for the execution.

USER REQUEST: "${context.originalQuery}"

EXECUTION DETAILS:
- Planner Type: ${context.plannerType}
- Steps Completed: ${context.metadata.completedSteps}/${context.metadata.totalSteps}
- Success Rate: ${Math.round(analysis.successRate * 100)}%
- Execution Time: ${context.metadata.executionTime || 'N/A'}ms

PLAN STEPS:
${planStepsInfo.length > 0 ? JSON.stringify(planStepsInfo, null, 2) : 'No plan steps available'}

RESULTS:
${analysis.rawResults.length > 0 ? JSON.stringify(analysis.rawResults, null, 2) : 'No results'}

ERRORS:
${analysis.errors.length > 0 ? analysis.errors.join('\n') : 'No errors'}

INSTRUCTIONS:
- Generate a detailed technical report in the same language as the user's request
- Include all execution details
- Present data in a clear, technical format
- Include performance metrics
- Be precise and comprehensive

Response:`;

        try {
            const response = await this.llmAdapter.call({
                messages: [{ role: AgentInputEnum.USER, content: prompt }],
                signal: context.signal,
            });
            return (
                response.content || this.createBasicResponse(context, analysis)
            );
        } catch (error) {
            this.logger.warn('LLM technical synthesis failed', {
                error: (error as Error).message,
            });
            return this.createBasicResponse(context, analysis);
        }
    }

    private createBasicResponse(
        context: ResponseSynthesisContext,
        analysis: ReturnType<
            typeof ResponseSynthesizer.prototype.analyzeExecutionResults
        >,
    ): string {
        const response = {
            request: context.originalQuery,
            results: analysis.rawResults,
            errors: analysis.errors,
            execution: {
                completed: context.metadata.completedSteps,
                total: context.metadata.totalSteps,
                successRate: analysis.successRate,
            },
        };

        return JSON.stringify(response, null, 2);
    }

    private createFallbackResponse(
        context: ResponseSynthesisContext,
        error: Error,
    ): SynthesizedResponse {
        const errorResponse = {
            type: 'synthesis_error',
            request: context.originalQuery,
            execution: {
                completed: context.metadata.completedSteps,
                total: context.metadata.totalSteps,
            },
            error: error.message,
        };

        return {
            content: JSON.stringify(errorResponse, null, 2),
            needsClarification: true,
            includesError: true,
            metadata: {
                synthesisStrategy: 'error-fallback',
                discoveryCount: 0,
                primaryFindings: [],
                error: error.message,
            },
        };
    }
}

export function createResponseSynthesizer(
    llmAdapter: LLMAdapter,
    llmDefaults?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        maxReasoningTokens?: number;
        stop?: string[];
    },
): ResponseSynthesizer {
    return new ResponseSynthesizer(llmAdapter, llmDefaults);
}
