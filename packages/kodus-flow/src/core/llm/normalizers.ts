export function normalizeLLMContent(content: unknown): string {
    if (typeof content === 'string') return content;

    // Handle typical LangChain-like response objects
    if (content && typeof content === 'object') {
        const c: any = content as any;
        // Direct content property
        if (typeof c.content === 'string') return c.content;

        // Array of blocks with { type, text }
        if (Array.isArray(c.content)) {
            return c.content
                .filter(
                    (b: unknown): b is { type: string; text?: string } =>
                        !!b && typeof b === 'object' && 'type' in (b as any),
                )
                .map((b) =>
                    (b as any).type === 'text'
                        ? String((b as any).text ?? '')
                        : '',
                )
                .join('');
        }
    }

    // Some providers might put blocks at the top-level
    if (Array.isArray(content)) {
        return (content as any[])
            .filter(
                (b: unknown): b is { type: string; text?: string } =>
                    !!b && typeof b === 'object' && 'type' in (b as any),
            )
            .map((b) =>
                (b as any).type === 'text' ? String((b as any).text ?? '') : '',
            )
            .join('');
    }

    // Fallback
    return '';
}

export type HumanAiMessage = {
    type: 'system' | 'human' | 'ai';
    content: string;
    name?: string;
};

// Normalize generic chat messages (role-based) to providers that expect
// 'system' | 'human' | 'ai' in a 'type' field.
export function toHumanAiMessages(
    messages: Array<{ role?: string; content: string; name?: string }>,
): HumanAiMessage[] {
    return messages.map((m) => {
        const role = (m.role || '').toLowerCase();
        let type: HumanAiMessage['type'];
        if (role === 'system') type = 'system';
        else if (role === 'user' || role === 'human') type = 'human';
        else type = 'ai';
        return { type, content: m.content, name: m.name };
    });
}
