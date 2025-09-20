import * as JSON5 from 'json5';

/**
 * Advanced JSON Parser with robust error handling and cleaning
 * Based on enterprise-grade parsing patterns
 */

const transformToValidJSON = (input: string): string => {
    // Replaces unescaped single quotes with double quotes
    return input.replace(/(?<!\\)'/g, '"');
};

function tryParseJSONObject<T>(payload: string): T | null {
    try {
        const cleanedPayload = payload
            .replace(/\\\\n/g, '\\n') // Transform '\\\\n' into '\n'
            .replace(/\\'/g, "'") // Fix escaped single quotes
            .replace(/(\r\n|\n|\r)/gm, '') // Remove newlines outside of strings
            .replace(/\\\\"/g, '\\"');

        const parsedData = tryParseJSONObjectWithFallback<T>(cleanedPayload);

        if (
            parsedData &&
            (typeof parsedData === 'object' || Array.isArray(parsedData))
        ) {
            return parsedData;
        }

        return null;
    } catch {
        // Error handling the return object from the LLM
        return null;
    }
}

function tryParseJSONObjectWithFallback<T>(payload: string): T | null {
    try {
        if (payload.length <= 0) {
            return null;
        }

        return JSON5.parse(payload);
    } catch {
        try {
            return JSON.parse(payload) as T;
        } catch {
            try {
                const noCodeBlocks = stripCodeBlocks(payload);
                const cleanedPayload = noCodeBlocks
                    .replace(/\\n/g, '') // Remove newline characters
                    .replace(/\\/g, '') // Remove backslashes (escape characters)
                    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments (/* comment */)
                    .replace(/<[^>]*>/g, '') // Remove HTML tags (e.g., <tag>)
                    .replace(/^`+|`+$/g, '') // Remove backticks at the beginning and end
                    .trim();

                return JSON.parse(cleanedPayload) as T;
            } catch {
                return null;
            }
        }
    }
}

function stripCodeBlocks(text: string): string {
    // Remove quotes at the beginning and end if they exist
    const cleanText = text.replace(/^['"]|['"]$/g, '');

    // Extract the content between ```json and ```
    const match = cleanText.match(/```json({[\s\S]*?})```/);
    if (match && match[1]) {
        return match[1];
    }

    return cleanText;
}

/**
 * Enhanced JSON Parser with multiple fallback strategies
 */
export class EnhancedJSONParser {
    /**
     * Parse JSON using the proven working approach
     */
    static parse<T = unknown>(text: string): T | null {
        if (!text) {
            throw new Error('Input text is empty or undefined');
        }

        // Use the exact same approach as the working code
        let cleanResponse = text;

        if (text.startsWith('```')) {
            cleanResponse = text
                .replace(/^```json\n/, '')
                .replace(/\n```(\n)?$/, '')
                .trim();
        }

        const parsedResponse = tryParseJSONObject(cleanResponse);

        if (parsedResponse) {
            return parsedResponse as T;
        }

        // If parsing fails, return null (don't throw error)
        return null;
    }

    /**
     * Parse with validation and detailed error reporting
     */
    static parseWithValidation<T>(
        text: string,
        schema?: (data: unknown) => data is T,
    ): { success: true; data: T } | { success: false; error: string } {
        try {
            const parsed = this.parse<T>(text);

            if (parsed === null) {
                return {
                    success: false,
                    error: 'Failed to parse JSON from input text',
                };
            }

            if (schema && !schema(parsed)) {
                return {
                    success: false,
                    error: 'Parsed data does not match expected schema',
                };
            }

            return {
                success: true,
                data: parsed,
            };
        } catch (error) {
            return {
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'Unknown parsing error',
            };
        }
    }

    /**
     * Extract JSON from mixed content (text + JSON)
     */
    static extractJSON(text: string): string | null {
        if (!text) return null;

        // Try to find JSON object/array patterns
        const jsonPattern = /(\{[\s\S]*\}|\[[\s\S]*\])/g;
        const matches = text.match(jsonPattern);

        if (matches) {
            // Return the longest match (likely the main JSON)
            return matches.reduce((longest, current) =>
                current.length > longest.length ? current : longest,
            );
        }

        // Try to extract from code blocks
        const codeBlockPattern = /```json\n?([\s\S]*?)\n?```/g;
        const codeBlockMatch = codeBlockPattern.exec(text);
        if (codeBlockMatch && codeBlockMatch[1]) {
            return codeBlockMatch[1];
        }

        return null;
    }

    /**
     * Extract JSON from LangChain structured response format
     */
    static extractFromLangChainResponse(text: string): unknown | null {
        try {
            // Parse the LangChain response structure
            const langChainResponse = JSON.parse(text);

            // Check if it's a LangChain message format
            if (
                langChainResponse &&
                langChainResponse.kwargs &&
                langChainResponse.kwargs.content
            ) {
                const content = langChainResponse.kwargs.content;

                // Handle different content formats
                if (Array.isArray(content)) {
                    // Find text content with JSON
                    for (const item of content) {
                        if (item.type === 'text' && item.text) {
                            // Extract JSON from text content
                            const jsonMatch = item.text.match(
                                /```json\n?([\s\S]*?)\n?```/,
                            );
                            if (jsonMatch && jsonMatch[1]) {
                                return JSON5.parse(jsonMatch[1]);
                            }

                            // Try direct JSON parsing if no code blocks
                            try {
                                return JSON5.parse(item.text);
                            } catch {
                                // Continue to next item
                            }
                        }
                    }
                } else if (typeof content === 'string') {
                    // Handle string content
                    const jsonMatch = content.match(
                        /```json\n?([\s\S]*?)\n?```/,
                    );
                    if (jsonMatch && jsonMatch[1]) {
                        return JSON5.parse(jsonMatch[1]);
                    }

                    // Try direct parsing
                    try {
                        return JSON5.parse(content);
                    } catch {
                        // Continue
                    }
                }
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * Clean and normalize JSON string
     */
    static cleanJSONString(text: string): string {
        return text
            .replace(/^```json\n?/, '') // Remove opening code block
            .replace(/\n?```$/, '') // Remove closing code block
            .replace(/^`+|`+$/g, '') // Remove surrounding backticks
            .replace(/(\r\n|\n|\r)/gm, '') // Remove newlines
            .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .trim();
    }
}

export { transformToValidJSON, tryParseJSONObject, stripCodeBlocks };
