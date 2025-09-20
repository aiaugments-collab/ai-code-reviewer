import { Injectable } from '@nestjs/common';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { v4 as uuidv4 } from 'uuid';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';

//#region Interfaces
export interface TokenUsage {
    input_tokens?: number;
    output_tokens?: number;
    output_reasoning_tokens?: number;
    total_tokens?: number;
    model?: string;
    runId?: string;
    parentRunId?: string;
}
//#endregion

//#region Token Tracking Handler
class TokenTrackingCallbackHandler extends BaseCallbackHandler {
    name = 'TokenTrackingCallbackHandler';

    constructor(
        private readonly sessionId: string,
        private readonly tokenTrackingService: TokenTrackingService
    ) {
        super();
    }

    private extractUsageMetadata(output: any): TokenUsage {
        try {
            // Attempts to extract information from different locations in the response
            const usage: TokenUsage = {};

            // Extracts token information
            if (output?.llmOutput?.tokenUsage) {
                Object.assign(usage, output.llmOutput.tokenUsage);
            } else if (output?.llmOutput?.usage) {
                Object.assign(usage, output.llmOutput.usage);
            } else if (output?.generations?.[0]?.[0]?.message?.usage_metadata) {
                const metadata =
                    output.generations[0][0].message.usage_metadata;
                usage.input_tokens = metadata.input_tokens;
                usage.output_tokens = metadata.output_tokens;
                usage.total_tokens = metadata.total_tokens;
                usage.output_reasoning_tokens = metadata.output_token_details.reasoning;
            }

            // Extracts model
            usage.model =
                output?.llmOutput?.model ||
                output?.generations?.[0]?.[0]?.message?.response_metadata
                    ?.model ||
                'unknown';

            return usage;
        } catch (error) {
            console.error('Error extracting usage metadata:', error);
            return {};
        }
    }

    async handleLLMEnd(
        output: any,
        runId: string,
        parentRunId?: string,
        tags?: string[],
    ) {
        const usage = this.extractUsageMetadata(output);

        if (Object.keys(usage).length > 0) {
            await this.tokenTrackingService.addTokenUsage(this.sessionId, {
                ...usage,
                runId,
                parentRunId,
            });
        }
    }
}
//#endregion

//#region Token Tracking Session
export class TokenTrackingSession {
    constructor(
        private readonly sessionId: string,
        private readonly tokenTrackingService: TokenTrackingService
    ) {}

    getId(): string {
        return this.sessionId;
    }

    createCallbackHandler(): TokenTrackingCallbackHandler {
        return this.tokenTrackingService.createCallbackHandler(this.sessionId);
    }

    getUsages(): TokenUsage[] {
        return this.tokenTrackingService.getSessionUsages(this.sessionId);
    }

    reset(): void {
        this.tokenTrackingService.clearSession(this.sessionId);
    }

    clear(): void {
        this.tokenTrackingService.clearSession(this.sessionId);
    }
}
//#endregion

//#region Token Tracking Service
@Injectable()
export class TokenTrackingService {
    private readonly logger: PinoLoggerService;
    private readonly activeSessions = new Map<string, TokenUsage[]>();

    /**
     * Cria uma nova sessão de tracking para uma operação específica
     */
    createSession(sessionId: string = uuidv4()): TokenTrackingSession {
        this.activeSessions.set(sessionId, []);
        return new TokenTrackingSession(sessionId, this);
    }

    /**
     * Adiciona uso de tokens a uma sessão específica (thread-safe)
     */
    async addTokenUsage(sessionId: string, usage: TokenUsage): Promise<void> {
        try {
            const session = this.activeSessions.get(sessionId);
            if (session) {
                // Criar uma cópia do usage para evitar mutação externa
                const safeCopy = { ...usage };
                session.push(safeCopy);
            } else {
                // Se a sessão não existir, logar warning mas não quebrar
                this.logger?.warn({
                    message: 'Attempted to add token usage to non-existent session',
                    context: TokenTrackingService.name,
                    metadata: {
                        sessionId,
                        usage,
                    },
                });
            }
        } catch (error) {
            // Nunca deixar que erros de tracking quebrem o fluxo principal
            this.logger?.error({
                message: 'Error adding token usage to session',
                context: TokenTrackingService.name,
                error,
                metadata: {
                    sessionId,
                    usage,
                },
            });
        }
    }

    /**
     * Obtém todos os usos de uma sessão
     */
    getSessionUsages(sessionId: string): TokenUsage[] {
        try {
            const session = this.activeSessions.get(sessionId);
            // Retornar uma cópia para evitar mutação externa
            return session ? [...session] : [];
        } catch (error) {
            this.logger?.error({
                message: 'Error getting session usages',
                context: TokenTrackingService.name,
                error,
                metadata: { sessionId },
            });
            return [];
        }
    }

    /**
     * Agrega dados de múltiplas sessões (para batches paralelos)
     */
    aggregateSessionsUsage(sessionIds: string[]): TokenUsage[] {
        const allUsages: TokenUsage[] = [];

        try {
            sessionIds.forEach(sessionId => {
                try {
                    const sessionUsages = this.getSessionUsages(sessionId);
                    allUsages.push(...sessionUsages);
                } catch (error) {
                    this.logger?.warn({
                        message: 'Error aggregating usage for session, skipping',
                        context: TokenTrackingService.name,
                        error,
                        metadata: { sessionId },
                    });
                    // Continua com outras sessões
                }
            });
        } catch (error) {
            this.logger?.error({
                message: 'Error aggregating sessions usage',
                context: TokenTrackingService.name,
                error,
                metadata: { sessionIds },
            });
        }

        return allUsages;
    }

    /**
     * Limpa uma sessão da memória
     */
    clearSession(sessionId: string): void {
        try {
            this.activeSessions.delete(sessionId);
        } catch (error) {
            this.logger?.error({
                message: 'Error clearing session',
                context: TokenTrackingService.name,
                error,
                metadata: { sessionId },
            });
        }
    }

    /**
     * Cria um callback handler para uma sessão específica
     */
    createCallbackHandler(sessionId: string): TokenTrackingCallbackHandler {
        return new TokenTrackingCallbackHandler(sessionId, this);
    }

    /**
     * Cria um handler compatível com a interface antiga (para migração gradual)
     */
    createLegacyHandler(): LegacyTokenTrackingHandler {
        const session = this.createSession();
        return new LegacyTokenTrackingHandler(session);
    }
}
//#endregion

//#region Legacy Compatibility Handler
/**
 * Handler compatível com a interface antiga para facilitar migração
 */
export class LegacyTokenTrackingHandler extends BaseCallbackHandler {
    name = 'TokenTrackingHandler';

    private readonly callbackHandler: TokenTrackingCallbackHandler;

    constructor(private readonly session: TokenTrackingSession) {
        super();
        this.callbackHandler = session.createCallbackHandler();
    }

    async handleLLMEnd(
        output: any,
        runId: string,
        parentRunId?: string,
        tags?: string[],
    ) {
        await this.callbackHandler.handleLLMEnd(output, runId, parentRunId, tags);
    }

    getTokenUsages(): TokenUsage[] {
        return this.session.getUsages();
    }

    reset(): void {
        this.session.reset();
    }
}
//#endregion

export const TOKEN_TRACKING_SERVICE_TOKEN = Symbol('TokenTrackingService');
