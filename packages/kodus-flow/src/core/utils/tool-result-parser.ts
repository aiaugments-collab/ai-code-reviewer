import { createLogger } from '../../observability/index.js';
import {
    MCPToolResult,
    ParsedToolResult,
    TextContent,
} from '../types/allTypes.js';

const logger = createLogger('tool-result-parser');

export function parseToolResult(result: unknown): ParsedToolResult {
    logger.debug('Parsing tool result', {
        resultType: typeof result,
        hasResult: !!result,
    });

    const parsingSteps: string[] = ['start'];
    let text = '';
    let data: Record<string, unknown> | undefined;
    let source: ParsedToolResult['metadata']['source'] = 'unknown';
    let contentType: ParsedToolResult['metadata']['contentType'] = 'empty';
    let isError = false;

    try {
        if (!result) {
            parsingSteps.push('null-check');
            return createEmptyResult(result, parsingSteps);
        }

        if (typeof result === 'string') {
            parsingSteps.push('string-parse');
            const parsed = parseStringResult(result);
            return {
                ...parsed,
                metadata: {
                    ...parsed.metadata,
                    parsingSteps: [
                        ...parsingSteps,
                        ...parsed.metadata.parsingSteps,
                    ],
                },
            };
        }

        if (typeof result === 'object') {
            parsingSteps.push('object-parse');

            if (isMCPToolResult(result)) {
                parsingSteps.push('mcp-format');
                const parsed = parseMCPResult(result as MCPToolResult);
                source = 'mcp';
                text = parsed.text;
                data = parsed.data;
                isError = parsed.isError;
                contentType = parsed.contentType;
            } else if (isNestedResult(result)) {
                parsingSteps.push('nested-format');
                const parsed = parseNestedResult(result);
                source = 'nested';
                text = parsed.text;
                data = parsed.data;
                isError = parsed.isError;
                contentType = parsed.contentType;
            } else {
                parsingSteps.push('simple-object');
                const parsed = parseSimpleObject(
                    result as Record<string, unknown>,
                );
                source = 'simple';
                text = parsed.text;
                data = parsed.data;
                isError = parsed.isError;
                contentType = parsed.contentType;
            }
        } else {
            parsingSteps.push('other-type');
            text = String(result);
            contentType = 'text';
            source = 'simple';
        }
    } catch (error) {
        logger.warn('Error parsing tool result, using fallback', {
            error: (error as Error).message,
            resultType: typeof result,
        });

        parsingSteps.push('error-fallback');
        text = String(result || 'No result');
        contentType = 'text';
        source = 'unknown';
    }

    const isSubstantial = assessSubstantiality(text, data);

    return {
        text,
        data,
        isSubstantial,
        isError,
        original: result,
        metadata: {
            source,
            contentType,
            textLength: text.length,
            hasStructuredData: !!data,
            parsingSteps,
        },
    };
}

function isMCPToolResult(obj: unknown): obj is MCPToolResult {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'content' in obj &&
        Array.isArray((obj as Record<string, unknown>).content)
    );
}

function isNestedResult(obj: unknown): boolean {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'result' in obj &&
        typeof (obj as Record<string, unknown>).result === 'object' &&
        (obj as Record<string, unknown>).result !== null
    );
}

function isTextContent(obj: unknown): obj is TextContent {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'type' in obj &&
        (obj as Record<string, unknown>).type === 'text' &&
        'text' in obj &&
        typeof (obj as Record<string, unknown>).text === 'string'
    );
}

function parseStringResult(str: string): ParsedToolResult {
    const parsingSteps = ['string-input'];

    // Try to parse as JSON
    let data: Record<string, unknown> | undefined;
    let text = str;
    let contentType: ParsedToolResult['metadata']['contentType'] = 'text';
    let source: ParsedToolResult['metadata']['source'] = 'simple';

    try {
        const parsed = JSON.parse(str);
        if (typeof parsed === 'object' && parsed !== null) {
            parsingSteps.push('json-parsed');
            data = parsed as Record<string, unknown>;
            text = extractTextFromData(data);
            contentType = 'json';
            source = 'json-string';
        }
    } catch {
        // Not JSON, keep as text
        parsingSteps.push('json-parse-failed');
    }

    const isError = detectError(text, data);

    return {
        text,
        data,
        isSubstantial: assessSubstantiality(text, data),
        isError,
        original: str,
        metadata: {
            source,
            contentType,
            textLength: text.length,
            hasStructuredData: !!data,
            parsingSteps,
        },
    };
}

function parseMCPResult(result: MCPToolResult): {
    text: string;
    data?: Record<string, unknown>;
    isError: boolean;
    contentType: ParsedToolResult['metadata']['contentType'];
} {
    let text = '';
    const textParts: string[] = [];

    // Extract text from content array
    for (const content of result.content) {
        if (isTextContent(content)) {
            textParts.push(content.text);
        }
    }

    text = textParts.join('\n');

    // Try to parse text as JSON if it looks like JSON
    let data = result.structuredContent;
    if (!data && text.trim().startsWith('{') && text.trim().endsWith('}')) {
        try {
            const parsed = JSON.parse(text);
            if (typeof parsed === 'object' && parsed !== null) {
                data = parsed as Record<string, unknown>;
            }
        } catch {
            // Not valid JSON, keep as text
        }
    }

    const isError = result.isError || detectError(text, data);
    const contentType: ParsedToolResult['metadata']['contentType'] = data
        ? 'json'
        : text
          ? 'text'
          : 'empty';

    return { text, data, isError, contentType };
}

function parseNestedResult(result: unknown): {
    text: string;
    data?: Record<string, unknown>;
    isError: boolean;
    contentType: ParsedToolResult['metadata']['contentType'];
} {
    // Handle your specific case: result.content.result.content[0].text
    let text = '';
    let data: Record<string, unknown> | undefined;

    try {
        // Navigate the nested structure
        const resultObj = result as Record<string, unknown>;
        const nested =
            resultObj.result ||
            (resultObj.content as Record<string, unknown>)?.result ||
            resultObj;

        if (nested && typeof nested === 'object') {
            // Check for MCP-style content array
            const nestedObj = nested as Record<string, unknown>;
            if (Array.isArray(nestedObj.content)) {
                for (const item of nestedObj.content) {
                    if (isTextContent(item)) {
                        text += item.text + '\n';
                    }
                }
                text = text.trim();
            }

            // Try to extract structured data
            if ('data' in nestedObj) {
                data = nestedObj.data as Record<string, unknown>;
            }

            // If text looks like JSON, try to parse it
            if (text && text.trim().startsWith('{')) {
                try {
                    const parsed = JSON.parse(text);
                    if (typeof parsed === 'object' && parsed !== null) {
                        data = parsed as Record<string, unknown>;
                        // Extract meaningful text from parsed data
                        text = extractTextFromData(data);
                    }
                } catch {
                    // Keep original text
                }
            }
        }
    } catch {
        // Fallback to string conversion
        text = String(result);
    }

    const isError = detectError(text, data);
    const contentType: ParsedToolResult['metadata']['contentType'] = data
        ? 'json'
        : text
          ? 'text'
          : 'empty';

    return { text, data, isError, contentType };
}

function parseSimpleObject(obj: Record<string, unknown>): {
    text: string;
    data?: Record<string, unknown>;
    isError: boolean;
    contentType: ParsedToolResult['metadata']['contentType'];
} {
    let text = '';
    let data: Record<string, unknown> | undefined;

    // Common patterns
    if (obj.content && typeof obj.content === 'string') {
        text = obj.content;
    } else if (obj.text && typeof obj.text === 'string') {
        text = obj.text;
    } else if (obj.message && typeof obj.message === 'string') {
        text = obj.message;
    } else {
        // Extract meaningful text from object
        text = extractTextFromData(obj);
        data = obj;
    }

    const isError = detectError(text, data);
    const contentType: ParsedToolResult['metadata']['contentType'] = data
        ? 'json'
        : text
          ? 'text'
          : 'empty';

    return { text, data, isError, contentType };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 🧠 INTELLIGENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════════

function extractTextFromData(data: Record<string, unknown>): string {
    const parts: string[] = [];

    // Handle JSON-RPC error structure
    if (
        data.jsonrpc === '2.0' &&
        data.error &&
        typeof data.error === 'object'
    ) {
        const error = data.error as Record<string, unknown>;
        if (error.message && typeof error.message === 'string') {
            parts.push(`Error: ${error.message}`);
        }
        if (error.code && typeof error.code === 'number') {
            parts.push(`Code: ${error.code}`);
        }
        return parts.join(' - ');
    }

    // Look for common meaningful fields
    const meaningfulFields = [
        'summary',
        'description',
        'message',
        'text',
        'content',
    ];

    for (const field of meaningfulFields) {
        if (data[field] && typeof data[field] === 'string') {
            parts.push(data[field] as string);
        }
    }

    // Look for arrays with data
    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
        parts.push(`Found ${data.data.length} items`);
    } else if (data.count && typeof data.count === 'number') {
        parts.push(`Count: ${data.count}`);
    }

    // Look for success indicators
    if (data.success === true) {
        parts.push('Operation successful');
    }

    // Fallback to JSON string (completo)
    if (parts.length === 0) {
        const jsonStr = JSON.stringify(data, null, 2);
        parts.push(jsonStr);
    }

    return parts.join('. ');
}

function detectError(text: string, data?: Record<string, unknown>): boolean {
    // Check explicit error flags
    if (data?.isError === true || data?.error || data?.success === false) {
        return true;
    }

    // Check for JSON-RPC error structure
    if (data?.jsonrpc === '2.0' && data?.error) {
        return true;
    }

    // Check text patterns
    const errorPatterns = [
        /error/i,
        /failed/i,
        /exception/i,
        /timeout/i,
        /unauthorized/i,
        /forbidden/i,
        /not found/i,
    ];

    return errorPatterns.some((pattern) => pattern.test(text));
}

function assessSubstantiality(
    text: string,
    data?: Record<string, unknown>,
): boolean {
    // Has structured data with meaningful content
    if (data) {
        // Check for arrays with items
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            return true;
        }

        // Check for meaningful count
        if (data.count && typeof data.count === 'number' && data.count > 0) {
            return true;
        }

        // Check for success with content
        if (data.success === true && Object.keys(data).length > 1) {
            return true;
        }
    }

    // Text length and content quality
    if (text.length < 50) {
        return false; // Too short
    }

    if (text.length > 200) {
        return true; // Long enough to be substantial
    }

    // Medium length - check content quality
    const meaningfulWords = text.split(/\s+/).filter((word) => word.length > 3);
    return meaningfulWords.length > 10;
}

function createEmptyResult(
    original: unknown,
    parsingSteps: string[],
): ParsedToolResult {
    return {
        text: 'No result',
        data: undefined,
        isSubstantial: false,
        isError: false,
        original,
        metadata: {
            source: 'unknown',
            contentType: 'empty',
            textLength: 0,
            hasStructuredData: false,
            parsingSteps,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 🎯 CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Quick check if a tool result contains substantial data
 */
export function isSubstantialResult(result: unknown): boolean {
    return parseToolResult(result).isSubstantial;
}

/**
 * Quick extraction of text content from any tool result
 */
export function extractTextContent(result: unknown): string {
    return parseToolResult(result).text;
}

/**
 * Quick check if result indicates an error
 */
export function isErrorResult(result: unknown): boolean {
    return parseToolResult(result).isError;
}
