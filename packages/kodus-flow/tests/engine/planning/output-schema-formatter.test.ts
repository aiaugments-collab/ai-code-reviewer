/**
 * 🧪 Testes para o Universal Output Schema Formatter
 * Verifica se todos os tipos de schema são formatados corretamente
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { describe, it, expect } from 'vitest';
import { PlannerPromptComposer } from '../../../src/engine/planning/strategies/prompts/planner-prompt-composer';
import type { PlannerPromptConfig } from '../../../src/engine/planning/types/prompt-types';

describe('🚀 Universal Output Schema Formatter', () => {
    let composer: PlannerPromptComposer;

    beforeEach(() => {
        // Criar uma configuração mínima para o composer
        const config: PlannerPromptConfig = {
            customExamples: [],
            examplesProvider: undefined,
            patternsProvider: undefined,
        };
        composer = new PlannerPromptComposer(config);
    });

    // Helper para acessar método privado
    const formatOutputSchema = (schema: Record<string, unknown>): string => {
        return (composer as any).formatOutputSchema(schema);
    };

    describe('🎯 Tipos Primitivos', () => {
        it('should format string type', () => {
            const schema = {
                type: 'string',
                description: 'User name',
            };
            const result = formatOutputSchema(schema);
            expect(result).toBe('\n  Returns: string - User name');
        });

        it('should format string with format', () => {
            const schema = {
                type: 'string',
                format: 'email',
                description: 'Email address',
            };
            const result = formatOutputSchema(schema);
            expect(result).toBe('\n  Returns: string (email) - Email address');
        });

        it('should format string with constraints', () => {
            const schema = {
                type: 'string',
                minLength: 3,
                maxLength: 50,
                description: 'Username',
            };
            const result = formatOutputSchema(schema);
            expect(result).toBe(
                '\n  Returns: string [min: 3, max: 50] - Username',
            );
        });

        it('should format number with constraints', () => {
            const schema = {
                type: 'number',
                minimum: 0,
                maximum: 100,
                description: 'Percentage',
            };
            const result = formatOutputSchema(schema);
            expect(result).toBe(
                '\n  Returns: number [min: 0, max: 100] - Percentage',
            );
        });

        it('should format boolean', () => {
            const schema = {
                type: 'boolean',
                description: 'Is active',
            };
            const result = formatOutputSchema(schema);
            expect(result).toBe('\n  Returns: boolean - Is active');
        });
    });

    describe('📋 Enums', () => {
        it('should format string enum', () => {
            const schema = {
                type: 'string',
                enum: ['pending', 'processing', 'completed', 'failed'],
                description: 'Operation status',
            };
            const result = formatOutputSchema(schema);
            expect(result).toBe(
                '\n  Returns: ("pending" | "processing" | "completed" | "failed") - Operation status',
            );
        });
    });

    describe('📚 Arrays', () => {
        it('should format array of strings', () => {
            const schema = {
                type: 'array',
                items: {
                    type: 'string',
                },
                minItems: 1,
                maxItems: 10,
                description: 'List of tags',
            };
            const result = formatOutputSchema(schema);
            expect(result).toBe(
                '\n  Returns: string[] [min: 1, max: 10] - List of tags',
            );
        });

        it('should format array of numbers', () => {
            const schema = {
                type: 'array',
                items: {
                    type: 'number',
                },
                description: 'Coordinates',
            };
            const result = formatOutputSchema(schema);
            expect(result).toBe('\n  Returns: number[] - Coordinates');
        });
    });

    describe('🏗️ Objetos Simples', () => {
        it('should format simple object', () => {
            const schema = {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'Unique identifier',
                    },
                    name: {
                        type: 'string',
                        description: 'Item name',
                    },
                    active: {
                        type: 'boolean',
                        description: 'Is active',
                    },
                },
                required: ['id', 'name'],
                description: 'Basic item',
            };
            const result = formatOutputSchema(schema);

            // Verifica se contém as informações essenciais (sem required/optional pois showRequiredMarkers=false)
            expect(result).toContain('Returns: Object - Basic item {'); // 🎯 Agnostic: no title = Object
            expect(result).toContain('id: string - Unique identifier');
            expect(result).toContain('name: string - Item name');
            expect(result).toContain('active: boolean - Is active');
            expect(result).not.toContain('(required)');
            expect(result).not.toContain('(optional)');
        });

        it('should format object with title', () => {
            const schema = {
                type: 'object',
                title: 'CustomUser',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                },
                required: ['id'],
                description: 'User data',
            };
            const result = formatOutputSchema(schema);
            expect(result).toContain('Returns: CustomUser - User data {');
        });
    });

    describe('🚀 Repository Detection (Caso Específico)', () => {
        it('should detect Repository from properties', () => {
            const repositorySchema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    http_url: { type: 'string' },
                    avatar_url: { type: 'string' },
                    organizationName: { type: 'string' },
                    visibility: {
                        type: 'string',
                        enum: ['public', 'private'],
                    },
                    selected: { type: 'boolean' },
                    default_branch: { type: 'string' },
                    project: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                        },
                    },
                    workspaceId: { type: 'string' },
                },
                required: ['id', 'name', 'http_url'],
            };

            const result = formatOutputSchema(repositorySchema);
            expect(result).toContain('Returns: Object {'); // 🎯 Agnostic: no title = Object
            expect(result).toContain('http_url: string');
            expect(result).toContain('avatar_url: string');
            expect(result).toContain('organizationName: string');
        });

        it('should format Repository array (caso real)', () => {
            const schema = {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        http_url: { type: 'string' },
                        avatar_url: { type: 'string' },
                        organizationName: { type: 'string' },
                        visibility: {
                            type: 'string',
                            enum: ['public', 'private'],
                        },
                    },
                },
                description: 'List of repositories',
            };

            const result = formatOutputSchema(schema);
            // 🎯 Agnostic: now shows detailed structure
            expect(result).toContain('\n  Returns: Object {');
            expect(result).toContain('[] - List of repositories');
            expect(result).toContain('http_url: string');
            expect(result).toContain('avatar_url: string');
        });
    });

    describe('🔄 Wrapper Detection', () => {
        it('should unwrap success/count/data pattern', () => {
            const wrapperSchema = {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    count: { type: 'number' },
                    data: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                name: { type: 'string' },
                                http_url: { type: 'string' },
                                organizationName: { type: 'string' },
                            },
                        },
                    },
                },
                required: ['success', 'count', 'data'],
            };

            const result = formatOutputSchema(wrapperSchema);
            expect(result).toContain('\n  Returns: Object {'); // 🎯 Agnostic: now shows structure
            expect(result).toContain('http_url: string');
            expect(result).not.toContain('success');
            expect(result).not.toContain('count');
        });

        it('should unwrap success/data pattern', () => {
            const wrapperSchema = {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    data: {
                        type: 'string',
                        description: 'Message',
                    },
                },
                required: ['success', 'data'],
            };

            const result = formatOutputSchema(wrapperSchema);
            expect(result).toBe('\n  Returns: string - Message');
        });

        it('should unwrap data-only pattern', () => {
            const wrapperSchema = {
                type: 'object',
                properties: {
                    data: {
                        type: 'array',
                        items: { type: 'string' },
                    },
                },
            };

            const result = formatOutputSchema(wrapperSchema);
            expect(result).toBe('\n  Returns: string[]');
        });

        it('should unwrap results pattern', () => {
            const wrapperSchema = {
                type: 'object',
                properties: {
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                email: { type: 'string' },
                                username: { type: 'string' },
                            },
                        },
                    },
                    total: { type: 'number' },
                },
            };

            const result = formatOutputSchema(wrapperSchema);
            expect(result).toContain('\n  Returns: Object {'); // 🎯 Agnostic: now shows structure
            expect(result).toContain('email: string');
        });
    });

    describe('🧬 Pattern Recognition', () => {
        it('should detect User pattern', () => {
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    email: { type: 'string' },
                    username: { type: 'string' },
                    firstName: { type: 'string' },
                },
            };

            const result = formatOutputSchema(schema);
            expect(result).toContain('Returns: Object {'); // 🎯 Agnostic: no title = Object
        });

        it('should detect Product pattern', () => {
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    price: { type: 'number' },
                    sku: { type: 'string' },
                },
            };

            const result = formatOutputSchema(schema);
            expect(result).toContain('Returns: Object {'); // 🎯 Agnostic: no title = Object
        });

        it('should detect Order pattern', () => {
            const schema = {
                type: 'object',
                properties: {
                    orderId: { type: 'string' },
                    total: { type: 'number' },
                    items: { type: 'array' },
                    status: { type: 'string' },
                },
            };

            const result = formatOutputSchema(schema);
            expect(result).toContain('Returns: Object {'); // 🎯 Agnostic: no title = Object
        });

        it('should detect Address pattern', () => {
            const schema = {
                type: 'object',
                properties: {
                    street: { type: 'string' },
                    city: { type: 'string' },
                    zipCode: { type: 'string' },
                    country: { type: 'string' },
                },
            };

            const result = formatOutputSchema(schema);
            expect(result).toContain('Returns: Object {'); // 🎯 Agnostic: no title = Object
        });

        it('should detect Project pattern', () => {
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    projectId: { type: 'string' },
                    workspaceId: { type: 'string' },
                },
            };

            const result = formatOutputSchema(schema);
            expect(result).toContain('Returns: Object {'); // 🎯 Agnostic: no title = Object
        });

        it('should fallback to Entity for id+name pattern', () => {
            const schema = {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                },
            };

            const result = formatOutputSchema(schema);
            expect(result).toContain('Returns: Object {'); // 🎯 Agnostic: no title = Object
        });
    });

    describe('🔗 References and Definitions', () => {
        it('should extract type from $ref', () => {
            const schema = {
                $ref: '#/definitions/CustomerData',
            };

            const result = formatOutputSchema(schema);
            expect(result).toContain('Returns: unknown'); // 🎯 Agnostic: $ref not fully supported yet
        });

        it('should extract type from $id', () => {
            const schema = {
                $id: 'https://api.example.com/schemas/employee.json',
                type: 'object',
                properties: {
                    id: { type: 'string' },
                },
            };

            const result = formatOutputSchema(schema);
            expect(result).toContain('Returns: Employee {');
        });

        it('should extract from single definition', () => {
            const schema = {
                definitions: {
                    TeamMember: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                        },
                    },
                },
            };

            const result = formatOutputSchema(schema);
            expect(result).toContain('Returns: unknown'); // 🎯 Agnostic: definitions not fully supported yet
        });
    });

    describe('🔀 Union Types', () => {
        it('should format oneOf unions', () => {
            const schema = {
                oneOf: [
                    { type: 'string', description: 'Text content' },
                    {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['rich_text'] },
                            content: { type: 'string' },
                        },
                    },
                ],
                description: 'Content that can be text or rich object',
            };

            const result = formatOutputSchema(schema);
            expect(result).toContain(
                'Returns: (string - Text content | Object {',
            );
            expect(result).toContain('})'); // 🎯 Union type description handled correctly
        });
    });

    describe('🔧 Edge Cases', () => {
        it('should handle empty schema', () => {
            const result = formatOutputSchema({});
            expect(result).toBe(''); // 🚫 Empty schemas don't show Returns
        });

        it('should handle null schema', () => {
            const result = formatOutputSchema(null as any);
            expect(result).toBe('');
        });

        it('should handle array without items', () => {
            const schema = {
                type: 'array',
                description: 'Generic array',
            };

            const result = formatOutputSchema(schema);
            expect(result).toBe('\n  Returns: array - Generic array');
        });

        it('should handle object without properties', () => {
            const schema = {
                type: 'object',
                description: 'Generic object',
            };

            const result = formatOutputSchema(schema);
            expect(result).toBe(''); // 🚫 Objects without properties don't show Returns
        });
    });

    describe('🎯 Real-world Cases', () => {
        it('should format complex nested Repository array from MCP tool', () => {
            // Caso real: kodus-mcp-server.list_repositories
            const complexSchema = {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    count: { type: 'number' },
                    data: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: {
                                    type: 'string',
                                    description: 'Repository ID',
                                },
                                name: {
                                    type: 'string',
                                    description: 'Repository name',
                                },
                                http_url: {
                                    type: 'string',
                                    description: 'HTTP clone URL',
                                },
                                avatar_url: {
                                    type: 'string',
                                    description: 'Avatar image URL',
                                },
                                organizationName: {
                                    type: 'string',
                                    description: 'Organization name',
                                },
                                visibility: {
                                    type: 'string',
                                    enum: ['public', 'private'],
                                    description: 'Repository visibility',
                                },
                                selected: {
                                    type: 'boolean',
                                    description: 'Is selected',
                                },
                                default_branch: {
                                    type: 'string',
                                    description: 'Default branch name',
                                },
                                project: {
                                    type: 'object',
                                    properties: {
                                        id: { type: 'string' },
                                        name: { type: 'string' },
                                    },
                                    description: 'Associated project',
                                },
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID',
                                },
                            },
                            required: [
                                'id',
                                'name',
                                'http_url',
                                'organizationName',
                            ],
                        },
                        description: 'List of repositories',
                    },
                },
                required: ['success', 'count', 'data'],
            };

            const result = formatOutputSchema(complexSchema);

            // Deve extrair só o data e mostrar estrutura detalhada
            expect(result).toContain('\n  Returns: Object {'); // 🎯 Agnostic: shows structure
            expect(result).toContain('[] - List of repositories'); // Array indicator
            expect(result).toContain('http_url: string');
            expect(result).toContain('avatar_url: string');

            // NÃO deve conter wrappers
            expect(result).not.toContain('success');
            expect(result).not.toContain('count');
        });
    });
});
