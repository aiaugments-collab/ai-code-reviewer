// import { describe, it, expect, beforeEach, vi } from 'vitest';
// import { createOrchestration } from '../../src/orchestration/sdk-orchestrator.js';
// import { z } from 'zod';

// describe('Basic Error Handling', () => {
//     let orchestrator: any;

//     beforeEach(async () => {
//         orchestrator = createOrchestration();
//     });

//     describe('Tool Failure Scenarios', () => {
//         it('should handle tool execution failure gracefully', async () => {
//             // Tool que sempre falha
//             orchestrator.createTool({
//                 name: 'failing_tool',
//                 description: 'Tool that always fails',
//                 inputSchema: z.object({ query: z.string() }),
//                 execute: async (input: { query: string }) => {
//                     throw new Error(`Tool failed: ${input.query}`);
//                 },
//             });

//             // Agent simples que tenta usar a tool
//             await orchestrator.createAgent({
//                 name: 'basic-agent',
//                 description: 'Basic agent for error testing',
//                 think: async (input: string) => ({
//                     reasoning: 'Testing tool failure',
//                     action: {
//                         type: 'tool_call',
//                         content: {
//                             toolName: 'failing_tool',
//                             input: { query: input },
//                         },
//                     },
//                 }),
//             });

//             const result = await orchestrator.callAgent('basic-agent', 'test');

//             // O resultado deve existir mas indicar falha
//             expect(result).toBeDefined();
//             expect(result.success).toBe(false);
//             expect(result.error).toBeDefined();
//             expect(result.error.message).toContain('Tool failed');
//         });

//         it('should handle tool not found error', async () => {
//             await orchestrator.createAgent({
//                 name: 'missing-tool-agent',
//                 description: 'Agent that tries to use missing tool',
//                 think: async (input: string) => ({
//                     reasoning: 'Testing missing tool',
//                     action: {
//                         type: 'tool_call',
//                         content: {
//                             toolName: 'nonexistent_tool',
//                             input: { query: input },
//                         },
//                     },
//                 }),
//             });

//             const result = await orchestrator.callAgent(
//                 'missing-tool-agent',
//                 'test',
//             );

//             expect(result).toBeDefined();
//             expect(result.success).toBe(false);
//             expect(result.error).toBeDefined();
//             expect(result.error.message).toContain('not found');
//         });

//         it('should handle tool timeout', async () => {
//             // Tool que demora muito
//             orchestrator.createTool({
//                 name: 'slow_tool',
//                 description: 'Tool that takes too long',
//                 inputSchema: z.object({ delay: z.number() }),
//                 execute: async (input: { delay: number }) => {
//                     await new Promise((resolve) =>
//                         setTimeout(resolve, input.delay),
//                     );
//                     return { result: 'Completed' };
//                 },
//             });

//             await orchestrator.createAgent({
//                 name: 'timeout-agent',
//                 description: 'Agent testing timeout',
//                 think: async (input: string) => ({
//                     reasoning: 'Testing timeout',
//                     action: {
//                         type: 'tool_call',
//                         content: {
//                             toolName: 'slow_tool',
//                             input: { delay: 2000 }, // 2 seconds
//                         },
//                     },
//                 }),
//             });

//             const startTime = Date.now();
//             const result = await orchestrator.callAgent(
//                 'timeout-agent',
//                 'test',
//                 { timeout: 500 }, // 500ms timeout
//             );
//             const duration = Date.now() - startTime;

//             expect(result).toBeDefined();
//             expect(duration).toBeLessThan(1000); // Should timeout quickly
//         }, 10000); // Test timeout of 10 seconds

//         it('should handle invalid tool input', async () => {
//             // Tool com schema rigoroso
//             orchestrator.createTool({
//                 name: 'strict_tool',
//                 description: 'Tool with strict schema',
//                 inputSchema: z.object({
//                     requiredField: z.string(),
//                     numberField: z.number(),
//                 }),
//                 execute: async (input: any) => {
//                     return { result: 'Success', input };
//                 },
//             });

//             await orchestrator.createAgent({
//                 name: 'invalid-input-agent',
//                 description: 'Agent with invalid tool input',
//                 think: async (input: string) => ({
//                     reasoning: 'Testing invalid input',
//                     action: {
//                         type: 'tool_call',
//                         content: {
//                             toolName: 'strict_tool',
//                             input: {
//                                 wrongField: input,
//                                 numberField: 'not a number', // Invalid type
//                             },
//                         },
//                     },
//                 }),
//             });

//             const result = await orchestrator.callAgent(
//                 'invalid-input-agent',
//                 'test',
//             );

//             expect(result).toBeDefined();
//             expect(result.success).toBe(false);
//             expect(result.error).toBeDefined();
//         });
//     });

//     describe('Agent Error Scenarios', () => {
//         it('should handle agent think function throwing error', async () => {
//             await orchestrator.createAgent({
//                 name: 'broken-agent',
//                 description: 'Agent with broken think function',
//                 think: async (input: string) => {
//                     throw new Error(`Think function failed: ${input}`);
//                 },
//             });

//             const result = await orchestrator.callAgent('broken-agent', 'test');

//             expect(result).toBeDefined();
//             expect(result.success).toBe(false);
//             expect(result.error).toBeDefined();
//             expect(result.error.message).toContain('Think function failed');
//         });

//         it('should handle agent returning invalid action', async () => {
//             await orchestrator.createAgent({
//                 name: 'invalid-action-agent',
//                 description: 'Agent returning invalid action',
//                 think: async (input: string) => ({
//                     reasoning: 'Testing invalid action',
//                     action: {
//                         type: 'invalid_action_type' as any,
//                         content: 'invalid content',
//                     },
//                 }),
//             });

//             const result = await orchestrator.callAgent(
//                 'invalid-action-agent',
//                 'test',
//             );

//             expect(result).toBeDefined();
//             expect(result.success).toBe(false);
//             expect(result.error).toBeDefined();
//         });

//         it('should handle agent taking too long to think', async () => {
//             await orchestrator.createAgent({
//                 name: 'slow-thinking-agent',
//                 description: 'Agent that thinks too slowly',
//                 think: async (input: string) => {
//                     await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 seconds
//                     return {
//                         reasoning: 'Slow thinking completed',
//                         action: {
//                             type: 'final_answer',
//                             content: 'Finally thought of something',
//                         },
//                     };
//                 },
//             });

//             const startTime = Date.now();
//             const result = await orchestrator.callAgent(
//                 'slow-thinking-agent',
//                 'test',
//                 { timeout: 500 }, // 500ms timeout
//             );
//             const duration = Date.now() - startTime;

//             expect(result).toBeDefined();
//             expect(duration).toBeLessThan(1000); // Should timeout
//         }, 10000);
//     });

//     describe('Fallback and Recovery', () => {
//         it('should provide fallback response when tools fail', async () => {
//             // Tool que falha
//             orchestrator.createTool({
//                 name: 'unreliable_tool',
//                 description: 'Unreliable tool',
//                 inputSchema: z.object({ query: z.string() }),
//                 execute: async (input: { query: string }) => {
//                     throw new Error('Tool is down');
//                 },
//             });

//             await orchestrator.createAgent({
//                 name: 'resilient-agent',
//                 description: 'Agent with fallback logic',
//                 think: async (input: string, context: any) => {
//                     // Simula tentativa de usar tool com fallback
//                     const toolAvailable = context.availableTools?.some(
//                         (tool: any) => tool.name === 'reliable_tool',
//                     );

//                     if (toolAvailable) {
//                         return {
//                             reasoning: 'Using reliable tool',
//                             action: {
//                                 type: 'tool_call',
//                                 content: {
//                                     toolName: 'reliable_tool',
//                                     input: { query: input },
//                                 },
//                             },
//                         };
//                     } else {
//                         // Fallback para resposta direta
//                         return {
//                             reasoning:
//                                 'Tools unavailable, providing direct response',
//                             action: {
//                                 type: 'final_answer',
//                                 content: `I can help with "${input}" but my tools are currently unavailable. Based on my knowledge, I can tell you...`,
//                             },
//                         };
//                     }
//                 },
//             });

//             const result = await orchestrator.callAgent(
//                 'resilient-agent',
//                 'help me',
//             );

//             expect(result).toBeDefined();
//             expect(result.success).toBe(true);
//             expect(result.result).toContain('unavailable');
//         });

//         it('should retry failed operations appropriately', async () => {
//             let attemptCount = 0;

//             // Tool que falha nas primeiras tentativas
//             orchestrator.createTool({
//                 name: 'eventually_works_tool',
//                 description: 'Tool that works after retries',
//                 inputSchema: z.object({ query: z.string() }),
//                 execute: async (input: { query: string }) => {
//                     attemptCount++;
//                     if (attemptCount < 3) {
//                         throw new Error(`Attempt ${attemptCount} failed`);
//                     }
//                     return {
//                         result: 'Success after retries',
//                         attempts: attemptCount,
//                     };
//                 },
//             });

//             await orchestrator.createAgent({
//                 name: 'retry-agent',
//                 description: 'Agent that handles retries',
//                 think: async (input: string) => ({
//                     reasoning: 'Testing retry logic',
//                     action: {
//                         type: 'tool_call',
//                         content: {
//                             toolName: 'eventually_works_tool',
//                             input: { query: input },
//                         },
//                     },
//                 }),
//             });

//             const result = await orchestrator.callAgent(
//                 'retry-agent',
//                 'test retry',
//             );

//             expect(result).toBeDefined();
//             // Should eventually succeed after retries
//             if (result.success) {
//                 expect(result.result).toBeDefined();
//             }
//         });
//     });

//     describe('Input Validation and Edge Cases', () => {
//         it('should handle empty input gracefully', async () => {
//             await orchestrator.createAgent({
//                 name: 'empty-input-agent',
//                 description: 'Agent handling empty input',
//                 think: async (input: string) => {
//                     if (!input || input.trim() === '') {
//                         return {
//                             reasoning:
//                                 'Input is empty, asking for clarification',
//                             action: {
//                                 type: 'final_answer',
//                                 content:
//                                     "I didn't receive any input. Could you please provide more information?",
//                             },
//                         };
//                     }
//                     return {
//                         reasoning: 'Processing valid input',
//                         action: {
//                             type: 'final_answer',
//                             content: `You said: ${input}`,
//                         },
//                     };
//                 },
//             });

//             const result = await orchestrator.callAgent(
//                 'empty-input-agent',
//                 '',
//             );

//             expect(result).toBeDefined();
//             expect(result.success).toBe(true);
//             expect(result.result).toContain("didn't receive any input");
//         });

//         it('should handle null/undefined input', async () => {
//             await orchestrator.createAgent({
//                 name: 'null-input-agent',
//                 description: 'Agent handling null input',
//                 think: async (input: any) => {
//                     const safeInput = input ?? '';
//                     return {
//                         reasoning: 'Handling potentially null input',
//                         action: {
//                             type: 'final_answer',
//                             content: `Processed input: ${typeof safeInput === 'string' ? safeInput : 'non-string input'}`,
//                         },
//                     };
//                 },
//             });

//             const result1 = await orchestrator.callAgent(
//                 'null-input-agent',
//                 null,
//             );
//             const result2 = await orchestrator.callAgent(
//                 'null-input-agent',
//                 undefined,
//             );

//             expect(result1).toBeDefined();
//             expect(result1.success).toBe(true);
//             expect(result2).toBeDefined();
//             expect(result2.success).toBe(true);
//         });

//         it('should handle very long input', async () => {
//             const longInput = 'a'.repeat(10000); // 10KB string

//             await orchestrator.createAgent({
//                 name: 'long-input-agent',
//                 description: 'Agent handling long input',
//                 think: async (input: string) => {
//                     const inputLength = input?.length || 0;
//                     if (inputLength > 5000) {
//                         return {
//                             reasoning: 'Input is too long, truncating',
//                             action: {
//                                 type: 'final_answer',
//                                 content: `Input was ${inputLength} characters, which is quite long. I'll work with a summary...`,
//                             },
//                         };
//                     }
//                     return {
//                         reasoning: 'Processing normal length input',
//                         action: {
//                             type: 'final_answer',
//                             content: 'Input processed successfully',
//                         },
//                     };
//                 },
//             });

//             const result = await orchestrator.callAgent(
//                 'long-input-agent',
//                 longInput,
//             );

//             expect(result).toBeDefined();
//             expect(result.success).toBe(true);
//             expect(result.result).toContain('quite long');
//         });
//     });
// });
