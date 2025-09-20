import { Injectable } from '@nestjs/common';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { estimateTokenCount } from '@/shared/utils/langchainCommon/document';
import { encoding_for_model, TiktokenModel } from 'tiktoken';
import { LLMModelProvider, MODEL_STRATEGIES } from '@kodus/kodus-common/llm';

export interface TokenChunkingOptions {
    model?: LLMModelProvider | string;
    data: any[];
    usagePercentage?: number;
    defaultMaxTokens?: number;
}

export interface TokenChunkingResult {
    chunks: any[][];
    totalItems: number;
    totalChunks: number;
    tokensPerChunk: number[];
    tokenLimit: number;
    modelUsed: string;
}

@Injectable()
export class TokenChunkingService {
    constructor(private readonly logger: PinoLoggerService) {}

    /**
     * Divide os dados em chunks baseado no limite de tokens do modelo LLM
     *
     * @param options Configurações para o chunking
     * @returns Resultado com os chunks divididos e metadados
     */
    public chunkDataByTokens(
        options: TokenChunkingOptions,
    ): TokenChunkingResult {
        const {
            model,
            data,
            usagePercentage = 60,
            defaultMaxTokens = 64000,
        } = options;

        // Validações de entrada
        if (!data || !Array.isArray(data)) {
            this.logger.error({
                message:
                    'Invalid data provided for token chunking - not an array',
                context: TokenChunkingService.name,
                metadata: {
                    dataType: typeof data,
                    model: model || 'default',
                },
            });

            return {
                chunks: [],
                totalItems: 0,
                totalChunks: 0,
                tokensPerChunk: [],
                tokenLimit: 0,
                modelUsed: model || 'default',
            };
        }

        if (data.length === 0) {
            this.logger.warn({
                message: 'Empty data array provided for token chunking',
                context: TokenChunkingService.name,
                metadata: { model: model || 'default' },
            });

            return {
                chunks: [],
                totalItems: 0,
                totalChunks: 0,
                tokensPerChunk: [],
                tokenLimit: 0,
                modelUsed: model || 'default',
            };
        }

        try {
            // 1. Determinar limite de tokens
            const maxTokens = this.getMaxTokensForModel(
                model,
                defaultMaxTokens,
            );
            const tokenLimit = Math.floor(maxTokens * (usagePercentage / 100));

            this.logger.log({
                message: 'Starting token chunking process',
                context: TokenChunkingService.name,
                metadata: {
                    model: model || 'default',
                    maxTokens,
                    usagePercentage,
                    tokenLimit,
                    totalItems: data.length,
                },
            });

            // 2. Dividir dados em chunks
            const chunks: any[][] = [];
            const tokensPerChunk: number[] = [];

            let currentChunk: any[] = [];
            let currentChunkTokens = 0;

            for (let i = 0; i < data.length; i++) {
                const item = data[i];

                // Validar item
                if (item === null || item === undefined) {
                    this.logger.warn({
                        message: 'Null or undefined item found, skipping',
                        context: TokenChunkingService.name,
                        metadata: { itemIndex: i, model: model || 'default' },
                    });
                    continue;
                }

                const itemTokens = this.countTokensForItem(item, model);

                // Edge case: item único excede o limite
                if (itemTokens > tokenLimit) {
                    this.logger.warn({
                        message: 'Single item exceeds token limit',
                        context: TokenChunkingService.name,
                        metadata: {
                            itemIndex: i,
                            itemTokens,
                            tokenLimit,
                            item:
                                typeof item === 'string'
                                    ? item.substring(0, 100) + '...'
                                    : 'complex object',
                        },
                    });

                    // Se chunk atual não está vazio, finaliza ele
                    if (currentChunk.length > 0) {
                        chunks.push([...currentChunk]);
                        tokensPerChunk.push(currentChunkTokens);
                        currentChunk = [];
                        currentChunkTokens = 0;
                    }

                    // Adiciona item como chunk único
                    chunks.push([item]);
                    tokensPerChunk.push(itemTokens);
                    continue;
                }

                // Verifica se adicionar o item excederia o limite
                if (
                    currentChunkTokens + itemTokens > tokenLimit &&
                    currentChunk.length > 0
                ) {
                    // Finaliza chunk atual
                    chunks.push([...currentChunk]);
                    tokensPerChunk.push(currentChunkTokens);

                    // Inicia novo chunk
                    currentChunk = [item];
                    currentChunkTokens = itemTokens;
                } else {
                    // Adiciona item ao chunk atual
                    currentChunk.push(item);
                    currentChunkTokens += itemTokens;
                }
            }

            // Adiciona último chunk se não estiver vazio
            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
                tokensPerChunk.push(currentChunkTokens);
            }

            const result: TokenChunkingResult = {
                chunks,
                totalItems: data.length,
                totalChunks: chunks.length,
                tokensPerChunk,
                tokenLimit,
                modelUsed: model || 'default',
            };

            this.logger.log({
                message: 'Token chunking completed successfully',
                context: TokenChunkingService.name,
                metadata: {
                    totalItems: result.totalItems,
                    totalChunks: result.totalChunks,
                    tokenLimit: result.tokenLimit,
                    modelUsed: result.modelUsed,
                },
            });

            return result;
        } catch (error) {
            this.logger.error({
                message: 'Error during token chunking process',
                error,
                context: TokenChunkingService.name,
                metadata: {
                    model,
                    dataLength: data?.length || 0,
                    usagePercentage,
                    defaultMaxTokens,
                },
            });

            // Retornar resultado vazio em caso de erro
            return {
                chunks: [],
                totalItems: data?.length || 0,
                totalChunks: 0,
                tokensPerChunk: [],
                tokenLimit: 0,
                modelUsed: model || 'default',
            };
        }
    }

    /**
     * Obtém o limite máximo de tokens para um modelo
     */
    private getMaxTokensForModel(
        model?: LLMModelProvider | string,
        inputMaxTokens: number = 64000,
    ): number {
        if (!model) {
            return inputMaxTokens;
        }

        const strategy = MODEL_STRATEGIES[model as LLMModelProvider];
        if (!strategy) {
            return inputMaxTokens;
        }

        // Se defaultMaxTokens é -1, significa sem limite específico, usa o padrão
        if (strategy.inputMaxTokens === -1) {
            return inputMaxTokens;
        }

        return strategy.inputMaxTokens;
    }

    /**
     * Conta tokens para um item específico
     */
    private countTokensForItem(
        item: any,
        model?: LLMModelProvider | string,
    ): number {
        try {
            // Converte item para string para contagem
            const text = this.serializeItem(item);

            // Para modelos OpenAI, tenta usar tiktoken para contagem precisa
            if (model && this.isOpenAIModel(model)) {
                try {
                    const encoder = encoding_for_model(
                        this.getOpenAIModelName(model) as TiktokenModel,
                    );
                    return encoder.encode(text).length;
                } catch (error) {
                    // Se falhar, usa estimativa
                    return estimateTokenCount(text);
                }
            }

            // Para outros modelos, usa estimativa
            return estimateTokenCount(text);
        } catch (error) {
            this.logger.warn({
                message:
                    'Error counting tokens for item, using fallback estimation',
                error,
                context: TokenChunkingService.name,
                metadata: {
                    itemType: typeof item,
                    model,
                },
            });

            // Fallback: estimativa básica baseada no tamanho da string
            const text = this.serializeItem(item);
            return Math.ceil(text.length / 4); // Aproximadamente 4 chars por token
        }
    }

    /**
     * Serializa um item para string de forma consistente
     */
    private serializeItem(item: any): string {
        if (typeof item === 'string') {
            return item;
        }

        if (typeof item === 'object' && item !== null) {
            try {
                // Tenta serialização normal primeiro
                return JSON.stringify(item);
            } catch (error) {
                // Se falhar (ex: referências circulares), usa serialização segura
                try {
                    return JSON.stringify(item, this.getCircularReplacer());
                } catch (fallbackError) {
                    this.logger.warn({
                        message:
                            'Failed to serialize object, using fallback string conversion',
                        context: TokenChunkingService.name,
                        metadata: {
                            itemType: typeof item,
                            error: fallbackError.message,
                        },
                    });
                    // Último fallback: toString seguro
                    return String(item);
                }
            }
        }

        return String(item);
    }

    /**
     * Replacer function para lidar com referências circulares
     */
    private getCircularReplacer() {
        const seen = new WeakSet();
        return (key: string, value: any) => {
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            return value;
        };
    }

    /**
     * Verifica se é um modelo OpenAI
     */
    private isOpenAIModel(model: LLMModelProvider | string): boolean {
        const openaiModels = [
            LLMModelProvider.OPENAI_GPT_4O,
            LLMModelProvider.OPENAI_GPT_4O_MINI,
            LLMModelProvider.OPENAI_GPT_4_1,
            LLMModelProvider.OPENAI_GPT_O4_MINI,
        ];

        return openaiModels.includes(model as LLMModelProvider);
    }

    /**
     * Obtém o nome do modelo OpenAI para tiktoken
     */
    private getOpenAIModelName(model: LLMModelProvider | string): string {
        const strategy = MODEL_STRATEGIES[model as LLMModelProvider];
        return strategy?.modelName || 'gpt-4o';
    }
}
