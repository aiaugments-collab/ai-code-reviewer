import { Injectable } from '@nestjs/common';
import {
    createDirectLLMAdapter,
    createMCPAdapter,
    createOrchestration,
    Thread,
    MCPServerConfig,
    PlannerType,
    StorageEnum,
    getExecutionTraceability,
    LLMAdapter,
    toHumanAiMessages,
} from '@kodus/flow';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { MCPManagerService } from '../../../mcp/services/mcp-manager.service';
import { ConfigService } from '@nestjs/config';
import { DatabaseConnection } from '@/config/types';
import { ConnectionString } from 'connection-string';
import { LLMProviderService, LLMModelProvider } from '@kodus/kodus-common/llm';
import { SDKOrchestrator } from '@kodus/flow/dist/orchestration';
import { PinoLoggerService } from '../../logger/pino.service';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import {
    PARAMETERS_SERVICE_TOKEN,
    IParametersService,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { Inject } from '@nestjs/common';

@Injectable()
export class ConversationAgentProvider {
    protected config: DatabaseConnection;
    private orchestration: SDKOrchestrator;
    private mcpAdapter: ReturnType<typeof createMCPAdapter>;
    private llmAdapter: LLMAdapter;
    private readonly defaultLLMConfig = {
        llmProvider: LLMModelProvider.GEMINI_2_5_PRO,
        temperature: 0,
        maxTokens: 20000,
        maxReasoningTokens: 800,
        stop: undefined as string[] | undefined,
    };

    constructor(
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,
        private readonly configService: ConfigService,
        private readonly llmProviderService: LLMProviderService,
        private readonly logger: PinoLoggerService,
        private readonly mcpManagerService?: MCPManagerService,
    ) {
        this.config =
            this.configService.get<DatabaseConnection>('mongoDatabase');
    }

    private createLLMAdapter() {
        const self = this;
        const wrappedLLM = {
            name: 'agent-configurable-llm',
            async call(messages: any[], options: any = {}) {
                const lcMessages = toHumanAiMessages(messages);

                const resolveProvider = (model?: string): LLMModelProvider => {
                    return (
                        (model && (model as any)) ||
                        self.defaultLLMConfig.llmProvider
                    );
                };

                const provider = resolveProvider(options?.model);

                const client = self.llmProviderService.getLLMProvider({
                    model: provider ?? self.defaultLLMConfig.llmProvider,
                    temperature:
                        options?.temperature ??
                        self.defaultLLMConfig.temperature,
                    maxTokens:
                        options?.maxTokens ?? self.defaultLLMConfig.maxTokens,
                    maxReasoningTokens:
                        options?.maxReasoningTokens ??
                        self.defaultLLMConfig.maxReasoningTokens,
                });

                return await client.invoke(lcMessages, {
                    stop: options?.stop ?? self.defaultLLMConfig.stop,
                    temperature:
                        options?.temperature ??
                        self.defaultLLMConfig.temperature,
                    maxReasoningTokens:
                        options?.maxReasoningTokens ??
                        self.defaultLLMConfig.maxReasoningTokens,
                });
            },
        };

        return createDirectLLMAdapter(wrappedLLM);
    }

    private async createMCPAdapter(
        organizationAndTeamData: OrganizationAndTeamData,
    ) {
        const mcpManagerServers = await this.mcpManagerService.getConnections(
            organizationAndTeamData,
        );

        const defaultServers: MCPServerConfig[] = [
            {
                name: 'kodus-mcp-server',
                type: 'http' as const,
                url: process.env.API_KODUS_MCP_SERVER_URL,
                timeout: 10_000,
                retries: 1,
                headers: { contentType: 'application/json' },
                allowedTools: [],
            },
        ];

        const servers = [...defaultServers, ...mcpManagerServers];

        this.mcpAdapter = createMCPAdapter({
            servers,
            defaultTimeout: 10_000,
            maxRetries: 1,
            onError: (err) => {
                console.error('MCP error:', err.message);
            },
        });
    }

    private async createOrchestration() {
        let uri = new ConnectionString('', {
            user: this.config.username,
            password: this.config.password,
            protocol: this.config.port ? 'mongodb' : 'mongodb+srv',
            hosts: [{ name: this.config.host, port: this.config.port }],
        }).toString();

        this.llmAdapter = this.createLLMAdapter();

        this.orchestration = await createOrchestration({
            tenantId: 'kodus-agent-conversation',
            llmAdapter: this.llmAdapter,
            mcpAdapter: this.mcpAdapter,
            observability: {
                logging: { enabled: true, level: 'info' },
                mongodb: {
                    type: 'mongodb',
                    connectionString: uri,
                    database: this.config.database,
                    collections: {
                        logs: 'observability_logs',
                        telemetry: 'observability_telemetry',
                        errors: 'observability_errors',
                    },
                    batchSize: 100,
                    flushIntervalMs: 5000,
                    ttlDays: 30,
                    enableObservability: true,
                },
                telemetry: {
                    enabled: true,
                    serviceName: 'kodus-flow',
                    sampling: { rate: 1, strategy: 'probabilistic' },
                    privacy: { includeSensitiveData: false },
                    spanTimeouts: {
                        enabled: true,
                        maxDurationMs: 5 * 60 * 1000,
                    },
                },
            },
            storage: {
                type: StorageEnum.MONGODB,
                connectionString: uri,
                database: this.config.database,
            },
        });
    }

    private async initialize(
        organizationAndTeamData: OrganizationAndTeamData,
        userLanguage: string,
    ) {
        await this.createMCPAdapter(organizationAndTeamData);
        await this.createOrchestration();

        try {
            await this.orchestration.connectMCP();
            await this.orchestration.registerMCPTools();
        } catch (error) {
            this.logger.warn({
                message: 'MCP offline, prosseguindo.',
                context: ConversationAgentProvider.name,
                error,
            });
        }

        await this.orchestration.createAgent({
            name: 'kodus-conversational-agent',
            identity: {
                description:
                    'Agente de conversação inteligente para interações com usuários.',
                goal: 'Engage in natural, helpful conversations while respecting user language preferences',
                language: userLanguage,
                languageInstructions: `LANGUAGE REQUIREMENTS:
- Respond in the user's preferred language: ${userLanguage}
- Default to English if no language preference is configured
- Maintain consistent language throughout conversation
- Use appropriate terminology and formatting for the selected language
- Adapt communication style to the target language conventions`,
            },
            plannerOptions: {
                type: PlannerType.REACT,
                replanPolicy: {
                    toolUnavailable: 'replan',
                    maxReplans: 3,
                },
            },
        });
    }

    // -------------------------------------------------------------------------
    async execute(
        prompt: string,
        context?: {
            organizationAndTeamData: OrganizationAndTeamData;
            prepareContext?: any;
            thread?: Thread;
        },
    ) {
        const { organizationAndTeamData, prepareContext, thread } =
            context || ({} as any);
        try {
            const userLanguage = await this.getLanguage(
                organizationAndTeamData,
            );

            this.logger.log({
                message: 'Starting conversation agent execution',
                context: ConversationAgentProvider.name,
                serviceName: ConversationAgentProvider.name,
                metadata: { organizationAndTeamData, thread, userLanguage },
            });

            if (!organizationAndTeamData) {
                throw new Error('Organization and team data is required ok.');
            }

            if (!thread) {
                throw new Error('thread and team data is required.');
            }

            await this.initialize(organizationAndTeamData, userLanguage);

            const result = await this.orchestration.callAgent(
                'kodus-conversational-agent',
                prompt,
                {
                    thread: thread,
                    userContext: {
                        organizationAndTeamData: organizationAndTeamData,
                        additional_information: prepareContext,
                    },
                },
            );

            let uri = new ConnectionString('', {
                user: this.config.username,
                password: this.config.password,
                protocol: this.config.port ? 'mongodb' : 'mongodb+srv',
                hosts: [{ name: this.config.host, port: this.config.port }],
            }).toString();

            const corr = (result?.context?.correlationId as string) ?? '';

            const traceability = await getExecutionTraceability(
                uri,
                corr,
                'kodus_db',
            );

            console.log(
                'Conversation Agent Traceability:',
                JSON.stringify(traceability, null, 2),
            );

            this.logger.log({
                message: 'Finish conversation agent execution',
                context: ConversationAgentProvider.name,
                serviceName: ConversationAgentProvider.name,
                metadata: {
                    organizationAndTeamData,
                    thread,
                    result: {
                        correlationId: result.context.correlationId ?? null,
                        threadId: result.context.threadId ?? null,
                        sessionId: result.context.sessionId ?? null,
                    },
                },
            });

            return typeof result.result === 'string'
                ? result.result
                : JSON.stringify(result.result);
        } catch (error) {
            this.logger.error({
                message: 'Error during conversation agent execution',
                context: ConversationAgentProvider.name,
                serviceName: ConversationAgentProvider.name,
                metadata: { error, organizationAndTeamData, thread },
            });
            throw error;
        }
    }

    private async getLanguage(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<string> {
        let language = null;

        if (organizationAndTeamData && organizationAndTeamData.teamId) {
            language = await this.parametersService.findByKey(
                ParametersKey.LANGUAGE_CONFIG,
                organizationAndTeamData,
            );
        }

        if (!language) {
            return 'en-US';
        }

        return language?.configValue || 'en-US';
    }
}
