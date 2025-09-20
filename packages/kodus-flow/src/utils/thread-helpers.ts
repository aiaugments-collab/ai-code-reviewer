import { Thread } from '../core/types/allTypes.js';

const simpleHash = (str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
};

/**
 * Função pura para ordenar identificadores
 */
const sortIdentifiers = (
    identifiers: Record<string, string | number>,
): string =>
    Object.entries(identifiers)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}-${value}`)
        .join('-');

/**
 * Função pura para validar prefix (máximo 3 caracteres)
 */
const validatePrefix = (prefix?: string): string => {
    if (!prefix) {
        return '';
    }
    if (prefix.length > 3) {
        throw new Error(
            `Prefix "${prefix}" excede 3 caracteres. Máximo permitido: 3 caracteres.`,
        );
    }
    return prefix;
};

/**
 * Função pura para validar identificadores
 */
const validateIdentifiers = (
    identifiers: Record<string, string | number>,
): void => {
    // ✅ MÍNIMO 1 IDENTIFICADOR
    const count = Object.keys(identifiers).length;
    if (count === 0) {
        throw new Error('Pelo menos 1 identificador é obrigatório.');
    }

    // ✅ MÁXIMO 5 IDENTIFICADORES
    if (count > 5) {
        throw new Error(
            `Máximo 5 identificadores permitidos. Fornecidos: ${count}`,
        );
    }

    // ✅ SEM VALORES VAZIOS
    for (const [key, value] of Object.entries(identifiers)) {
        if (value === null || value === undefined || value === '') {
            throw new Error(
                `Identificador "${key}" não pode ser vazio, null ou undefined.`,
            );
        }
    }
};

/**
 * Função pura para gerar thread ID com TR- padrão
 */
const generateThreadId = (
    identifiers: Record<string, string | number>,
    prefix?: string,
): string => {
    // ✅ VALIDAR IDENTIFICADORES
    validateIdentifiers(identifiers);

    // ✅ VALIDAR PREFIX
    const validPrefix = validatePrefix(prefix);

    const sortedString = sortIdentifiers(identifiers);
    const hash = simpleHash(sortedString);

    // ✅ FORMATO: TR-[prefix-]hash (sempre ≤ 32 caracteres)
    const baseThreadId = validPrefix
        ? `TR-${validPrefix}-${hash}`
        : `TR-${hash}`;

    // ✅ LIMITE FIXO DE 32 CARACTERES
    if (baseThreadId.length <= 32) {
        return baseThreadId;
    }

    // ✅ TRUNCAR HASH se necessário
    const prefixPart = validPrefix ? `TR-${validPrefix}-` : 'TR-';
    const availableSpace = 32 - prefixPart.length;

    if (availableSpace <= 0) {
        return validPrefix ? `TR-${validPrefix}` : 'TR';
    }

    return `${prefixPart}${hash.substring(0, availableSpace)}`;
};

/**
 * Função pura para criar metadata
 */
const createMetadata = (
    identifiers: Record<string, string | number>,
    description: string,
    type: string,
): Record<string, string | number | undefined> => ({
    description,
    type,
    ...identifiers,
});

/**
 * Função pura para criar thread
 */
const createThread = (
    id: string,
    metadata: Record<string, string | number | undefined>,
): Thread => ({
    id, // Usando string diretamente
    metadata,
});

// ===== MÉTODO PRINCIPAL =====

/**
 * Método principal para criar thread ID
 * Formato: TR-[prefix-]hash (sempre ≤ 32 caracteres)
 *
 * @param identifiers - Identificadores para gerar o thread (1-5 identificadores)
 * @param options - Opções de configuração
 * @returns Thread com ID único e determinístico
 * @throws Error se validações falharem
 */
export const createThreadId = (
    identifiers: Record<string, string | number>,
    options: {
        prefix?: string; // Máximo 3 caracteres
        description?: string;
        type?: string;
    } = {},
): Thread => {
    const { prefix, description, type = 'thread' } = options;

    const threadId = generateThreadId(identifiers, prefix);
    const metadata = createMetadata(
        identifiers,
        description || `Thread ${threadId}`,
        type,
    );

    return createThread(threadId, metadata);
};
