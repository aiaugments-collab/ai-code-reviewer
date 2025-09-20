import { createLogger, getObservability } from '../../observability/index.js';
import { IdGenerator } from '../../utils/id-generator.js';
import {
    validateWithZod,
    zodToJSONSchema,
} from '../../core/utils/zod-to-json-schema.js';
import { createToolError } from '../../core/error-unified.js';
import {
    ConditionalToolsAction,
    createToolContext,
    ParallelToolsAction,
    SequentialToolsAction,
    ToolCall,
    ToolContext,
    ToolDefinition,
    ToolDependency,
    ToolEngineConfig,
    ToolId,
    ToolMetadataForLLM,
    ToolMetadataForPlanner,
} from '../../core/types/allTypes.js';

export class ToolEngine {
    private logger: ReturnType<typeof createLogger>;
    private tools = new Map<ToolId, ToolDefinition<unknown, unknown>>();
    private config: ToolEngineConfig;

    constructor(config: ToolEngineConfig = {}) {
        this.config = {
            validateSchemas: true,
            ...config,
        };
        this.logger = createLogger('tool-engine');
    }

    /**
     * Register a tool
     */
    registerTool<TInput = unknown, TOutput = unknown>(
        tool: ToolDefinition<TInput, TOutput>,
    ): void {
        this.tools.set(
            tool.name as ToolId,
            tool as ToolDefinition<unknown, unknown>,
        );
        this.logger.info('Tool registered', {
            toolName: tool.name,
        });
    }

    async executeCall<TInput = unknown, TOutput = unknown>(
        toolName: ToolId,
        input: TInput,
        options?: {
            correlationId?: string;
            tenantId?: string;
            signal?: AbortSignal;
        },
    ): Promise<TOutput> {
        const callId = IdGenerator.callId();
        const timeout = this.config.timeout || 120000; // ✅ AUMENTADO: 120s para APIs externas
        const startTime = Date.now();
        const obs = getObservability();
        const correlationId =
            options?.correlationId || obs.getContext()?.correlationId;

        try {
            const result = await obs.traceTool<TOutput>(
                String(toolName),
                async () => {
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(
                                createToolError(
                                    `Tool execution timeout after ${timeout}ms`,
                                    {
                                        retryable: true,
                                        recoverable: true,
                                        context: {
                                            subcode: 'TOOL_TIMEOUT',
                                            timeoutMs: timeout,
                                            toolName,
                                        },
                                    },
                                ),
                            );
                        }, timeout);
                    });

                    const abortPromise = options?.signal
                        ? new Promise<never>((_, reject) => {
                              const signal = options!.signal as AbortSignal;
                              const onAbort = () => {
                                  signal.removeEventListener('abort', onAbort);
                                  reject(
                                      createToolError(
                                          'Tool execution aborted',
                                          {
                                              retryable: true,
                                              recoverable: true,
                                              context: {
                                                  subcode: 'ABORTED',
                                                  toolName,
                                              },
                                          },
                                      ),
                                  );
                              };
                              signal.addEventListener('abort', onAbort);
                          })
                        : undefined;

                    const executionPromise = this.executeToolInternal<
                        TInput,
                        TOutput
                    >(toolName, input, callId, {
                        correlationId,
                        tenantId: options?.tenantId,
                        signal: options?.signal,
                    });

                    const races = [
                        executionPromise,
                        timeoutPromise,
                    ] as Promise<unknown>[];
                    if (abortPromise) races.push(abortPromise);
                    const res = (await Promise.race(races)) as TOutput;
                    return res;
                },
                {
                    correlationId,
                    timeoutMs: timeout,
                    parameters: (input as any) || {},
                },
            );

            return result;
        } catch (error) {
            const lastError = error as Error;
            const executionTime = Date.now() - startTime;

            this.logger.error(
                '❌ TOOL ENGINE - Tool execution failed',
                lastError,
                {
                    toolName,
                    callId,
                    correlationId,
                    error: lastError.message,
                    errorType: lastError.constructor.name,
                    executionTime,
                    isTimeout: lastError.message.includes('timeout'),
                    trace: {
                        source: 'tool-engine',
                        step: 'executeCall-error',
                        timestamp: Date.now(),
                    },
                },
            );

            throw lastError;
        }
    }

    /**
     * Internal tool execution method
     */
    private async executeToolInternal<TInput = unknown, TOutput = unknown>(
        toolName: ToolId,
        input: TInput,
        callId: string,
        options?: {
            correlationId?: string;
            tenantId?: string;
            signal?: AbortSignal;
        },
    ): Promise<TOutput> {
        const tool = this.tools.get(toolName) as ToolDefinition<
            TInput,
            TOutput
        >;

        if (!tool) {
            const notFoundError = createToolError(
                `Tool not found: ${toolName}`,
                {
                    retryable: false,
                    recoverable: false,
                    context: {
                        subcode: 'TOOL_NOT_FOUND',
                        toolName,
                        availableTools: Array.from(this.tools.keys()),
                    },
                },
            );
            this.logger.error(
                '❌ TOOL ENGINE - Tool not found',
                notFoundError,
                {
                    toolName,
                    callId,
                    availableTools: Array.from(this.tools.keys()),
                    trace: {
                        source: 'tool-engine',
                        step: 'tool-not-found',
                        timestamp: Date.now(),
                    },
                },
            );
            throw notFoundError;
        }

        this.validateToolInput(tool, input);

        let result: TOutput;
        let error: Error | undefined;

        try {
            const context = await this.createEnhancedToolContext(
                tool.name,
                callId,
                `exec-${Date.now()}`,
                options?.tenantId || 'default',
                input as Record<string, unknown>,
                options,
            );

            result = await tool.execute(input, context);
        } catch (err) {
            error = err as Error;
            // Standardize unexpected errors into EnhancedToolError
            throw createToolError(error.message || 'Tool execution failed', {
                context: {
                    subcode: 'EXECUTION_ERROR',
                    toolName,
                },
            });
        }

        return result;
    }

    private async createEnhancedToolContext(
        toolName: string,
        callId: string,
        executionId: string,
        tenantId: string,
        parameters: Record<string, unknown>,
        options?: {
            correlationId?: string;
            parentId?: string;
            metadata?: any;
            signal?: AbortSignal;
        },
    ): Promise<ToolContext> {
        // Start with basic tool context
        const basicContext = createToolContext(
            toolName,
            callId,
            executionId,
            tenantId,
            parameters,
            {
                ...(options?.correlationId && {
                    correlationId: options.correlationId,
                }),
                ...(options?.parentId && { parentId: options.parentId }),
                metadata: options?.metadata,
                signal: options?.signal,
            },
        );

        return basicContext;
    }

    /**
     * Get available tools with metadata for planner context engineering
     * Includes both built-in tools and external tools
     */
    getAvailableTools(): ToolMetadataForPlanner[] {
        const externalTools = Array.from(this.tools.values()).map((tool) =>
            this.convertToolToPlannerFormat(tool),
        );

        return [...externalTools];
    }

    /**
     * Convert tool to planner format - SIMPLIFIED
     */
    private convertToolToPlannerFormat(
        tool: ToolDefinition<unknown, unknown>,
    ): ToolMetadataForPlanner {
        let inputParameters: Record<string, unknown>;
        let outputParameters: Record<string, unknown>;

        if (tool.inputJsonSchema) {
            inputParameters = tool.inputJsonSchema.parameters;
        } else if (tool.inputSchema) {
            try {
                const converted = zodToJSONSchema(
                    tool.inputSchema,
                    tool.name,
                    tool.description || `Tool: ${tool.name}`,
                );
                inputParameters = converted.parameters;
            } catch {
                inputParameters = { type: 'object', properties: {} };
            }
        } else {
            inputParameters = { type: 'object', properties: {} };
        }

        if (tool.outputJsonSchema) {
            outputParameters = tool.outputJsonSchema.parameters;
        } else if (tool.outputSchema) {
            try {
                const converted = zodToJSONSchema(
                    tool.outputSchema,
                    tool.name,
                    tool.description || `Tool: ${tool.name}`,
                );
                outputParameters = converted.parameters;
            } catch {
                outputParameters = { type: 'object', properties: {} };
            }
        } else {
            outputParameters = { type: 'object', properties: {} };
        }

        return {
            name: tool.name,
            description: tool.description || `Tool: ${tool.name}`,
            inputSchema: {
                type: 'object' as const,
                properties: this.extractPropertiesWithRequiredFlag(
                    (inputParameters.properties as Record<string, unknown>) ||
                        {},
                    (inputParameters.required as string[]) || [],
                ),
                required: (inputParameters.required as string[]) || [],
            },
            outputSchema: {
                type: 'object' as const,
                properties: this.extractPropertiesWithRequiredFlag(
                    (outputParameters.properties as Record<string, unknown>) ||
                        {},
                    (outputParameters.required as string[]) || [],
                ),
                required: (outputParameters.required as string[]) || [],
            },
            config: {
                timeout: 60000,
                requiresAuth: false,
                allowParallel: true,
                maxConcurrentCalls: 5,
                source: 'user' as const,
            },
            categories: tool.categories || [],
            dependencies: tool.dependencies || [],
            tags: tool.tags || [],
            errorHandling: tool.errorHandling || {
                retryStrategy: 'none',
                maxRetries: 0,
                fallbackAction: 'continue',
                errorMessages: {},
            },
        };
    }

    getToolsForLLM(): ToolMetadataForLLM[] {
        const externalTools = this.listTools()?.map((tool) =>
            this.convertToolToLLMFormat(tool),
        );

        return [...externalTools];
    }

    /**
     * Convert tool to LLM format - SIMPLIFIED
     */
    private convertToolToLLMFormat(
        tool: ToolDefinition<unknown, unknown>,
    ): ToolMetadataForLLM {
        let parameters: Record<string, unknown>;

        if (tool.inputJsonSchema) {
            parameters = tool.inputJsonSchema.parameters;
        } else if (tool.inputSchema) {
            try {
                const converted = zodToJSONSchema(
                    tool.inputSchema,
                    tool.name,
                    tool.description || `Tool: ${tool.name}`,
                );
                parameters = converted.parameters;
            } catch {
                parameters = { type: 'object', properties: {} };
            }
        } else {
            parameters = { type: 'object', properties: {} };
        }

        return {
            name: tool.name,
            description: tool.description || `Tool: ${tool.name}`,
            parameters,
        };
    }

    /**
     * Extract properties with required flag for planner context
     */
    private extractPropertiesWithRequiredFlag(
        properties: Record<string, unknown>,
        requiredFields: string[],
    ): Record<
        string,
        {
            type: string;
            description?: string;
            required: boolean;
            enum?: string[];
            default?: unknown;
            format?: string;
        }
    > {
        const result: Record<
            string,
            {
                type: string;
                description?: string;
                required: boolean;
                enum?: string[];
                default?: unknown;
                format?: string;
            }
        > = {};

        for (const [key, prop] of Object.entries(properties)) {
            const propObj = prop as Record<string, unknown>;
            result[key] = {
                type: (propObj.type as string) || 'string',
                description: propObj.description as string | undefined,
                required: requiredFields.includes(key),
                enum: propObj.enum as string[] | undefined,
                default: propObj.default,
                format: propObj.format as string | undefined,
            };
        }

        return result;
    }

    /**
     * Get a specific tool by name (for testing compatibility)
     */
    getTool<TInput = unknown, TOutput = unknown>(
        name: string,
    ): ToolDefinition<TInput, TOutput> | undefined {
        return this.tools.get(name as ToolId) as
            | ToolDefinition<TInput, TOutput>
            | undefined;
    }

    /**
     * List all tools (for testing compatibility)
     */
    listTools(): ToolDefinition<unknown, unknown>[] {
        return Array.from(this.tools.values());
    }

    /**
     * Check if tool result contains an error
     */
    //TODO ver para poder usar ele
    // private checkToolResultError(result: unknown): boolean {
    //     if (!result || typeof result !== 'object') {
    //         return false;
    //     }

    //     const resultObj = result as Record<string, unknown>;

    //     if (resultObj.error || resultObj.isError === true) {
    //         return true;
    //     }

    //     if (resultObj.result && typeof resultObj.result === 'object') {
    //         const innerResult = resultObj.result as Record<string, unknown>;
    //         if (innerResult.isError === true || innerResult.error) {
    //             return true;
    //         }

    //         if (innerResult.successful === false) {
    //             return true;
    //         }
    //     }

    //     if (resultObj.success === false) {
    //         return true;
    //     }

    //     return false;
    // }

    async executeTool<TInput = unknown, TOutput = unknown>(
        toolName: string,
        input: TInput,
        options?: {
            signal?: AbortSignal;
            correlationId?: string;
            tenantId?: string;
        },
    ): Promise<TOutput> {
        const callId = IdGenerator.callId();
        const timeout = this.config.timeout || 80000;
        const startTime = Date.now();
        const obs = getObservability();

        try {
            const result = await obs.traceTool<TOutput>(
                String(toolName),
                async () => {
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(
                                createToolError(
                                    `Tool execution timeout after ${timeout}ms`,
                                    {
                                        retryable: true,
                                        recoverable: true,
                                        context: {
                                            subcode: 'TOOL_TIMEOUT',
                                            timeoutMs: timeout,
                                            toolName,
                                        },
                                    },
                                ),
                            );
                        }, timeout);
                    });

                    const abortPromise = options?.signal
                        ? new Promise<never>((_, reject) => {
                              const signal = options!.signal as AbortSignal;
                              const onAbort = () => {
                                  signal.removeEventListener('abort', onAbort);
                                  reject(
                                      createToolError(
                                          'Tool execution aborted',
                                          {
                                              retryable: true,
                                              recoverable: true,
                                              context: {
                                                  subcode: 'ABORTED',
                                                  toolName,
                                              },
                                          },
                                      ),
                                  );
                              };
                              signal.addEventListener('abort', onAbort);
                          })
                        : undefined;

                    const executionPromise = this.executeToolInternal<
                        TInput,
                        TOutput
                    >(toolName as ToolId, input, callId, {
                        correlationId: options?.correlationId,
                        tenantId: options?.tenantId,
                        signal: options?.signal,
                    });

                    const races = [
                        executionPromise,
                        timeoutPromise,
                    ] as Promise<unknown>[];
                    if (abortPromise) races.push(abortPromise);
                    const res = await Promise.race(races);
                    return res as TOutput;
                },
                {
                    correlationId: options?.correlationId,
                    timeoutMs: timeout,
                    parameters: (input as any) || {},
                },
            );

            return result;
        } catch (error) {
            const lastError = error as Error;
            const executionTime = Date.now() - startTime;

            this.logger.error(
                '❌ TOOL EXECUTION FAILED (executeTool)',
                lastError,
                {
                    toolName,
                    callId,
                    error: lastError.message,
                    executionTime,
                    trace: {
                        source: 'tool-engine',
                        step: 'tool-execution-failed',
                        timestamp: Date.now(),
                    },
                },
            );

            throw lastError;
        }
    }

    private resolveToolDependencies(
        tools: ToolCall[],
        dependencies: ToolDependency[],
    ): {
        executionOrder: ToolCall[][];
        warnings: string[];
    } {
        const warnings: string[] = [];
        const toolMap = new Map<string, ToolCall>();
        const dependencyMap = new Map<string, ToolDependency[]>();
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const executionPhases: ToolCall[][] = [];

        for (const tool of tools) {
            toolMap.set(tool.toolName, tool);
        }

        const actualDependencyMap = new Map<string, string[]>();
        for (const dep of dependencies) {
            actualDependencyMap.set(dep.toolName, dep.dependencies || []);
            if (!dependencyMap.has(dep.toolName)) {
                dependencyMap.set(dep.toolName, []);
            }
            dependencyMap.get(dep.toolName)!.push(dep);
        }

        const sortedTools: string[] = [];

        function visit(toolName: string): void {
            if (visiting.has(toolName)) {
                warnings.push(
                    `Circular dependency detected involving tool: ${toolName}`,
                );
                return;
            }
            if (visited.has(toolName)) {
                return;
            }

            visiting.add(toolName);

            const deps = actualDependencyMap.get(toolName) || [];
            for (const depToolName of deps) {
                if (toolMap.has(depToolName)) {
                    visit(depToolName);
                }
            }

            visiting.delete(toolName);
            visited.add(toolName);
            sortedTools.push(toolName);
        }

        for (const tool of tools) {
            if (!visited.has(tool.toolName)) {
                visit(tool.toolName);
            }
        }

        const phases: Map<number, ToolCall[]> = new Map();
        const toolPhases = new Map<string, number>();

        for (const toolName of sortedTools) {
            const tool = toolMap.get(toolName);
            if (!tool) continue;

            let phase = 0;
            const deps = dependencyMap.get(toolName) || [];

            for (const dep of deps) {
                if (dep.type === 'required') {
                    const depPhase = toolPhases.get(dep.toolName);
                    if (depPhase !== undefined) {
                        phase = Math.max(phase, depPhase + 1);
                    }
                }
            }

            toolPhases.set(toolName, phase);

            if (!phases.has(phase)) {
                phases.set(phase, []);
            }
            phases.get(phase)!.push(tool);
        }

        const sortedPhases = Array.from(phases.keys()).sort((a, b) => a - b);
        for (const phaseNum of sortedPhases) {
            executionPhases.push(phases.get(phaseNum)!);
        }

        return {
            executionOrder: executionPhases,
            warnings,
        };
    }

    async executeWithDependencies<TOutput = unknown>(
        tools: ToolCall[],
        dependencies: ToolDependency[],
        options: {
            maxConcurrency?: number;
            timeout?: number;
            failFast?: boolean;
        } = {},
    ): Promise<Array<{ toolName: string; result?: TOutput; error?: string }>> {
        const { executionOrder, warnings } = this.resolveToolDependencies(
            tools,
            dependencies,
        );

        for (const warning of warnings) {
            this.logger.warn('Dependency resolution warning', { warning });
        }

        const allResults: Array<{
            toolName: string;
            result?: TOutput;
            error?: string;
        }> = [];
        const resultMap = new Map<string, TOutput>();

        for (
            let phaseIndex = 0;
            phaseIndex < executionOrder.length;
            phaseIndex++
        ) {
            const phase = executionOrder[phaseIndex];

            const phaseResults = await this.executeParallelTools<TOutput>({
                type: 'parallel_tools',
                tools: phase || [],
                concurrency: options.maxConcurrency || 5,
                timeout: options.timeout || 60000,
                failFast: options.failFast || false,
            });

            for (const result of phaseResults) {
                if (result.result !== undefined) {
                    resultMap.set(result.toolName, result.result);
                }
                allResults.push(result);

                if (result.error && options.failFast) {
                    const dependentTools = dependencies.filter(
                        (d) =>
                            d.toolName === result.toolName &&
                            d.type === 'required',
                    );

                    if (dependentTools.length > 0) {
                        throw new Error(
                            `Required tool ${result.toolName} failed, stopping execution: ${result.error}`,
                        );
                    }
                }
            }
        }

        return allResults;
    }

    async executeParallelTools<TOutput = unknown>(
        action: ParallelToolsAction,
    ): Promise<Array<{ toolName: string; result?: TOutput; error?: string }>> {
        const concurrency = action.concurrency || 5;
        const timeout = action.timeout || 60000;
        const results: Array<{
            toolName: string;
            result?: TOutput;
            error?: string;
        }> = [];

        try {
            const batches = this.createBatches(action.tools, concurrency);

            for (const batch of batches) {
                const batchPromises = batch.map(async (toolCall) => {
                    try {
                        const result = await this.executeCall<unknown, TOutput>(
                            toolCall.toolName as ToolId,
                            toolCall.arguments,
                        );
                        return { toolName: toolCall.toolName, result };
                    } catch (error) {
                        const errorMessage =
                            error instanceof Error
                                ? error.message
                                : String(error);

                        if (action.failFast) {
                            throw new Error(
                                `Tool ${toolCall.toolName} failed: ${errorMessage}`,
                            );
                        }

                        return {
                            toolName: toolCall.toolName,
                            error: errorMessage,
                        };
                    }
                });

                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(
                        () =>
                            reject(
                                new Error(
                                    `Parallel execution timeout after ${timeout}ms`,
                                ),
                            ),
                        timeout,
                    );
                });

                const batchResults = await Promise.race([
                    Promise.all(batchPromises),
                    timeoutPromise,
                ]);

                results.push(...batchResults);

                if (action.failFast && results.some((r) => r.error)) {
                    break;
                }
            }

            return results;
        } catch (error) {
            throw error;
        }
    }

    async executeSequentialTools<TOutput = unknown>(
        action: SequentialToolsAction,
    ): Promise<Array<{ toolName: string; result?: TOutput; error?: string }>> {
        const results: Array<{
            toolName: string;
            result?: TOutput;
            error?: string;
        }> = [];
        let previousResult: TOutput | undefined;

        try {
            for (const toolCall of action.tools) {
                try {
                    // Pass previous result if configured
                    const input =
                        action.passResults && previousResult
                            ? {
                                  ...(toolCall.arguments as object),
                                  previousResult,
                              }
                            : toolCall.arguments;

                    const result = await this.executeCall<unknown, TOutput>(
                        toolCall.toolName as ToolId,
                        input,
                    );

                    results.push({ toolName: toolCall.toolName, result });
                    previousResult = result;
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    results.push({
                        toolName: toolCall.toolName,
                        error: errorMessage,
                    });

                    if (action.stopOnError) {
                        this.logger.warn(
                            'Sequential execution stopped due to error',
                            {
                                toolName: toolCall.toolName,
                                error: errorMessage,
                            },
                        );
                        break;
                    }
                }
            }

            return results;
        } catch (error) {
            throw error;
        }
    }

    async executeConditionalTools<TOutput = unknown>(
        action: ConditionalToolsAction,
    ): Promise<Array<{ toolName: string; result?: TOutput; error?: string }>> {
        const results: Array<{
            toolName: string;
            result?: TOutput;
            error?: string;
        }> = [];

        try {
            const remainingTools = [...action.tools];
            const globalConditions = action.conditions || {};

            while (remainingTools.length > 0) {
                const executableTools: ToolCall[] = [];

                for (let i = remainingTools.length - 1; i >= 0; i--) {
                    const toolCall = remainingTools[i];
                    if (
                        toolCall &&
                        this.evaluateConditions(
                            toolCall,
                            globalConditions,
                            results,
                        )
                    ) {
                        executableTools.push(toolCall);
                        remainingTools.splice(i, 1);
                    }
                }

                if (executableTools.length === 0) {
                    if (action.defaultTool && remainingTools.length > 0) {
                        const defaultToolCall = remainingTools.find(
                            (t) => t.toolName === action.defaultTool,
                        );
                        if (defaultToolCall) {
                            executableTools.push(defaultToolCall);
                            const index =
                                remainingTools.indexOf(defaultToolCall);
                            if (index > -1) {
                                remainingTools.splice(index, 1);
                            }
                        }
                    } else {
                        break;
                    }
                }

                if (action.evaluateAll) {
                    const parallelPromises = executableTools.map(
                        async (toolCall) => {
                            try {
                                const result = await this.executeCall<
                                    unknown,
                                    TOutput
                                >(
                                    toolCall.toolName as ToolId,
                                    toolCall.arguments,
                                );
                                return { toolName: toolCall.toolName, result };
                            } catch (error) {
                                const errorMessage =
                                    error instanceof Error
                                        ? error.message
                                        : String(error);
                                return {
                                    toolName: toolCall.toolName,
                                    error: errorMessage,
                                };
                            }
                        },
                    );

                    const batchResults = await Promise.all(parallelPromises);
                    results.push(...batchResults);
                } else {
                    for (const toolCall of executableTools) {
                        try {
                            const result = await this.executeCall<
                                unknown,
                                TOutput
                            >(toolCall.toolName as ToolId, toolCall.arguments);
                            results.push({
                                toolName: toolCall.toolName,
                                result,
                            });
                        } catch (error) {
                            const errorMessage =
                                error instanceof Error
                                    ? error.message
                                    : String(error);
                            results.push({
                                toolName: toolCall.toolName,
                                error: errorMessage,
                            });
                        }
                    }
                }
            }

            return results;
        } catch (error) {
            throw error;
        }
    }

    private createBatches<T>(items: T[], batchSize: number): T[][] {
        const batches: T[][] = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }
        return batches;
    }

    private evaluateConditions(
        _toolCall: ToolCall,
        _globalConditions: Record<string, unknown>,
        _results: Array<{
            toolName: string;
            result?: unknown;
            error?: string;
        }> = [],
    ): boolean {
        return true;
    }

    private validateToolInput<T>(tool: ToolDefinition<T>, input: T): void {
        if (this.config.validateSchemas === false) {
            return;
        }

        this.logger.debug('🔍 Validating tool input', {
            toolName: tool.name,
            inputType: typeof input,
            hasInputSchema: !!tool.inputSchema,
            inputValue:
                typeof input === 'object'
                    ? JSON.stringify(input)
                    : String(input),
        });

        if (tool.inputSchema) {
            try {
                const validation = validateWithZod(tool.inputSchema, input);
                if (!validation.success) {
                    this.logger.error(
                        `Tool input validation failed: ${validation.error}`,
                        new Error(
                            `Tool input validation failed: ${validation.error}`,
                        ),
                        {
                            toolName: tool.name,
                            validationError: validation.error,
                            inputType: typeof input,
                            inputValue:
                                typeof input === 'object'
                                    ? JSON.stringify(input)
                                    : String(input),
                            schemaType: tool.inputSchema.constructor.name,
                        },
                    );

                    const missingParams = this.extractMissingParameters(
                        validation.error,
                    );

                    throw createToolError(validation.error, {
                        severity: 'low',
                        domain: 'business',
                        userImpact: 'degraded',
                        retryable: false,
                        recoverable: true,
                        context: {
                            toolName: tool.name,
                            input,
                            validation,
                            subcode: 'VALIDATION_ERROR',
                        },
                        userMessage: `Tool '${tool.name}' requires specific parameters. ${missingParams.length > 0 ? `Missing: ${missingParams.join(', ')}` : 'Invalid parameters provided.'}`,
                        recoveryHints: [
                            'Check the tool documentation for correct input format',
                            'Ensure all required parameters are provided',
                            'Some tools may require context-specific parameters like organization or team identifiers',
                        ],
                    });
                }

                this.logger.debug('✅ Tool input validation passed', {
                    toolName: tool.name,
                    inputType: typeof input,
                });
            } catch (validationError) {
                this.logger.error(
                    `Unexpected validation error: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
                    new Error(
                        `Unexpected validation error: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
                    ),
                    {
                        toolName: tool.name,
                        error:
                            validationError instanceof Error
                                ? validationError.message
                                : String(validationError),
                        inputType: typeof input,
                        inputValue:
                            typeof input === 'object'
                                ? JSON.stringify(input)
                                : String(input),
                    },
                );

                throw createToolError(
                    validationError instanceof Error
                        ? validationError.message
                        : String(validationError),
                    {
                        severity: 'medium',
                        domain: 'business',
                        userImpact: 'degraded',
                        retryable: false,
                        recoverable: true,
                        context: {
                            toolName: tool.name,
                            input,
                            validationError,
                            subcode: 'VALIDATION_ERROR',
                        },
                        userMessage:
                            'An unexpected error occurred during input validation.',
                        recoveryHints: [
                            'Check if the tool schema is properly defined',
                            'Verify the input format matches the expected schema',
                        ],
                    },
                );
            }
        }
    }

    private extractMissingParameters(validationError: string): string[] {
        try {
            const errorObj = JSON.parse(validationError);
            if (Array.isArray(errorObj)) {
                return errorObj
                    .filter(
                        (error: unknown) =>
                            typeof error === 'object' &&
                            error !== null &&
                            'code' in error &&
                            'message' in error &&
                            error.code === 'invalid_type' &&
                            typeof error.message === 'string' &&
                            error.message.includes('received undefined'),
                    )
                    .map((error: unknown) => {
                        if (
                            typeof error === 'object' &&
                            error !== null &&
                            'path' in error
                        ) {
                            const path = (error as { path?: unknown }).path;
                            if (
                                Array.isArray(path) &&
                                path.length > 0 &&
                                typeof path[0] === 'string'
                            ) {
                                return path[0];
                            }
                        }
                        return null;
                    })
                    .filter((param): param is string => param !== null);
            }
        } catch {
            const match = validationError.match(/path":\s*\["([^"]+)"\]/);
            return match && match[1] ? [match[1]] : [];
        }
        return [];
    }

    async cleanup(): Promise<void> {
        this.tools.clear();
        this.logger.info('Tool engine cleaned up');
    }
}
