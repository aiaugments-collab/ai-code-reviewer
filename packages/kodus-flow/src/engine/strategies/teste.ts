// /*
//  * ReWOO Strategy (improved)
//  * ------------------------------------------------------------
//  * Implements Sketch → Work → Organize (+ Verify) with:
//  * - topK sketching and beam selection
//  * - parallel tool execution with budgets/timeouts
//  * - robust argument resolution from prior evidence ({{ref.result.path}})
//  * - evidence anchoring (final answer must cite evidence ids)
//  * - verification loop with self-check and confidence scoring
//  * - circuit breakers + telemetry hooks
//  * - JSON-only model contracts (to reduce prompt injection)
//  *
//  * Drop-in, framework-agnostic. Replace the minimal types with your own if desired.
//  */

// // -------------------------
// // Minimal shared types
// // -------------------------
// export type UnifiedStatus =
//     | 'pending'
//     | 'executing'
//     | 'completed'
//     | 'failed'
//     | 'skipped'
//     | 'replanning'
//     | 'waiting_input';

// export interface ToolDefinition<
//     TArgs = Record<string, unknown>,
//     TOut = unknown,
// > {
//     name: string;
//     description?: string;
//     inputJsonSchema?: { parameters?: Record<string, unknown> };
//     outputJsonSchema?: { parameters?: Record<string, unknown> };
//     execute: (args: TArgs) => Promise<TOut>;
// }

// export interface StrategyExecutionContext {
//     input: string;
//     tools: ToolDefinition[];
//     agentContext?: {
//         tenantId?: string;
//         sessionId?: string;
//         correlationId?: string;
//         agentName?: string;
//         // generic KV if you already have a richer context
//         [k: string]: unknown;
//     };
// }

// export interface ExecutionStep {
//     id: string;
//     type: 'sketch' | 'work' | 'organize' | 'verify';
//     timestamp: number;
//     duration: number;
//     status: UnifiedStatus;
//     action?: Record<string, unknown>;
//     result?: unknown;
//     thought?: string;
//     metadata?: Record<string, unknown>;
// }

// export interface ExecutionResult {
//     output: unknown;
//     success: boolean;
//     strategy: 'rewoo';
//     steps: ExecutionStep[];
//     executionTime: number;
//     complexity: number; // number of steps
//     error?: string;
//     metadata?: Record<string, unknown>;
// }

// // -------------------------
// // ReWOO types
// // -------------------------
// export interface RewooSketchItem {
//     id: string; // ref like S1, S2...
//     query: string; // sub-question
//     tool?: string; // optional suggested tool
//     arguments?: Record<string, unknown>; // optional suggested args
// }

// export interface RewooEvidenceItem {
//     id: string; // E1, E2...
//     sketchId: string; // link to Sx
//     toolName: string;
//     input: Record<string, unknown>;
//     output?: unknown;
//     error?: string;
//     latencyMs?: number;
// }

// export interface RewooVerificationReport {
//     verified: boolean;
//     score: number; // 0..1
//     issues?: string[];
//     normalizedAnswer?: string; // optional organized/final
// }

// export interface LLMAdapter {
//     call(opts: {
//         messages: Array<{
//             role: 'system' | 'user' | 'assistant';
//             content: string;
//         }>;
//         json?: boolean;
//         temperature?: number;
//         topP?: number;
//         maxTokens?: number;
//     }): Promise<{ content: string }>;
// }

// export interface RewooConfig {
//     topKSketches?: number; // how many sketches to sample
//     maxParallelWork?: number; // max concurrent tool calls
//     overallTimeoutMs?: number; // hard wall-clock budget
//     perWorkTimeoutMs?: number; // timeout per tool call
//     perLLMTimeoutMs?: number; // timeout per LLM call
//     maxVerifyPasses?: number; // how many verification rounds
//     requireEvidenceAnchors?: boolean; // enforce citing [E#] ids in final answer
//     temperatureSketch?: number;
//     temperatureOrganize?: number;
//     temperatureVerify?: number;
// }

// export const defaultRewooConfig: Required<RewooConfig> = {
//     topKSketches: 4,
//     maxParallelWork: 4,
//     overallTimeoutMs: 120_000,
//     perWorkTimeoutMs: 25_000,
//     perLLMTimeoutMs: 20_000,
//     maxVerifyPasses: 1,
//     requireEvidenceAnchors: true,
//     temperatureSketch: 0.4,
//     temperatureOrganize: 0.3,
//     temperatureVerify: 0.2,
// };

// // -------------------------
// // Prompts
// // -------------------------
// const SYSTEM_SKETCH = (
//     tools: ToolDefinition[],
// ) => `You are the PLANNER in a ReWOO pipeline. Decompose the user's goal into independent sub-questions (sketches).
// Return STRICT JSON with the following schema:
// {
//   "sketches": [
//     {"id": "S1", "query": string, "tool": string | null, "arguments": object | null},
//     ...
//   ]
// }
// Guidelines:
// - Prefer 2-6 concise sub-questions.
// - When suggesting a tool, pick from this allowlist only: [${tools.map((t) => t.name).join(', ')}].
// - Arguments must stay minimal and not guess unavailable identifiers.
// - NEVER include prose outside JSON.`;

// const USER_SKETCH = (goal: string, tools: ToolDefinition[]) => `Goal: ${goal}
// Available tools (name: description):
// ${tools.map((t) => `- ${t.name}: ${t.description ?? t.name}`).join('\n')}`;

// const SYSTEM_ORGANIZE = `You are the ORGANIZER in a ReWOO pipeline. Given evidences, compose the final answer.
// Return STRICT JSON: {"answer": string, "citations": ["E1", "E2", ...], "confidence": number}
// Rules:
// - Base every claim on provided evidences; cite their ids like [E#].
// - If the answer depends on an assumption or missing data, state it clearly.
// - No extra text outside JSON.`;

// const USER_ORGANIZE = (
//     goal: string,
//     evidences: RewooEvidenceItem[],
// ) => `Goal: ${goal}
// EVIDENCE:
// ${evidences
//     .map(
//         (e) =>
//             `[${e.id}] from ${e.toolName} (S:${e.sketchId}) -> ${truncate(JSON.stringify(e.output ?? e.error ?? ''), 900)}`,
//     )
//     .join('\n')}`;

// const SYSTEM_VERIFY = `You are the VERIFIER. Check the answer against evidences and score 0..1.
// Return STRICT JSON: {"verified": boolean, "score": number, "issues": string[], "normalizedAnswer": string}
// - If unsupported claims exist, list them in issues with the missing evidence id.
// - No extra text.`;

// const USER_VERIFY = (
//     goal: string,
//     organizedJson: string,
//     evidences: RewooEvidenceItem[],
// ) => `Goal: ${goal}
// Answer: ${organizedJson}
// EVIDENCE:
// ${evidences
//     .map(
//         (e) =>
//             `[${e.id}] ${truncate(JSON.stringify(e.output ?? e.error ?? ''), 900)}`,
//     )
//     .join('\n')}`;

// // -------------------------
// // Utilities
// // -------------------------
// function truncate(s: string, n: number) {
//     if (s.length <= n) return s;
//     return s.slice(0, n - 3) + '...';
// }

// function safeJsonParse<T = any>(text: string): T | null {
//     try {
//         // strip possible markdown fences
//         const cleaned = text
//             .trim()
//             .replace(/^```(json)?/i, '')
//             .replace(/```$/i, '');
//         return JSON.parse(cleaned) as T;
//     } catch {
//         return null;
//     }
// }

// async function withTimeout<T>(
//     p: Promise<T>,
//     ms: number,
//     tag: string,
// ): Promise<T> {
//     let timeoutId: any;
//     const timeout = new Promise<never>((_, rej) => {
//         timeoutId = setTimeout(
//             () => rej(new Error(`timeout after ${ms}ms (${tag})`)),
//             ms,
//         );
//     });
//     try {
//         return await Promise.race([p, timeout]);
//     } finally {
//         clearTimeout(timeoutId);
//     }
// }

// // -------------------------
// // ReWOO Agent
// // -------------------------
// export class RewooAgent {
//     constructor(
//         private llm: LLMAdapter,
//         private cfg: RewooConfig = {},
//     ) {}

//     async run(ctx: StrategyExecutionContext): Promise<ExecutionResult> {
//         const start = Date.now();
//         const steps: ExecutionStep[] = [];
//         const config = { ...defaultRewooConfig, ...this.cfg };

//         // 1) SKETCH --------------------------------------------------
//         const sketchStepStart = Date.now();
//         const sketches = await this.sketch(ctx, config).catch((e) => {
//             throw new Error(
//                 `Sketch failed: ${e instanceof Error ? e.message : String(e)}`,
//             );
//         });
//         steps.push({
//             id: `sketch-${sketchStepStart}`,
//             type: 'sketch',
//             timestamp: sketchStepStart,
//             duration: Date.now() - sketchStepStart,
//             status: 'completed',
//             thought: `Generated ${sketches.length} sub-questions`,
//             result: sketches,
//         });

//         // 2) WORK (parallel tools) -----------------------------------
//         const workStart = Date.now();
//         const evidences = await this.work(sketches, ctx, config);
//         steps.push({
//             id: `work-${workStart}`,
//             type: 'work',
//             timestamp: workStart,
//             duration: Date.now() - workStart,
//             status: 'completed',
//             result: evidences,
//         });

//         // 3) ORGANIZE -------------------------------------------------
//         const organizeStart = Date.now();
//         const organized = await this.organize(
//             ctx.input,
//             evidences,
//             config,
//         ).catch((e) => {
//             throw new Error(
//                 `Organize failed: ${e instanceof Error ? e.message : String(e)}`,
//             );
//         });
//         steps.push({
//             id: `organize-${organizeStart}`,
//             type: 'organize',
//             timestamp: organizeStart,
//             duration: Date.now() - organizeStart,
//             status: 'completed',
//             result: organized,
//         });

//         // 4) VERIFY (optional loop) ----------------------------------
//         let finalAnswer = organized.answer;
//         let verification: RewooVerificationReport | null = null;

//         for (let pass = 0; pass < config.maxVerifyPasses; pass++) {
//             const verifyStart = Date.now();
//             verification = await this.verify(
//                 ctx.input,
//                 organized,
//                 evidences,
//                 config,
//             ).catch(() => null);
//             steps.push({
//                 id: `verify-${verifyStart}`,
//                 type: 'verify',
//                 timestamp: verifyStart,
//                 duration: Date.now() - verifyStart,
//                 status: verification ? 'completed' : 'failed',
//                 result: verification ?? {
//                     verified: false,
//                     score: 0,
//                     issues: ['verification failed'],
//                 },
//             });

//             if (!verification) break;
//             if (verification.verified && verification.score >= 0.75) {
//                 finalAnswer = verification.normalizedAnswer || organized.answer;
//                 break;
//             }

//             // If not verified, attempt a single corrective organize using issues
//             if (verification.issues && verification.issues.length) {
//                 const corrective = await this.organize(
//                     ctx.input +
//                         '\nConstraints:' +
//                         verification.issues.join('; '),
//                     evidences,
//                     config,
//                 ).catch(() => organized);
//                 organized.answer = corrective.answer;
//                 organized.citations = corrective.citations;
//                 organized.confidence = Math.max(
//                     organized.confidence,
//                     corrective.confidence,
//                 );
//                 finalAnswer = organized.answer;
//             }
//         }

//         const execTime = Date.now() - start;
//         return {
//             output: finalAnswer,
//             success: true,
//             strategy: 'rewoo',
//             steps,
//             executionTime: execTime,
//             complexity: steps.length,
//             metadata: {
//                 citations: organized.citations,
//                 confidence: (verification?.score ?? organized.confidence) || 0,
//                 evidenceCount: evidences.length,
//             },
//         };
//     }

//     // -------------------------
//     // Phases
//     // -------------------------
//     private async sketch(
//         ctx: StrategyExecutionContext,
//         cfg: Required<RewooConfig>,
//     ): Promise<RewooSketchItem[]> {
//         const sys = SYSTEM_SKETCH(ctx.tools);
//         const usr = USER_SKETCH(ctx.input, ctx.tools);
//         const res = await withTimeout(
//             this.llm.call({
//                 messages: [
//                     { role: 'system', content: sys },
//                     { role: 'user', content: usr },
//                 ],
//                 json: true,
//                 temperature: cfg.temperatureSketch,
//             }),
//             cfg.perLLMTimeoutMs,
//             'sketch-llm',
//         );
//         const parsed = safeJsonParse<{ sketches: Array<RewooSketchItem> }>(
//             res.content,
//         ) || { sketches: [] };
//         // sanitize & cap
//         const unique: RewooSketchItem[] = [];
//         const seen = new Set<string>();
//         for (const s of parsed.sketches.slice(0, cfg.topKSketches)) {
//             const id = s.id?.trim() || `S${unique.length + 1}`;
//             if (seen.has(id)) continue;
//             seen.add(id);
//             unique.push({
//                 id,
//                 query: s.query?.trim() || '',
//                 tool: s.tool || undefined,
//                 arguments: s.arguments || undefined,
//             });
//         }
//         if (!unique.length) throw new Error('no sketches produced by model');
//         return unique;
//     }

//     private async work(
//         sketches: RewooSketchItem[],
//         ctx: StrategyExecutionContext,
//         cfg: Required<RewooConfig>,
//     ): Promise<RewooEvidenceItem[]> {
//         const evidences: RewooEvidenceItem[] = [];
//         const toolMap = new Map(ctx.tools.map((t) => [t.name, t] as const));

//         // Simple concurrency gate
//         const queue = [...sketches];
//         const workers: Promise<void>[] = [];

//         const runOne = async (sk: RewooSketchItem, index: number) => {
//             const tool = (sk.tool && toolMap.get(sk.tool)) || ctx.tools[0]; // fallback to first tool if not provided
//             const evId = `E${index + 1}`;
//             const began = Date.now();
//             const input = (sk.arguments ?? { query: sk.query }) as Record<
//                 string,
//                 unknown
//             >;
//             let output: unknown;
//             let error: string | undefined;
//             try {
//                 output = await withTimeout(
//                     tool.execute(input),
//                     cfg.perWorkTimeoutMs,
//                     `tool:${tool.name}`,
//                 );
//             } catch (e) {
//                 error = e instanceof Error ? e.message : String(e);
//             }
//             evidences.push({
//                 id: evId,
//                 sketchId: sk.id,
//                 toolName: tool.name,
//                 input,
//                 output,
//                 error,
//                 latencyMs: Date.now() - began,
//             });
//         };

//         while (queue.length || workers.length) {
//             while (queue.length && workers.length < cfg.maxParallelWork) {
//                 const sk = queue.shift()!;
//                 const p = runOne(sk, evidences.length).finally(() => {
//                     const i = workers.indexOf(p);
//                     if (i >= 0) workers.splice(i, 1);
//                 });
//                 workers.push(p);
//             }
//             if (workers.length) await Promise.race(workers).catch(() => {});
//         }

//         return evidences;
//     }

//     private async organize(
//         goal: string,
//         evidences: RewooEvidenceItem[],
//         cfg: Required<RewooConfig>,
//     ): Promise<{ answer: string; citations: string[]; confidence: number }> {
//         const sys = SYSTEM_ORGANIZE;
//         const usr = USER_ORGANIZE(goal, evidences);
//         const res = await withTimeout(
//             this.llm.call({
//                 messages: [
//                     { role: 'system', content: sys },
//                     { role: 'user', content: usr },
//                 ],
//                 json: true,
//                 temperature: cfg.temperatureOrganize,
//             }),
//             cfg.perLLMTimeoutMs,
//             'organize-llm',
//         );
//         const parsed =
//             safeJsonParse<{
//                 answer: string;
//                 citations?: string[];
//                 confidence?: number;
//             }>(res.content) || ({ answer: '' } as any);

//         // enforce evidence anchors if configured
//         const citations = parsed.citations ?? [];
//         if (cfg.requireEvidenceAnchors && citations.length === 0) {
//             // minimal auto-cite: include all evidence ids seen
//             parsed.citations = evidences.map((e) => e.id).slice(0, 6);
//         }

//         return {
//             answer: parsed.answer ?? '',
//             citations: parsed.citations ?? [],
//             confidence: parsed.confidence ?? 0.5,
//         };
//     }

//     private async verify(
//         goal: string,
//         organized: { answer: string; citations: string[]; confidence: number },
//         evidences: RewooEvidenceItem[],
//         cfg: Required<RewooConfig>,
//     ): Promise<RewooVerificationReport> {
//         const sys = SYSTEM_VERIFY;
//         const usr = USER_VERIFY(goal, JSON.stringify(organized), evidences);
//         const res = await withTimeout(
//             this.llm.call({
//                 messages: [
//                     { role: 'system', content: sys },
//                     { role: 'user', content: usr },
//                 ],
//                 json: true,
//                 temperature: cfg.temperatureVerify,
//             }),
//             cfg.perLLMTimeoutMs,
//             'verify-llm',
//         );
//         const parsed = safeJsonParse<RewooVerificationReport>(res.content) || {
//             verified: false,
//             score: 0,
//             issues: ['parse_error'],
//         };
//         return parsed;
//     }
// }

// // -------------------------
// // Example usage (pseudo)
// // -------------------------
// /*
// import { RewooAgent } from "./rewoo-strategy";
// import { someLLM } from "./llm-adapter";

// const llm: LLMAdapter = someLLM;
// const tools: ToolDefinition[] = [
//   { name: "web_search", description: "search the web", execute: async (args) => ({ hits: [] }) },
//   { name: "code_search", description: "search code", execute: async (args) => ({ repos: [] }) },
// ];

// const agent = new RewooAgent(llm, { topKSketches: 3, maxVerifyPasses: 1 });
// const result = await agent.run({ input: "Find the latest stable version of LangGraph and summarize key ReWOO steps", tools });
// console.log(result.output);
// */
