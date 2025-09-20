import { describe, test, expect } from 'vitest';
import { PlannerPromptComposer } from '../../../../../src/engine/planning/strategies/prompts/planner-prompt-composer.js';

describe('🔍 formatAdditionalContext - Teste Abrangente', () => {
    const composer = new PlannerPromptComposer({
        customExamples: [],
        examplesProvider: undefined,
        patternsProvider: undefined,
    });

    // Acessar o método privado para teste
    const formatAdditionalContext = (
        composer as unknown as { formatAdditionalContext: () => string }
    ).formatAdditionalContext.bind(composer);

    describe('✅ Casos Reais do Contexto', () => {
        test('deve formatar organizationAndTeamData real', () => {
            const additionalContext = {
                userContext: {
                    organizationAndTeamData: {
                        organization: {
                            id: 'org-123',
                            name: 'Kodus',
                            plan: 'enterprise',
                        },
                        team: {
                            id: 'team-456',
                            name: 'Engineering',
                            members: ['john', 'jane', 'bob'],
                        },
                        permissions: ['read', 'write', 'admin'],
                        settings: {
                            notifications: true,
                            theme: 'dark',
                        },
                    },
                    additionalInformation: {
                        priority: 'high',
                        category: 'bug',
                        severity: 'critical',
                        assignee: 'john@example.com',
                        dueDate: '2024-01-20',
                        tags: ['urgent', 'frontend'],
                    },
                },
                agentIdentity: {
                    description:
                        'Agente de conversação para interações com usuários.',
                },
            };

            const result = formatAdditionalContext(additionalContext);

            // Verificar se não mostra [Object]
            expect(result).not.toContain('[Object]');

            // Verificar se mostra conteúdo real
            expect(result).toContain('Kodus');
            expect(result).toContain('Engineering');
            expect(result).toContain('priority: high');
            expect(result).toContain('category: bug');
            expect(result).toContain('urgent, frontend');

            // Verificar estrutura
            expect(result).toContain('## 🔍 ADDITIONAL INFO');
            expect(result).toContain('### 👤 USER CONTEXT');
            expect(result).toContain('### 🤖 AGENT IDENTITY');
        });

        test('deve lidar com objetos grandes (deve mostrar resumo)', () => {
            const bigObject = {
                prop1: 'value1',
                prop2: 'value2',
                prop3: 'value3',
                prop4: 'value4',
                prop5: 'value5',
                prop6: 'value6',
                prop7: 'value7',
            };

            const additionalContext = {
                userContext: {
                    bigData: bigObject,
                },
            };

            const result = formatAdditionalContext(additionalContext);

            // Deve mostrar resumo para objetos grandes
            expect(result).toContain('prop1, prop2, prop3, ... +4 more');
        });

        test('deve lidar com valores nulos e undefined', () => {
            const additionalContext = {
                userContext: {
                    testData: {
                        name: 'John',
                        age: null,
                        email: undefined,
                        active: true,
                    },
                },
            };

            const result = formatAdditionalContext(additionalContext);

            expect(result).toContain('name: John');
            expect(result).toContain('age: null');
            expect(result).toContain('email: undefined');
            expect(result).toContain('active: true');
        });

        test('deve lidar com arrays', () => {
            const additionalContext = {
                userContext: {
                    tags: ['bug', 'urgent', 'frontend'],
                    numbers: [1, 2, 3, 4, 5],
                    mixed: ['text', 42, true, null],
                },
            };

            const result = formatAdditionalContext(additionalContext);

            expect(result).toContain('tags: bug, urgent, frontend');
            expect(result).toContain('numbers: 1, 2, 3, 4, 5');
            expect(result).toContain('mixed: text, 42, true, null');
        });
    });
});

describe('formatReplanContext', () => {
    it('should format replan context with preserved steps and results', () => {
        const composer = new PlannerPromptComposer({
            customExamples: [],
            examplesProvider: undefined,
            patternsProvider: undefined,
        });
        const additionalContext = {
            replanContext: {
                previousPlan: {
                    id: 'plan-123',
                    goal: 'Test goal',
                    strategy: 'plan-execute',
                    totalSteps: 3,
                },
                executionSummary: {
                    type: 'needs_replan',
                    executionTime: 5000,
                    successfulSteps: 2,
                    failedSteps: 1,
                    feedback: 'Some steps failed',
                },
                preservedSteps: [
                    {
                        id: 'step-1',
                        description: 'Get diff for file',
                        tool: 'kodus-mcp-server.get_diff_for_file',
                        result: {
                            type: 'tool_result',
                            content: {
                                result: {
                                    successful: true,
                                    data: '@@ -1,1 +1,1 @@\n-old\n+new',
                                },
                            },
                        },
                    },
                    {
                        id: 'step-2',
                        description: 'List Jira projects',
                        tool: 'jira.JIRA_GET_ALL_PROJECTS',
                        result: {
                            type: 'tool_result',
                            content: {
                                result: {
                                    successful: true,
                                    data: {
                                        data: {
                                            values: [
                                                {
                                                    key: 'KC',
                                                    name: 'Kody Copilot',
                                                },
                                                {
                                                    key: 'GE',
                                                    name: 'Gestão Escolar',
                                                },
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    },
                ],
                failureAnalysis: {
                    primaryCause: 'Missing parameters',
                    failurePatterns: ['missing_jira_key', 'missing_discord_id'],
                },
                suggestions:
                    'Please provide Jira project key and Discord channel ID',
            },
        };

        const result = (
            composer as unknown as {
                formatReplanContext: (context: unknown) => string;
            }
        ).formatReplanContext(additionalContext);

        expect(result).toContain('## 🔄 REPLAN CONTEXT');
        expect(result).toContain('### 📋 PREVIOUS PLAN');
        expect(result).toContain('**Plan ID:** plan-123');
        expect(result).toContain('### 📊 EXECUTION SUMMARY');
        expect(result).toContain('**✅ Successful:** 2');
        expect(result).toContain('**❌ Failed:** 1');
        expect(result).toContain('### 🎯 PRESERVED STEPS & RESULTS');
        expect(result).toContain('**Total Preserved:** 2');
        expect(result).toContain('**Step 1:** Get diff for file');
        expect(result).toContain(
            '**Tool:** kodus-mcp-server.get_diff_for_file',
        );
        expect(result).toContain('**Result:** ✅ Diff extracted (');
        expect(result).toContain('**Step 2:** List Jira projects');
        expect(result).toContain('**Tool:** jira.JIRA_GET_ALL_PROJECTS');
        expect(result).toContain('**Result:** ✅ Found 2 projects: KC, GE');
        expect(result).toContain('### 🚨 FAILURE ANALYSIS');
        expect(result).toContain('**Primary Cause:** Missing parameters');
        expect(result).toContain(
            '**Patterns:** missing_jira_key, missing_discord_id',
        );
        expect(result).toContain('### 💡 SUGGESTIONS');
        expect(result).toContain(
            'Please provide Jira project key and Discord channel ID',
        );
    });

    it('should handle failed tool results', () => {
        const composer = new PlannerPromptComposer({
            customExamples: [],
            examplesProvider: undefined,
            patternsProvider: undefined,
        });
        const additionalContext = {
            replanContext: {
                preservedSteps: [
                    {
                        id: 'step-1',
                        description: 'Failed step',
                        tool: 'discord.DISCORD_SEND_MESSAGE',
                        result: {
                            type: 'tool_result',
                            content: {
                                result: {
                                    successful: false,
                                    error: 'Unknown Guild',
                                },
                            },
                        },
                    },
                ],
            },
        };

        const result = (
            composer as unknown as {
                formatReplanContext: (context: unknown) => string;
            }
        ).formatReplanContext(additionalContext);

        expect(result).toContain('**Step 1:** Failed step');
        expect(result).toContain('**Tool:** discord.DISCORD_SEND_MESSAGE');
        expect(result).toContain('**Result:** ❌ Error: Unknown Guild');
    });

    it('should handle different result formats', () => {
        const composer = new PlannerPromptComposer({
            customExamples: [],
            examplesProvider: undefined,
            patternsProvider: undefined,
        });
        const additionalContext = {
            replanContext: {
                preservedSteps: [
                    {
                        id: 'step-1',
                        description: 'Simple success',
                        result: { success: true },
                    },
                    {
                        id: 'step-2',
                        description: 'Simple failure',
                        result: { success: false },
                    },
                ],
            },
        };

        const result = (
            composer as unknown as {
                formatReplanContext: (context: unknown) => string;
            }
        ).formatReplanContext(additionalContext);

        expect(result).toContain('**Result:** ✅ Success');
        expect(result).toContain('**Result:** ❌ Failed');
    });
});
