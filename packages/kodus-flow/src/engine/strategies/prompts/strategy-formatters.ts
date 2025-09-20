import { AgentContext } from '../../../core/types/allTypes.js';
import type { AgentRuntimeContext } from '../../../core/contextNew/types/context-types.js';

export interface Tool {
    name: string;
    description?: string;
    parameters?: {
        type: string;
        properties?: Record<string, any>;
        required?: string[];
    };
    outputSchema?: Record<string, unknown>;
}

export interface RewooEvidenceItem {
    id: string;
    sketchId: string;
    toolName: string;
    input?: any;
    output?: any;
    error?: string;
    latencyMs?: number;
}

export class ToolParameterFormatter {
    formatToolParameters(tool: Tool): string {
        if (!tool.parameters?.properties) {
            return '';
        }

        const properties = tool.parameters.properties as Record<
            string,
            unknown
        >;
        const required = (tool.parameters.required as string[]) || [];

        const paramStrings: string[] = [];

        for (const [name, prop] of Object.entries(properties)) {
            const isRequired = required.includes(name);
            const propObj = prop as {
                type?: string;
                description?: string;
                enum?: unknown[];
                format?: string;
                properties?: Record<string, unknown>;
                items?: Record<string, unknown>;
                nullable?: boolean;
                default?: unknown;
                minLength?: number;
                maxLength?: number;
                minimum?: number;
                maximum?: number;
            };

            // Determina o tipo de display
            let typeDisplay = this.determineTypeDisplay(propObj);

            // Adiciona constraints se existirem
            typeDisplay = this.addConstraints(typeDisplay, propObj);

            // Adiciona marker de obrigatoriedade
            const marker = isRequired ? 'REQUIRED' : 'OPTIONAL';

            // Monta a linha do parâmetro
            const paramLine = `- ${name} (${typeDisplay}, ${marker})${
                propObj.description ? `: ${propObj.description}` : ''
            }`;

            paramStrings.push(paramLine);

            // Adiciona propriedades aninhadas para objetos complexos
            const nestedLines = this.formatNestedProperties(name, propObj);
            paramStrings.push(...nestedLines);
        }

        return paramStrings.length > 0
            ? `Parameters:\n    ${paramStrings.join('\n    ')}`
            : '';
    }

    /**
     * Formatação avançada de parâmetros baseada no planner-prompt-composer
     */

    /**
     * Determines how to display the type
     */
    private determineTypeDisplay(propObj: any): string {
        // Handle enums first
        if (propObj.enum && Array.isArray(propObj.enum)) {
            const enumValues = propObj.enum
                .map((v: unknown) => `"${v}"`)
                .join(' | ');
            return `(${enumValues})`;
        }

        // Handle arrays
        if (propObj.type === 'array' && propObj.items) {
            return this.formatArrayType(propObj.items);
        }

        // Handle objects
        if (propObj.type === 'object' && propObj.properties) {
            return this.formatObjectType(propObj.properties);
        }

        // Handle unions (anyOf, oneOf)
        if (propObj.anyOf || propObj.oneOf) {
            return this.formatUnionType(propObj);
        }

        // Simple types
        let typeDisplay = propObj.type || 'unknown';

        // Handle specific formats
        if (propObj.format) {
            typeDisplay = `${typeDisplay}:${propObj.format}`;
        }

        return typeDisplay;
    }

    /**
     * Formata tipos de array
     */
    private formatArrayType(items: any): string {
        if (items.type === 'object' && items.properties) {
            const propKeys = Object.keys(items.properties);
            if (propKeys.length > 0) {
                return `array<object{${propKeys.join(',')}}>`;
            }
            return 'array<object>';
        }

        if (items.enum && Array.isArray(items.enum)) {
            const enumValues = items.enum
                .map((v: unknown) => `"${v}"`)
                .join('|');
            return `array<enum[${enumValues}]>`;
        }

        return `array<${items.type || 'unknown'}>`;
    }

    /**
     * Formata tipos de objeto
     */
    private formatObjectType(properties: Record<string, unknown>): string {
        const propKeys = Object.keys(properties);
        if (propKeys.length > 0) {
            return `object{${propKeys.join(',')}}`;
        }
        return 'object';
    }

    /**
     * Formata tipos de união
     */
    private formatUnionType(propObj: any): string {
        const unionTypes = propObj.anyOf || propObj.oneOf || [];
        const types = unionTypes.map((t: any) => this.determineTypeDisplay(t));
        return `(${types.join(' | ')})`;
    }

    /**
     * Adiciona constraints ao tipo
     */
    private addConstraints(typeDisplay: string, propObj: any): string {
        const constraints: string[] = [];

        // String constraints
        if (
            propObj.minLength !== undefined ||
            propObj.maxLength !== undefined
        ) {
            const strConstraints: string[] = [];
            if (propObj.minLength !== undefined)
                strConstraints.push(`min: ${propObj.minLength}`);
            if (propObj.maxLength !== undefined)
                strConstraints.push(`max: ${propObj.maxLength}`);
            constraints.push(`[${strConstraints.join(', ')}]`);
        }

        // Number constraints
        if (propObj.minimum !== undefined || propObj.maximum !== undefined) {
            const numConstraints: string[] = [];
            if (propObj.minimum !== undefined)
                numConstraints.push(`min: ${propObj.minimum}`);
            if (propObj.maximum !== undefined)
                numConstraints.push(`max: ${propObj.maximum}`);
            constraints.push(`[${numConstraints.join(', ')}]`);
        }

        // Default value
        if (propObj.default !== undefined) {
            constraints.push(`default: ${JSON.stringify(propObj.default)}`);
        }

        // Nullable
        if (propObj.nullable) {
            return `${typeDisplay} | null`;
        }

        return constraints.length > 0
            ? `${typeDisplay} ${constraints.join(' ')}`
            : typeDisplay;
    }

    /**
     * Formata propriedades aninhadas
     */
    private formatNestedProperties(
        _parentName: string,
        propObj: any,
    ): string[] {
        const nestedLines: string[] = [];

        // Handle array of objects
        if (
            propObj.type === 'array' &&
            propObj.items?.type === 'object' &&
            propObj.items.properties
        ) {
            const nestedProps = propObj.items.properties as Record<
                string,
                unknown
            >;
            const nestedRequired = (propObj.items.required as string[]) || [];

            for (const [nestedName, nestedProp] of Object.entries(
                nestedProps,
            )) {
                const nestedPropObj = nestedProp as any;
                const isNestedRequired = nestedRequired.includes(nestedName);
                const nestedMarker = isNestedRequired ? 'REQUIRED' : 'OPTIONAL';

                let nestedTypeDisplay = nestedPropObj.type || 'unknown';
                if (nestedPropObj.enum && Array.isArray(nestedPropObj.enum)) {
                    const enumValues = nestedPropObj.enum
                        .map((v: unknown) => `"${v}"`)
                        .join('|');
                    nestedTypeDisplay = `enum[${enumValues}]`;
                }

                const nestedLine = `    - ${nestedName} (${nestedTypeDisplay}, ${nestedMarker})${
                    nestedPropObj.description
                        ? `: ${nestedPropObj.description}`
                        : ''
                }`;
                nestedLines.push(nestedLine);
            }
        }

        // Handle nested object properties
        if (propObj.type === 'object' && propObj.properties) {
            const nestedProps = propObj.properties as Record<string, unknown>;
            const nestedRequired = (propObj.required as string[]) || [];

            for (const [nestedName, nestedProp] of Object.entries(
                nestedProps,
            )) {
                const nestedPropObj = nestedProp as any;
                const isNestedRequired = nestedRequired.includes(nestedName);
                const nestedMarker = isNestedRequired ? 'REQUIRED' : 'OPTIONAL';

                let nestedTypeDisplay =
                    this.determineTypeDisplay(nestedPropObj);
                nestedTypeDisplay = this.addConstraints(
                    nestedTypeDisplay,
                    nestedPropObj,
                );

                const nestedLine = `    - ${nestedName} (${nestedTypeDisplay}, ${nestedMarker})${
                    nestedPropObj.description
                        ? `: ${nestedPropObj.description}`
                        : ''
                }`;
                nestedLines.push(nestedLine);
            }
        }

        return nestedLines;
    }
}

export class ContextFormatter {
    formatAdditionalContext(agentContext: AgentContext): string {
        const sections: string[] = ['## 🔍 ADDITIONAL INFO'];

        // Formatar valor de forma segura
        const formatValue = (value: unknown): string => {
            if (value === null) {
                return 'null';
            }
            if (value === undefined) {
                return 'undefined';
            }

            if (typeof value === 'object') {
                try {
                    return JSON.stringify(value, null, 2);
                } catch (error) {
                    return `[OBJECT - CANNOT SERIALIZE: ${String(error)}]`;
                }
            }

            return String(value);
        };

        if (agentContext.agentExecutionOptions?.userContext) {
            const userCtx = agentContext.agentExecutionOptions
                .userContext as Record<string, unknown>;
            sections.push('### 👤 USER CONTEXT');
            this.formatContextFields(userCtx, sections, formatValue);
        }

        // Agent identity agora é tratado separadamente antes das tools
        // Método formatAgentIdentity está disponível publicamente para uso externo

        // Handle session context
        // if (agentContext.sessionContext) {
        //     const session = additionalContext.sessionContext as Record<
        //         string,
        //         unknown
        //     >;
        //     sections.push('### 📊 SESSION CONTEXT');
        //     this.formatContextFields(session, sections, formatValue);
        // }

        // // Handle runtime context
        // if (additionalContext.runtimeContext) {
        //     const runtime = additionalContext.runtimeContext as Record<
        //         string,
        //         unknown
        //     >;
        //     sections.push('### ⚙️ RUNTIME CONTEXT');
        //     this.formatContextFields(runtime, sections, formatValue);
        // }

        return sections.join('\n');
    }

    /**
     * Formatar agent identity de forma específica
     */
    formatAgentIdentity(identity: Record<string, unknown>): string {
        const sections: string[] = [];

        const formatValue = (value: unknown): string => {
            if (typeof value === 'string') {
                return value;
            }
            if (typeof value === 'object') {
                try {
                    return JSON.stringify(value, null, 2);
                } catch (error) {
                    return `[OBJECT - CANNOT SERIALIZE: ${String(error)}]`;
                }
            }
            return String(value);
        };

        sections.push('### 🤖 AGENT IDENTITY');

        // Campos específicos do identity com formatação especial
        if (identity.name) {
            sections.push(`**Name:** ${formatValue(identity.name)}`);
        }

        if (identity.description) {
            sections.push(
                `**Description:** ${formatValue(identity.description)}`,
            );
        }

        if (identity.role) {
            sections.push(`**Role:** ${formatValue(identity.role)}`);
        }

        if (identity.capabilities) {
            sections.push(
                `**Capabilities:** ${formatValue(identity.capabilities)}`,
            );
        }

        if (identity.personality) {
            sections.push(
                `**Personality:** ${formatValue(identity.personality)}`,
            );
        }

        if (identity.language) {
            sections.push(
                `**🌐 Language Preference:** ${formatValue(identity.language)}`,
            );
        }

        if (identity.languageInstructions) {
            sections.push(
                `**📝 Language Instructions:** ${formatValue(identity.languageInstructions)}`,
            );
        }

        // Campos adicionais usando formatação genérica
        const additionalFields = Object.keys(identity).filter(
            (key) =>
                ![
                    'name',
                    'description',
                    'role',
                    'capabilities',
                    'personality',
                    'language', // 🔥 Excluído para não duplicar
                    'languageInstructions', // 🔥 Excluído para não duplicar
                ].includes(key),
        );

        additionalFields.forEach((key) => {
            const value = identity[key];
            if (value !== undefined && value !== null) {
                sections.push(
                    `**${this.formatFieldName(key)}:** ${formatValue(value)}`,
                );
            }
        });

        return sections.join('\n');
    }

    /**
     * Formatação genérica de campos de context
     */
    private formatContextFields(
        context: Record<string, unknown>,
        sections: string[],
        formatValue: (value: unknown) => string,
    ): void {
        Object.entries(context).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                try {
                    if (typeof value === 'object' && value !== null) {
                        const obj = value as Record<string, unknown>;

                        if (!this.isObjectTooComplex(obj)) {
                            const formattedValue = formatValue(value);
                            sections.push(
                                `**${this.formatFieldName(key)}:** ${formattedValue}`,
                            );
                        } else {
                            this.formatGenericObject(key, obj, sections);
                        }
                    } else {
                        const formattedValue = formatValue(value);
                        sections.push(
                            `**${this.formatFieldName(key)}:** ${formattedValue}`,
                        );
                    }
                } catch (error) {
                    sections.push(
                        `**${this.formatFieldName(key)}:** [Error formatting: ${String(error)}]`,
                    );
                }
            }
        });
    }

    /**
     * Formatar objetos complexos de forma inteligente e legível
     */
    private formatGenericObject(
        key: string,
        obj: Record<string, unknown>,
        sections: string[],
    ): void {
        const keys = Object.keys(obj);

        if (keys.length <= 3) {
            try {
                const jsonStr = JSON.stringify(obj, null, 2);
                if (jsonStr.length < 500) {
                    sections.push(`**${this.formatFieldName(key)}:**`);
                    sections.push(`\`\`\`json\n${jsonStr}\n\`\`\``);
                    return;
                }
            } catch {}
        }

        sections.push(`**${this.formatFieldName(key)}:**`);

        keys.forEach((subKey) => {
            const subValue = obj[subKey];
            if (subValue !== undefined && subValue !== null) {
                try {
                    const formattedKey = this.formatFieldName(subKey);

                    if (typeof subValue === 'object' && subValue !== null) {
                        const nestedObj = subValue as Record<string, unknown>;
                        const nestedKeys = Object.keys(nestedObj);

                        // Show ALL nested fields - no truncation, no limits
                        sections.push(`  - ${formattedKey}:`);
                        nestedKeys.forEach((nestedKey) => {
                            const nestedValue = nestedObj[nestedKey];
                            if (
                                nestedValue !== undefined &&
                                nestedValue !== null
                            ) {
                                const formatted = this.formatSimpleValue(
                                    nestedValue,
                                    false,
                                ); // Don't truncate
                                sections.push(
                                    `    • ${this.formatFieldName(nestedKey)}: ${formatted}`,
                                );
                            }
                        });
                    } else {
                        // Valores simples
                        const formatted = this.formatSimpleValue(
                            subValue,
                            false,
                        );
                        sections.push(`  - ${formattedKey}: ${formatted}`);
                    }
                } catch {
                    sections.push(
                        `  - ${this.formatFieldName(subKey)}: [Error formatting]`,
                    );
                }
            }
        });
    }

    /**
     * Format simple values safely and intelligently
     * @param truncate - Whether to truncate long values (default: true)
     */
    private formatSimpleValue(value: unknown, truncate = true): string {
        if (value === null || value === undefined) return 'null';

        switch (typeof value) {
            case 'string':
                // Try to parse as JSON first - especially important for nested objects
                if (
                    value.length > 0 &&
                    (value.startsWith('{') || value.startsWith('['))
                ) {
                    try {
                        const parsed = JSON.parse(value);
                        if (typeof parsed === 'object' && parsed !== null) {
                            const keys = Object.keys(parsed);

                            // Para objetos pequenos, mostra completo
                            if (keys.length <= 2) {
                                return JSON.stringify(parsed);
                            }

                            // 🔥 MODIFICADO: Mostrar dados completos para objetos importantes
                            // Remove limite de 5 campos - mostra tudo
                            const preview = keys
                                .slice(0, 5) // Mostra até 5 campos como preview
                                .map((k) => {
                                    const val = parsed[k];
                                    return `${k}: ${JSON.stringify(val)}`;
                                })
                                .join(', ');
                            return `[Object: ${preview}${keys.length > 5 ? ', ...' : ''}]`;
                        }
                    } catch {}
                }

                // REMOVIDO: Sem truncagem para texto longo

                // Show full content when truncate is false
                if (!truncate) {
                    return value;
                }

                // REMOVIDO: Sem truncagem para strings
                return value;

            case 'number':
            case 'boolean':
                return String(value);

            case 'object':
                try {
                    const obj = value as Record<string, unknown>;
                    const keys = Object.keys(obj);

                    // Agnostic approach: expand based only on object size
                    // For small objects, show complete content
                    if (keys.length <= 3) {
                        const str = JSON.stringify(value, null, 2);
                        return str;
                    }

                    // For larger objects, show summary but with more details
                    if (keys.length <= 8) {
                        const preview = keys
                            .slice(0, 5)
                            .map((k) => {
                                const val = obj[k];
                                return `${k}: ${JSON.stringify(val)}`;
                            })
                            .join(', ');
                        return `[Object: ${preview}${keys.length > 5 ? ', ...' : ''}]`;
                    }

                    // For very large objects, show count
                    return `[Object with ${keys.length} fields]`;
                } catch {
                    return '[Complex Object]';
                }

            default:
                return String(value);
        }
    }

    /**
     * Format field name for display - handles multiple naming conventions
     */
    private formatFieldName(key: string): string {
        // Handle snake_case first (most common in APIs)
        if (key.includes('_')) {
            return key
                .split('_')
                .map(
                    (word) =>
                        word.charAt(0).toUpperCase() +
                        word.slice(1).toLowerCase(),
                )
                .join(' ');
        }

        // Handle camelCase
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (str) => str.toUpperCase())
            .trim();
    }

    /**
     * Verifica se um objeto é muito complexo para formatação direta
     * Considera: número de chaves, profundidade, arrays grandes e strings longas
     * Ajustado para permitir mais complexidade no contexto do usuário
     */
    private isObjectTooComplex(obj: object, depth = 0, maxDepth = 4): boolean {
        // Limite de profundidade aumentado para permitir mais aninhamento
        if (depth >= maxDepth) {
            return true;
        }

        const keys = Object.keys(obj);

        // Limite de chaves aumentado para permitir mais campos
        if (keys.length > 12) {
            return true;
        }

        // Arrays menores são permitidos
        for (const key of keys) {
            const value = (obj as any)[key];

            if (Array.isArray(value) && value.length > 5) {
                return true;
            }

            // REMOVIDO: Sem limite para strings na detecção de complexidade

            // Verificar recursivamente objetos aninhados
            if (typeof value === 'object' && value !== null) {
                if (this.isObjectTooComplex(value, depth + 1, maxDepth)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Formata agent context para uso em prompts
     */
    formatAgentContext(agentContext: AgentContext): string {
        const contextParts: string[] = [];

        if ((agentContext as any).kernel?.state) {
            contextParts.push(
                `**Kernel State:** ${(agentContext as any).kernel.state}`,
            );
        }

        if ((agentContext as any).memory?.totalItems) {
            contextParts.push(
                `**Memory Items:** ${(agentContext as any).memory.totalItems}`,
            );
        }

        if ((agentContext as any).session?.duration) {
            const duration = (agentContext as any).session.duration;
            const minutes = Math.floor(duration / (60 * 1000));
            contextParts.push(`**Session Duration:** ${minutes}min`);
        }

        return contextParts.join('\n');
    }

    /**
     * 🎯 Formata RuntimeContext do ContextNew com informações relevantes para o LLM
     */
    formatRuntimeContext(runtimeContext: AgentRuntimeContext): string {
        const sections: string[] = [];

        // 1. Session Info - Identificação básica
        sections.push(`## 🎯 SESSION CONTEXT
**Session ID:** ${runtimeContext.sessionId}
**Thread ID:** ${runtimeContext.threadId}
**Execution ID:** ${runtimeContext.executionId}`);

        // 2. Current State - MUITO IMPORTANTE para o LLM entender onde está
        const stateInfo: string[] = [
            `**Phase:** ${runtimeContext.state.phase}`,
            `**Last User Intent:** ${runtimeContext.state.lastUserIntent}`,
        ];

        if (runtimeContext.state.currentIteration !== undefined) {
            const total = runtimeContext.state.totalIterations || '?';
            stateInfo.push(
                `**Current Iteration:** ${runtimeContext.state.currentIteration}/${total}`,
            );
        }

        if (runtimeContext.state.currentStep) {
            stateInfo.push(
                `**Current Step:** ${runtimeContext.state.currentStep}`,
            );
        }

        if (
            runtimeContext.state.pendingActions &&
            runtimeContext.state.pendingActions.length > 0
        ) {
            stateInfo.push(
                `**Pending Actions:**\n  - ${runtimeContext.state.pendingActions.join('\n  - ')}`,
            );
        }

        sections.push(`## 📊 CURRENT STATE\n${stateInfo.join('\n')}`);

        // 3. Execution Progress - Ajuda o LLM a não repetir trabalho
        const execution = runtimeContext.execution;
        if (
            execution &&
            (execution.completedSteps.length > 0 ||
                execution.failedSteps.length > 0)
        ) {
            const progressInfo: string[] = [];

            // Mostrar últimos 5 steps completados
            if (execution.completedSteps.length > 0) {
                progressInfo.push(
                    `**Completed Steps (${execution.completedSteps.length} total):**`,
                );
                const recentCompleted = execution.completedSteps.slice(-5);
                progressInfo.push(...recentCompleted.map((s) => `  ✓ ${s}`));
            }

            // Mostrar últimos 3 steps com falha
            if (execution.failedSteps.length > 0) {
                progressInfo.push(
                    `**Failed Steps (${execution.failedSteps.length} total):**`,
                );
                const recentFailed = execution.failedSteps.slice(-3);
                progressInfo.push(...recentFailed.map((s) => `  ✗ ${s}`));
            }

            if (execution.currentTool) {
                progressInfo.push(`**Current Tool:** ${execution.currentTool}`);
            }

            if (execution.toolCallCount) {
                progressInfo.push(
                    `**Total Tool Calls:** ${execution.toolCallCount}`,
                );
            }

            if (execution.lastError) {
                progressInfo.push(`**Last Error:** ${execution.lastError}`);
            }

            sections.push(
                `## ✅ EXECUTION PROGRESS\n${progressInfo.join('\n')}`,
            );
        }

        return sections.join('\n\n');
    }

    formatReplanContext(replanContext: Record<string, unknown>): string {
        const sections: string[] = ['## 🔄 REPLAN CONTEXT'];

        if (replanContext.executedPlan) {
            const executedPlan = replanContext.executedPlan as Record<
                string,
                unknown
            >;
            const plan = executedPlan.plan as Record<string, unknown>;

            sections.push('### 📋 EXECUTED PLAN');
            if (plan.id) {
                sections.push(`**Plan ID:** ${plan.id}`);
            }

            const executionData = executedPlan.executionData as Record<
                string,
                unknown
            >;

            if (executionData) {
                sections.push('### EXECUTION DATA');

                // Tools that worked
                const toolsThatWorked =
                    executionData.toolsThatWorked as unknown[];
                if (toolsThatWorked?.length > 0) {
                    toolsThatWorked.forEach((tool: unknown) => {
                        const toolData = tool as Record<string, unknown>;
                        const toolName =
                            toolData.tool || toolData.stepId || 'Unknown';
                        const description =
                            toolData.description || 'No description';
                        const result = toolData.result || 'No result';

                        sections.push(`  - ✅ ${toolName}: ${description}`);
                        sections.push(
                            `    Result: ${typeof result === 'string' ? result : JSON.stringify(result)}`,
                        );
                    });
                }

                // Tools that failed
                const toolsThatFailed =
                    executionData.toolsThatFailed as unknown[];
                if (toolsThatFailed?.length > 0) {
                    sections.push(
                        `**❌ Failed Tools:** ${toolsThatFailed.length}`,
                    );
                    toolsThatFailed.forEach((tool: unknown) => {
                        const toolData = tool as Record<string, unknown>;
                        const toolName =
                            toolData.tool || toolData.stepId || 'Unknown';
                        const error = toolData.error || 'Unknown error';
                        sections.push(`  - ${toolName}: ${error}`);
                    });
                }
            }
        }

        // Plan history
        if (
            replanContext.planHistory &&
            Array.isArray(replanContext.planHistory)
        ) {
            const history = replanContext.planHistory as Array<
                Record<string, unknown>
            >;
            if (history.length > 0) {
                sections.push('### 📚 PLAN HISTORY');
                sections.push(`**Previous Attempts:** ${history.length}`);

                history.forEach((planData, index) => {
                    const plan = planData.plan as Record<string, unknown>;
                    sections.push(
                        `\n**Attempt ${index + 1}:** ${plan.id || 'Unknown Plan'}`,
                    );
                    if (plan.goal) sections.push(`  Goal: "${plan.goal}"`);
                });
            }
        }

        sections.push(
            '\n**⚠️ REPLAN MODE:** Use previous results to improve the new plan.',
        );
        return sections.join('\n');
    }

    // 🔥 REMOVIDO: truncateResult foi inlineado acima
}

export class SchemaFormatter {
    formatOutputSchema(
        outputSchema: Record<string, unknown>,
        toolName?: string,
    ): string {
        if (!outputSchema) {
            return '';
        }

        // Unwrap schema se necessário
        const unwrapped = this.unwrapOutputSchema(outputSchema);

        // Verifica se é vazio
        if (this.isEmptyOutputSchema(unwrapped)) {
            return '';
        }

        // Formata o tipo
        const formatted = this.formatSchemaType(unwrapped, 0, false);
        if (!formatted) {
            return '';
        }

        // Verifica se é apenas tipo genérico
        if (this.isGenericTypeOnly(formatted)) {
            return '';
        }

        const toolSuffix = toolName ? ` (from ${toolName})` : '';
        return `\n  Returns: ${formatted}${toolSuffix}`;
    }

    private unwrapOutputSchema(
        schema: Record<string, unknown>,
    ): Record<string, unknown> {
        if (schema.type !== 'object' || !schema.properties) {
            return schema;
        }

        const properties = schema.properties as Record<string, unknown>;
        const propNames = Object.keys(properties);

        if (
            propNames.includes('data') &&
            (propNames.includes('success') || propNames.includes('count'))
        ) {
            const dataField = properties.data as Record<string, unknown>;
            if (dataField) return dataField;
        }

        if (propNames.length === 1 && propNames[0] === 'data') {
            const dataField = properties.data as Record<string, unknown>;
            if (dataField) return dataField;
        }

        if (propNames.includes('results') && propNames.length <= 3) {
            const resultsField = properties.results as Record<string, unknown>;
            if (resultsField) return resultsField;
        }

        return schema;
    }

    private isEmptyOutputSchema(schema: Record<string, unknown>): boolean {
        if (!schema || Object.keys(schema).length === 0) return true;

        if (schema.type === 'object') {
            const properties = schema.properties as Record<string, unknown>;
            if (!properties || Object.keys(properties).length === 0)
                return true;
        }

        return false;
    }

    private isGenericTypeOnly(formatted: string): boolean {
        const trimmed = formatted.trim();
        const genericTypes = [
            'Object',
            'Array',
            'string',
            'number',
            'boolean',
            'any',
        ];

        return genericTypes.includes(trimmed);
    }

    private formatSchemaType(
        schema: Record<string, unknown>,
        depth: number = 0,
        showRequiredMarkers: boolean = true,
    ): string {
        if (!schema) return 'unknown';

        const indent = '    '.repeat(depth);
        const type = schema.type as string;
        const description = schema.description as string;
        const enumValues = schema.enum as unknown[];

        // Handle enums
        if (enumValues && enumValues.length > 0) {
            const values = enumValues.map((v) => `"${v}"`).join(' | ');
            const enumType = `(${values})`;
            return description ? `${enumType} - ${description}` : enumType;
        }

        switch (type) {
            case 'string': {
                let typeDisplay = 'string';
                if ((schema as any).format) {
                    typeDisplay += ` (${(schema as any).format})`;
                }

                const constraints = this.formatStringConstraints(schema as any);
                if (constraints) typeDisplay += ` ${constraints}`;

                return description
                    ? `${typeDisplay} - ${description}`
                    : typeDisplay;
            }

            case 'number':
            case 'integer': {
                let typeDisplay = type;
                const constraints = this.formatNumberConstraints(schema as any);
                if (constraints) typeDisplay += ` ${constraints}`;

                return description
                    ? `${typeDisplay} - ${description}`
                    : typeDisplay;
            }

            case 'boolean':
                return description ? `boolean - ${description}` : 'boolean';

            case 'array': {
                const items = schema.items as Record<string, unknown>;

                if (!items) {
                    return description ? `array - ${description}` : 'array';
                }

                let itemType: string;
                if (items.type === 'object' && items.properties) {
                    const fullStructure = this.formatSchemaType(
                        items,
                        depth,
                        showRequiredMarkers,
                    );
                    itemType = fullStructure;
                } else {
                    itemType = this.formatSchemaType(
                        items,
                        depth,
                        showRequiredMarkers,
                    );
                }

                const arrayType = `${itemType}[]`;
                const constraints = this.formatArrayConstraints(schema as any);

                return description
                    ? `${arrayType}${constraints} - ${description}`
                    : `${arrayType}${constraints}`;
            }

            case 'object': {
                const properties = schema.properties as Record<string, unknown>;
                const required = (schema.required as string[]) || [];

                if (!properties || Object.keys(properties).length === 0) {
                    const typeName = this.extractTypeName(schema);
                    return description
                        ? `${typeName} - ${description}`
                        : typeName;
                }

                const lines: string[] = [];
                const typeName = this.extractTypeName(schema);
                const objectHeader = description
                    ? `${typeName} - ${description}`
                    : typeName;
                lines.push(`${objectHeader} {`);

                for (const [propName, propSchema] of Object.entries(
                    properties,
                )) {
                    const isRequired = required.includes(propName);
                    const requiredMark = showRequiredMarkers
                        ? isRequired
                            ? ' (required)'
                            : ' (optional)'
                        : '';
                    const propType = this.formatSchemaType(
                        propSchema as Record<string, unknown>,
                        depth + 1,
                        showRequiredMarkers,
                    );

                    lines.push(
                        `${indent}    ${propName}: ${propType}${requiredMark}`,
                    );
                }

                lines.push(`${indent}}`);
                return lines.join('\n');
            }

            default: {
                if (
                    (schema as any).oneOf ||
                    (schema as any).anyOf ||
                    (schema as any).allOf
                ) {
                    return this.formatUnionTypes(
                        schema as any,
                        depth,
                        showRequiredMarkers,
                    );
                }

                if (schema.properties) {
                    return this.formatSchemaType(
                        { ...schema, type: 'object' },
                        depth,
                        showRequiredMarkers,
                    );
                }

                return description ? `unknown - ${description}` : 'unknown';
            }
        }
    }

    /**
     * Formata constraints de string
     */
    private formatStringConstraints(schema: any): string {
        const constraints: string[] = [];
        if (schema.minLength !== undefined)
            constraints.push(`min: ${schema.minLength}`);
        if (schema.maxLength !== undefined)
            constraints.push(`max: ${schema.maxLength}`);
        return constraints.length > 0 ? `[${constraints.join(', ')}]` : '';
    }

    /**
     * Formata constraints de number
     */
    private formatNumberConstraints(schema: any): string {
        const constraints: string[] = [];
        if (schema.minimum !== undefined)
            constraints.push(`min: ${schema.minimum}`);
        if (schema.maximum !== undefined)
            constraints.push(`max: ${schema.maximum}`);
        return constraints.length > 0 ? `[${constraints.join(', ')}]` : '';
    }

    /**
     * Formata constraints de array
     */
    private formatArrayConstraints(schema: any): string {
        const constraints: string[] = [];
        if (schema.minItems !== undefined)
            constraints.push(`min: ${schema.minItems}`);
        if (schema.maxItems !== undefined)
            constraints.push(`max: ${schema.maxItems}`);
        return constraints.length > 0 ? ` [${constraints.join(', ')}]` : '';
    }

    /**
     * Formata tipos de união
     */
    private formatUnionTypes(
        schema: any,
        depth: number,
        showRequiredMarkers: boolean,
    ): string {
        const oneOf = schema.oneOf as Record<string, unknown>[];
        const anyOf = schema.anyOf as Record<string, unknown>[];
        const allOf = schema.allOf as Record<string, unknown>[];

        if (oneOf && oneOf.length > 0) {
            const types = oneOf.map((s) =>
                this.formatSchemaType(s, depth, showRequiredMarkers),
            );
            return `(${types.join(' | ')})`;
        }

        if (anyOf && anyOf.length > 0) {
            const types = anyOf.map((s) =>
                this.formatSchemaType(s, depth, showRequiredMarkers),
            );
            return `(${types.join(' | ')})`;
        }

        if (allOf && allOf.length > 0) {
            const types = allOf.map((s) =>
                this.formatSchemaType(s, depth, showRequiredMarkers),
            );
            return `(${types.join(' & ')})`;
        }

        return 'union';
    }

    /**
     * Extrai nome do tipo
     */
    private extractTypeName(schema: Record<string, unknown>): string {
        if (
            (schema as any).title &&
            typeof (schema as any).title === 'string'
        ) {
            return (schema as any).title;
        }

        if ((schema as any).$ref && typeof (schema as any).$ref === 'string') {
            const refMatch = (schema as any).$ref.match(/\/([^\/]+)$/);
            if (refMatch && refMatch[1]) return refMatch[1];
        }

        if ((schema as any).$id && typeof (schema as any).$id === 'string') {
            const idMatch = (schema as any).$id.match(/([^\/]+)\.json?$/);
            if (idMatch && idMatch[1]) return this.capitalize(idMatch[1]);
        }

        if (
            (schema as any).definitions &&
            typeof (schema as any).definitions === 'object'
        ) {
            const definitions = (schema as any).definitions as Record<
                string,
                unknown
            >;
            const defKeys = Object.keys(definitions);
            if (defKeys.length === 1 && defKeys[0]) return defKeys[0];
        }

        if (this.isZodSchema(schema)) {
            return this.extractFromZodSchema(schema);
        }

        if (
            (schema as any).components &&
            typeof (schema as any).components === 'object' &&
            (schema as any).components.schemas &&
            typeof (schema as any).components.schemas === 'object'
        ) {
            const schemas = (schema as any).components.schemas as Record<
                string,
                unknown
            >;
            const schemaKeys = Object.keys(schemas);
            if (schemaKeys.length === 1 && schemaKeys[0]) return schemaKeys[0];
        }

        const type = schema.type as string;
        switch (type) {
            case 'object':
                return 'Object';
            case 'array':
                return 'Array';
            case 'string':
                return 'String';
            case 'number':
            case 'integer':
                return 'Number';
            case 'boolean':
                return 'Boolean';
            default:
                return 'Object';
        }
    }

    /**
     * Verifica se é schema Zod
     */
    private isZodSchema(schema: Record<string, unknown>): boolean {
        return !!(
            (schema as any)._def ||
            (schema as any).parse ||
            (schema as any).safeParse ||
            ((schema as any).constructor &&
                (schema as any).constructor.name.includes('Zod'))
        );
    }

    /**
     * Extrai tipo de schema Zod
     */
    private extractFromZodSchema(schema: Record<string, unknown>): string {
        const def = (schema as any)._def as { typeName?: string };
        if (def?.typeName) {
            return def.typeName.replace(/^Zod/, '');
        }
        return 'Object';
    }

    /**
     * Capitaliza primeira letra
     */
    private capitalize(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

export class StrategyFormatters {
    private readonly toolFormatter = new ToolParameterFormatter();
    private readonly contextFormatter = new ContextFormatter();
    private readonly schemaFormatter = new SchemaFormatter();

    get tool(): ToolParameterFormatter {
        return this.toolFormatter;
    }
    get context(): ContextFormatter {
        return this.contextFormatter;
    }
    get schema(): SchemaFormatter {
        return this.schemaFormatter;
    }

    formatToolsList(
        tools:
            | Tool[]
            | Array<{
                  name: string;
                  description?: string;
                  parameters?: Record<string, unknown>;
                  outputSchema?: Record<string, unknown>;
              }>
            | string,
    ): string {
        const sections: string[] = ['## 🛠️ <AVAILABLE TOOLS>'];

        // Validate and parse tools
        const toolsArray = this.parseAndValidateTools(tools);
        if (toolsArray.length === 0) {
            return '## 🛠️ <AVAILABLE TOOLS>\nNo tools available.';
        }

        toolsArray.forEach((tool, index) => {
            sections.push(this.formatSingleTool(tool, index + 1));
            sections.push(''); // Add spacing between tools
        });

        return sections.join('\n');
    }

    private parseAndValidateTools(tools: any): Tool[] {
        if (!tools) {
            return [];
        }

        if (typeof tools === 'string') {
            try {
                const parsed = JSON.parse(tools);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }

        return Array.isArray(tools) ? tools : [];
    }

    private formatSingleTool(tool: Tool, index: number): string {
        const parts: string[] = [];

        // Tool header
        parts.push(`### ${index}. ${tool.name}`);
        if (tool.description) {
            parts.push(tool.description);
        }

        // Parameters
        const paramsSection = this.formatToolParametersSection(tool);
        if (paramsSection) {
            parts.push(paramsSection);
        }

        // Output schema
        const outputSection = this.formatToolOutputSection(tool);
        if (outputSection) {
            parts.push(outputSection);
        }

        return parts.join('\n');
    }

    /**
     * Formata seção de parâmetros da ferramenta
     */
    private formatToolParametersSection(tool: Tool): string {
        // Try inputJsonSchema first (new format)
        if ((tool as any).inputJsonSchema?.parameters?.properties) {
            return this.toolFormatter.formatToolParameters({
                name: tool.name,
                description: tool.description || tool.name,
                parameters: (tool as any).inputJsonSchema.parameters,
                inputSchema: {},
                outputSchema: (tool as any).outputJsonSchema?.parameters || {},
            } as Tool);
        }

        // Fallback to direct parameters
        if (tool.parameters?.properties) {
            return this.toolFormatter.formatToolParameters(tool);
        }

        return '';
    }

    /**
     * Formata seção de output da ferramenta
     */
    private formatToolOutputSection(tool: Tool): string {
        // Try outputJsonSchema first (new format)
        if ((tool as any).outputJsonSchema?.parameters?.properties) {
            return this.schemaFormatter.formatOutputSchema(
                (tool as any).outputJsonSchema.parameters,
                tool.name,
            );
        }

        // Fallback to outputSchema
        if (tool.outputSchema?.properties) {
            return this.schemaFormatter.formatOutputSchema(
                tool.outputSchema,
                tool.name,
            );
        }

        return '';
    }
}

export default StrategyFormatters;
