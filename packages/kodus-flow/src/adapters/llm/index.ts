import { LLMAdapter, LLMConfig } from '../../core/types/allTypes.js';

export function createLLMAdapter(_config: LLMConfig): LLMAdapter {
    throw new Error(
        'LLM Adapter não implementado no SDK. O provider de LLM deve ser fornecido externamente pelo projeto principal.',
    );
}

export function createDefaultLLMAdapter(): LLMAdapter | null {
    return null;
}

export { createMockLLMProvider } from './mock-provider.js';
