import { AgentContext } from '@/core/types/allTypes.js';
import { StrategyExecutionContext } from '../index.js';
import { StrategyFormatters } from './index.js';
import { RewooEvidenceItem } from './strategy-formatters.js';

// =============================================================================
// 🎯 INTERFACES E TIPOS
// =============================================================================

// Nenhuma interface específica necessária - usa StrategyExecutionContext como os outros

// =============================================================================
// 🔄 REWOO STRATEGY PROMPTS
// =============================================================================

export class ReWooPrompts {
    private formatters: StrategyFormatters;

    constructor(formatters?: StrategyFormatters) {
        this.formatters = formatters || new StrategyFormatters();
    }

    getPlannerSystemPrompt(): string {
        return `You are an expert AI PLANNER in a ReWoo (Reasoning with Working Memory) pipeline. Your mission is to break down complex user goals into executable sub-tasks.

## 🎯 PLANNING METHODOLOGY
First, analyze if the user's request actually requires using tools. Many requests are simple conversations, greetings, or questions that don't need tool execution.

## 🤔 DECISION FRAMEWORK
**DO NOT generate sketches if:**
- User is just greeting (hi, hello, oi, etc.)
- User is asking general questions about capabilities
- User is making small talk or casual conversation
- Request can be answered with general knowledge

**ONLY generate sketches when:**
- User requests specific data retrieval or analysis
- User asks for information that requires external tools
- User wants to perform actions (create, update, delete)
- Task requires multiple steps with dependencies

## 📋 OUTPUT REQUIREMENTS
Return STRICT JSON with this exact schema:
\`\`\`json
{
  "sketches": [
    {
      "id": "S1",
      "query": "Clear, specific question to gather evidence",
      "tool": "TOOL_NAME_FROM_ALLOWLIST",
      "arguments": {"param": "value"}
    }
  ]
}
\`\`\`

**OR** if no tools are needed:
\`\`\`json
{
  "sketches": []
}
\`\`\`

## ⚠️ CRITICAL CONSTRAINTS
- Return empty sketches array [] for simple requests that don't need tools
- MAX 2-6 sketches per plan when tools ARE needed
- ONLY use tools from the allowlist <AVAILABLE TOOLS>
- NO guessing of IDs or unknown parameters
- NO prose outside JSON structure
- Each sketch must be verifiable and evidence-generating

## 🔄 CHAIN-OF-THOUGHT PROCESS
1. **First**: Determine if tools are actually needed
2. **If NO tools needed**: Return {"sketches": []}
3. **If YES tools needed**: Analyze goal, identify evidence, map to tools, create sketches`;
    }

    getPlannerUserPrompt(context: StrategyExecutionContext): string {
        return `## 🎯 TASK CONTEXT
**Objective:** ${context.input}

${this.formatContextForPlanner(context)}`;
    }

    getOrganizerSystemPrompt(): string {
        return `You are an expert SYNTHESIS ANALYST in a ReWoo pipeline. Your role is to analyze collected evidence and synthesize comprehensive answers.

## 🎯 SYNTHESIS METHODOLOGY
Analyze all provided evidence, identify patterns and connections, then synthesize a coherent, evidence-based answer to the original goal.

## 📋 OUTPUT REQUIREMENTS
Return STRICT JSON with this exact schema:
\`\`\`json
{
  "answer": "Comprehensive answer based solely on evidence",
  "citations": ["E1", "E2", "E3"]
}
\`\`\`

## ⚠️ CRITICAL CONSTRAINTS
- ONLY use information from provided evidence
- CITE every claim with evidence IDs in brackets [E1]
- STATE clearly if evidence is insufficient
- NO external knowledge or assumptions
- MAINTAIN factual accuracy

## 🔄 CHAIN-OF-THOUGHT PROCESS
1. Review each evidence item systematically
2. Cross-reference evidence for consistency
3. Identify key facts and relationships
4. Synthesize information into coherent answer
5. Validate answer against evidence completeness`;
    }

    getOrganizerUserPrompt(
        goal: string,
        evidences: RewooEvidenceItem[],
    ): string {
        const evidenceStr = this.formatEvidences(evidences);
        return `## 🎯 ORIGINAL GOAL
${goal}

## 📋 AVAILABLE EVIDENCE
${evidenceStr}

## ✅ TASK
Synthesize a final answer using only the evidence provided above. Cite evidence IDs in brackets like [E1].`;
    }

    getExecutorSystemPrompt(): string {
        return `You are a PRECISION EXECUTOR in a ReWoo pipeline. Your role is to execute individual steps with surgical accuracy and reliability.

## 🎯 EXECUTION MISSION
Execute exactly one step using the specified tool and parameters. Focus on precision, validation, and structured output.

## 📋 EXECUTION PROTOCOL
1. **VALIDATE INPUT**: Confirm you have the exact tool and all required parameters
2. **PREPARE EXECUTION**: Format parameters according to tool specifications
3. **EXECUTE PRECISELY**: Run the tool with exact parameters (no modifications)
4. **VALIDATE OUTPUT**: Ensure result is complete and properly formatted
5. **RETURN STRUCTURED**: Provide result in exact JSON format specified

## 🛠️ TOOL EXECUTION FRAMEWORK
- **Parameter Mapping**: Use provided arguments exactly as given
- **Type Conversion**: Apply correct data types (strings, numbers, booleans)
- **Error Handling**: If execution fails, include error details in response
- **Result Formatting**: Structure output according to tool specifications

## ⚠️ CRITICAL CONSTRAINTS
- EXECUTE ONLY the assigned step (no additional actions)
- USE EXACTLY the provided parameters (no substitutions or additions)
- MAINTAIN parameter types and formats precisely
- RETURN ONLY the execution result (no explanations or commentary)
- INCLUDE execution metadata for traceability

## 📊 OUTPUT SCHEMA REQUIREMENTS
\`\`\`json
{
  "success": true,
  "data": <actual_tool_execution_result>,
  "metadata": {
    "toolUsed": "exact_tool_name",
    "executionTime": "ISO_timestamp",
    "parametersUsed": <parameters_object>,
    "executionDuration": "milliseconds"
  },
  "error": null
}
\`\`\`

## 🚨 ERROR HANDLING
If execution fails, return error details in structured format.`;
    }

    getExecutorUserPrompt(context: StrategyExecutionContext): string {
        if (!context.step) {
            throw new Error('Step is required for executor mode');
        }

        return `## 🔧 EXECUTE STEP
**Step ID:** ${context.step.id}
**Description:** ${context.step.description || 'Execute step'}
**Tool:** ${context.step.tool || 'unknown'}

## 📋 PARAMETERS
\`\`\`json
${JSON.stringify(context.step.parameters, null, 2)}
\`\`\`

${this.formatContextForExecutor(context)}

## ✅ EXECUTION TASK
Execute this step using the tool and parameters above. Return only the execution result in the specified JSON format.`;
    }

    private formatContextForPlanner(context: StrategyExecutionContext): string {
        const parts: string[] = [];

        if (context.agentContext?.availableTools?.length > 0) {
            parts.push(
                this.formatters.formatToolsList(
                    context.agentContext.availableTools,
                ),
            );
        }

        if (context.agentContext?.agentExecutionOptions) {
            parts.push(
                this.formatters.context.formatAdditionalContext(
                    context.agentContext,
                ),
            );
        }

        return parts.length > 0 ? parts.join('\n\n') : '';
    }

    private formatEvidences(evidences: RewooEvidenceItem[]): string {
        return evidences
            .map(
                (evidence) =>
                    `[${evidence.id}] from ${evidence.toolName} (S:${evidence.sketchId}) -> ${this.formatEvidenceOutput(evidence)}`,
            )
            .join('\n');
    }

    private formatEvidenceOutput(evidence: RewooEvidenceItem): string {
        if (evidence.error) return `ERROR: ${evidence.error}`;
        if (evidence.output) {
            const outputStr =
                typeof evidence.output === 'string'
                    ? evidence.output
                    : JSON.stringify(evidence.output);
            return outputStr;
        }
        return 'No output';
    }

    private formatContextForExecutor(
        context: StrategyExecutionContext,
    ): string {
        const parts: string[] = [];

        if (context.agentContext) {
            const agentContext = context.agentContext as AgentContext;
            parts.push(`## 🤖 EXECUTION CONTEXT
**Agent:** ${agentContext.agentName}
**Session:** ${agentContext.sessionId}`);
        }

        if (context.agentContext?.agentExecutionOptions) {
            const additional = this.formatters.context.formatAdditionalContext(
                context.agentContext,
            );
            parts.push(additional);
        }

        if (context.history) {
            parts.push(
                '## 📚 EXECUTION HISTORY\nPrevious step results are available for reference if needed.',
            );
        }

        return parts.length > 0 ? parts.join('\n\n') : '';
    }
}

// =============================================================================
// 🔄 REACT STRATEGY PROMPTS
// =============================================================================

export class ReActPrompts {
    private formatters: StrategyFormatters;

    constructor(formatters?: StrategyFormatters) {
        this.formatters = formatters || new StrategyFormatters();
    }

    getSystemPrompt(): string {
        return `You are an expert AI assistant using the ReAct (Reasoning + Acting) pattern for complex problem-solving.

## 🎯 MISSION
Solve user tasks using systematic reasoning and precise tool execution.

## 📋 OUTPUT SCHEMA (MANDATORY)
\`\`\`json
{
  "reasoning": "string (max 200 chars)",
  "confidence": "number (0.0-1.0)",
  "hypotheses": [{
    "approach": "string",
    "confidence": "number",
    "action": {
      "type": "final_answer|tool_call",
      "content": "string (final_answer only)",
      "toolName": "string (tool_call only)",
      "input": "object (tool_call only)"
    }
  }],
  "reflection": {
    "shouldContinue": "boolean",
    "reasoning": "string",
    "alternatives": ["string array"]
  },
  "earlyStopping": {
    "shouldStop": "boolean",
    "reason": "string"
  }
}
\`\`\`

## ⚖️ DECISION MATRIX
| Confidence | Action | Rules |
|------------|--------|-------|
| >0.8 | final_answer | Complete info available |
| 0.6-0.8 | tool_call | Need specific data |
| 0.3-0.6 | multi_hypothesis | Generate alternatives |
| <0.3 | early_stop | Insufficient confidence |

## 🔧 TOOL USAGE
- **Select most specific tool** for the task
- **Use correct parameter names** from descriptions
- **Provide complete parameters** (no missing optionals)
- **Consider tool capabilities** and limitations

## 🧠 REASONING STEPS
1. **ANALYZE** request + available tools
2. **PLAN** most efficient approach
3. **ACT** with appropriate tool/parameters
4. **OBSERVE** results and decide next steps

## 🚨 CRITICAL RULES
- **ALWAYS return ONLY valid JSON** (no text/markdown)
- **STRICT schema compliance** required
- **reasoning, confidence, hypotheses** are mandatory
- **For tool_call:** toolName + input required
- **For final_answer:** content required
- **CONFIDENCE scoring** mandatory (0.0-1.0)
- **JSON must parse** with JSON.parse()
- **IGNORE conversation language** - use JSON only

## 🔄 ADVANCED FEATURES
### SELF-REFLECTION (confidence < 0.5)
- **Relevance:** Does action solve user's problem?
- **Efficiency:** Better approach available?
- **Completeness:** Enough info to proceed?
- **Alternatives:** 2-3 backup approaches

### MULTI-HYPOTHESIS (confidence < 0.7)
- **Primary:** Highest confidence approach
- **Secondary:** Alternative approach
- **Tertiary:** Backup plan
- **Include confidence scores** for each

### EARLY STOPPING
**STOP if:**
- confidence < 0.3 (2+ consecutive steps)
- Same action repeated 3+ times
- No progress in last 3 steps
- User intent unclear

## ⚡ CONSTRAINTS
- **NO fallback formats** accepted
- **NO text explanations** outside JSON
- **NO markdown formatting** in response
- **ONLY JSON structure** allowed`;
    }

    getTaskPrompt(context: StrategyExecutionContext): string {
        const sections: string[] = [];
        const { input, agentContext, history } = context;

        // 🔥 MELHORADO: Estrutura hierárquica mais eficiente
        sections.push('## 🎯 TASK CONTEXT');
        sections.push(`**Objective:** ${input}`);

        // 🔥 MELHORADO: Agent context compacto
        sections.push(this.formatters.context.formatAgentContext(agentContext));

        // 🔥 MELHORADO: Agent Identity ANTES das tools (prompt engineering)
        if (agentContext.agentIdentity) {
            sections.push(
                this.formatters.context.formatAgentIdentity(
                    agentContext.agentIdentity,
                ),
            );
        }

        // 🔥 MELHORADO: Todas as tools (por enquanto - mais seguro)
        if (agentContext?.availableTools?.length > 0) {
            sections.push(
                this.formatters.formatToolsList(agentContext.availableTools),
            );
        }

        // 🔥 MELHORADO: Contexto adicional (se relevante)
        if (agentContext.agentExecutionOptions) {
            sections.push(
                this.formatters.context.formatAdditionalContext(agentContext),
            );
        }

        // 🔥 MELHORADO: Histórico mais conciso e útil
        if (history && history.length > 0) {
            const historyDetails = history
                .map((step, index) => {
                    const stepInfo: string[] = [];

                    // Thought completo (sem truncagem)
                    if (step.thought?.reasoning) {
                        stepInfo.push(`Thought: ${step.thought.reasoning}`);
                    }

                    // Confidence simplificado
                    if ((step.thought as any)?.confidence !== undefined) {
                        const confidence = (step.thought as any).confidence;
                        stepInfo.push(
                            `Confidence: ${confidence} (${confidence >= 0.8 ? 'HIGH' : confidence >= 0.6 ? 'MEDIUM' : 'LOW'})`,
                        );
                    }

                    // Action mais direto
                    if (step.action?.type === 'tool_call') {
                        const params = step.action.input
                            ? typeof step.action.input === 'object'
                                ? JSON.stringify(step.action.input)
                                : String(step.action.input)
                            : '';
                        stepInfo.push(
                            `Action: ${step.action.toolName} - Params:${params ? ` ${params}` : ''}`,
                        );
                    } else if (step.action?.type === 'final_answer') {
                        stepInfo.push(`Action: Final Answer`);
                    }

                    // Result com status baseado em isSuccess
                    if (step.result?.type === 'error') {
                        stepInfo.push(
                            `Result: [ERROR] ${String(step.result.content || 'Unknown')}`,
                        );
                    } else if (step.result?.content) {
                        const status =
                            (step.result as any)?.result?.success !== false
                                ? '[SUCCESS]'
                                : '[ERROR]';
                        const resultStr =
                            typeof step.result.content === 'string'
                                ? step.result.content
                                : JSON.stringify(step.result.content);
                        stepInfo.push(`Result: ${status} ${resultStr}`);
                    } else if (step.result) {
                        const status =
                            (step.result as any)?.metadata?.isSuccess !== false
                                ? '[SUCCESS]'
                                : '[ERROR]';
                        stepInfo.push(
                            `Result: ${status} ${step.result.type || 'Completed'}`,
                        );
                    }

                    return `**Step ${index + 1}:**\n${stepInfo.join('\n')}`;
                })
                .join('\n\n');

            sections.push(`## 📋 EXECUTION HISTORY\n\n${historyDetails}`);
        }

        sections.push(`## 🎯 DECISION GUIDE

**FINAL ANSWER when:**
- ✅ Information complete and sufficient
- ✅ Task objective achieved
- ✅ No additional actions needed

**TOOL CALL when:**
- 🔧 Need new information or action
- 🔧 Previous attempts failed
- 🔧 Task requires external operations

**Choose most specific tool + complete parameters**

## 💡 FORMATTING GUIDELINES

**For file lists and data:**
- Use markdown tables when comparing items
- Use code blocks (\`\`\`) for technical content
- Structure information hierarchically
- Keep responses concise but informative

**For errors and issues:**
- Clearly state the problem first
- Provide specific solutions
- Use bullet points for multiple options
- Include actionable next steps`);

        return sections.join('\n\n');
    }
}

// =============================================================================
// 🗓️ PLAN-EXECUTE STRATEGY PROMPTS
// =============================================================================

export class PlanExecutePrompts {
    private formatters: StrategyFormatters;

    constructor(formatters?: StrategyFormatters) {
        this.formatters = formatters || new StrategyFormatters();
    }

    getSystemPrompt(): string {
        return `# Plan-Execute Strategy - Smart Planning & Sequential Execution

You are an expert planner that creates clear, executable plans for complex tasks.

## 🎯 MISSION
Create step-by-step execution plans that break down complex tasks into logical, sequential steps.

## 📋 PLANNING FRAMEWORK
1. **Analyze**: Understand the task and available tools
2. **Break Down**: Decompose into manageable steps
3. **Sequence**: Order steps logically with dependencies
4. **Validate**: Ensure each step is executable
5. **Optimize**: Keep plan concise and efficient

## 🛠️ TOOL USAGE RULES
- Only use tools from the provided list
- Each tool call must have correct parameters
- Consider tool capabilities and limitations

## 📊 OUTPUT REQUIREMENTS
Return STRICT JSON with this exact schema:

\`\`\`json
{
    "goal": "Brief task description",
    "reasoning": "Why this plan works",
    "steps": [
        {
            "id": "step-1",
            "type": "tool_call",
            "toolName": "TOOL_NAME",
            "description": "What this step does",
            "input": {"param": "value"}
        },
        {
            "id": "step-2",
            "type": "final_answer",
            "content": "Final user response"
        }
    ]
}
\`\`\`

## ⚠️ CRITICAL CONSTRAINTS
- Return ONLY JSON (no explanations or text)
- NO fallback formats accepted
- STRICT schema compliance required
- End with final_answer step
- Keep plan minimal but complete
- Each step must be independently executable
- Use exact tool names from list
- goal, reasoning, and steps fields are mandatory

## 📝 EXAMPLE PLAN
For task "Analyze project structure":
\`\`\`json
{
    "goal": "Analyze project structure and provide summary",
    "reasoning": "Need to gather project info then analyze structure",
    "steps": [
        {
            "id": "step-1",
            "type": "tool_call",
            "toolName": "LIST_FILES",
            "description": "Get project file structure",
            "input": {"path": "."}
        },
        {
            "id": "step-2",
            "type": "tool_call",
            "toolName": "ANALYZE_CODE",
            "description": "Analyze main source files",
            "input": {"files": ["src/main.ts", "package.json"]}
        },
        {
            "id": "step-3",
            "type": "final_answer",
            "content": "Repository analysis complete. Found TypeScript project with clear structure."
        }
    ]
}
\`\`\``;
    }

    getUserPrompt(context: StrategyExecutionContext): string {
        const sections: string[] = [];
        const { input, agentContext, history } = context;

        sections.push('## 🎯 TASK');
        sections.push(`${input}`);

        sections.push(this.formatters.context.formatAgentContext(agentContext));

        if (agentContext.availableTools?.length > 0) {
            sections.push(
                this.formatters.formatToolsList(agentContext.availableTools),
            );
        }

        if (agentContext.agentExecutionOptions) {
            sections.push(
                this.formatters.context.formatAdditionalContext(agentContext),
            );
        }

        if (history && history.length > 0) {
            sections.push(
                `## 📋 EXECUTION HISTORY\n${history.length} steps executed`,
            );
        }

        sections.push(this.getPlanningInstructions());

        return sections.join('\n\n');
    }

    private getPlanningInstructions(): string {
        return `## 📋 PLANNING TASK
Create a step-by-step execution plan. For each step:
- Choose one tool from the available list
- Provide exact parameters required by that tool
- Write a clear description of what the step accomplishes
- Ensure steps can be executed in sequence

## 📝 REQUIREMENTS
- Start with data gathering/analysis steps
- End with a final_answer step containing the user response
- Keep plan focused and minimal
- Use exact tool names as listed above

## 📊 OUTPUT
**CRITICAL:** Return ONLY JSON with the plan structure.
**NO explanations, comments, or additional text outside JSON.**
**Your response must be valid JSON that can be parsed by JSON.parse()**`;
    }

    createPrompt(context: StrategyExecutionContext): {
        systemPrompt: string;
        userPrompt: string;
    } {
        return {
            systemPrompt: this.getSystemPrompt(),
            userPrompt: this.getUserPrompt(context),
        };
    }
}

export class StrategyPromptFactory {
    private readonly formatters: StrategyFormatters;
    private readonly rewooPrompts: ReWooPrompts;
    private readonly reactPrompts: ReActPrompts;
    private readonly planExecutePrompts: PlanExecutePrompts;

    constructor(formatters?: StrategyFormatters) {
        this.formatters = formatters || new StrategyFormatters();
        this.rewooPrompts = new ReWooPrompts(this.formatters);
        this.reactPrompts = new ReActPrompts(this.formatters);
        this.planExecutePrompts = new PlanExecutePrompts(this.formatters);
    }

    createReWooPrompt(context: StrategyExecutionContext): {
        systemPrompt: string;
        userPrompt: string;
    } {
        const { mode = 'planner' } = context;

        switch (mode) {
            case 'planner':
                return {
                    systemPrompt: this.rewooPrompts.getPlannerSystemPrompt(),
                    userPrompt: this.rewooPrompts.getPlannerUserPrompt(context),
                };

            case 'executor':
                if (!context.step) {
                    throw new Error('Step is required for executor mode');
                }
                return {
                    systemPrompt: this.rewooPrompts.getExecutorSystemPrompt(),
                    userPrompt:
                        this.rewooPrompts.getExecutorUserPrompt(context),
                };

            case 'organizer':
                if (!context.evidences) {
                    throw new Error(
                        'Evidences are required for organizer mode',
                    );
                }
                return {
                    systemPrompt: this.rewooPrompts.getOrganizerSystemPrompt(),
                    userPrompt: this.rewooPrompts.getOrganizerUserPrompt(
                        context.input,
                        context.evidences,
                    ),
                };

            default:
                throw new Error(`Unknown ReWoo mode: ${mode}`);
        }
    }

    createReActPrompt(context: StrategyExecutionContext): {
        systemPrompt: string;
        userPrompt: string;
    } {
        return {
            systemPrompt: this.reactPrompts.getSystemPrompt(),
            userPrompt: this.reactPrompts.getTaskPrompt(context),
        };
    }

    createPrompt(
        strategy: 'react' | 'rewoo' | 'plan-execute',
        context: StrategyExecutionContext,
    ): { systemPrompt: string; userPrompt: string } {
        if (strategy === 'react') {
            return this.createReActPrompt(context);
        } else if (strategy === 'rewoo') {
            return this.createReWooPrompt(context);
        } else if (strategy === 'plan-execute') {
            return this.createPlanExecutePrompt(context);
        } else {
            throw new Error(`Unknown strategy: ${strategy}`);
        }
    }

    createPlanExecutePrompt(context: StrategyExecutionContext): {
        systemPrompt: string;
        userPrompt: string;
    } {
        return this.planExecutePrompts.createPrompt(context);
    }

    // === GETTERS ===
    get rewoo(): ReWooPrompts {
        return this.rewooPrompts;
    }

    get react(): ReActPrompts {
        return this.reactPrompts;
    }

    get planExecute(): PlanExecutePrompts {
        return this.planExecutePrompts;
    }

    get formatter(): StrategyFormatters {
        return this.formatters;
    }
}

export default StrategyPromptFactory;
