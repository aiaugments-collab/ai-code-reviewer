import { ConfigService } from '@nestjs/config';
import { ConnectionString } from 'connection-string';
import {
    createDirectLLMAdapter,
    createMCPAdapter,
    createOrchestration,
    LLMAdapter,
    MCPServerConfig,
    PlannerType,
    StorageEnum,
    Thread,
    toHumanAiMessages,
} from '@kodus/flow';
import { SDKOrchestrator } from '@kodus/flow/dist/orchestration';
import { LLMModelProvider, LLMProviderService } from '@kodus/kodus-common/llm';
import { PinoLoggerService } from '../../../logger/pino.service';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { DatabaseConnection } from '@/config/types';
import {
    PARAMETERS_SERVICE_TOKEN,
    IParametersService,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';

export type LLMDefaults = {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxReasoningTokens?: number;
    stop?: string[];
};

export type DefaultLLMConfig = {
    llmProvider: LLMModelProvider;
    temperature: number;
    maxTokens: number;
    maxReasoningTokens?: number;
    stop?: string[];
};

export abstract class AgentBaseProvider {
    protected config: DatabaseConnection;

    protected orchestration!: SDKOrchestrator;
    protected mcpAdapter!: ReturnType<typeof createMCPAdapter>;
    protected llmAdapter!: LLMAdapter;

    protected constructor(
        protected readonly configService: ConfigService,
        protected readonly llmProviderService: LLMProviderService,
        protected readonly logger: PinoLoggerService,
        protected readonly parametersService: IParametersService,
        // Opcional: gerenciador de MCP (pode ser undefined para agentes sem MCP)
        protected readonly mcpManagerService?: {
            getConnections: (
                org: OrganizationAndTeamData,
            ) => Promise<MCPServerConfig[]>;
        },
    ) {
        this.config =
            this.configService.get<DatabaseConnection>('mongoDatabase');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // LLM
    // ──────────────────────────────────────────────────────────────────────────
    protected createConfigurableLLMAdapter(
        defaults: DefaultLLMConfig,
    ): LLMAdapter {
        const self = this;
        const wrappedLLM = {
            name: 'agent-configurable-llm',
            async call(messages: any[], options: any = {}) {
                const lcMessages = toHumanAiMessages(messages);

                const resolveProvider = (model?: string): LLMModelProvider => {
                    return (model && (model as any)) || defaults.llmProvider;
                };

                const provider = resolveProvider(options?.model);

                const client = self.llmProviderService.getLLMProvider({
                    model: provider ?? defaults.llmProvider,
                    temperature:
                        typeof options?.temperature === 'number'
                            ? options?.temperature
                            : defaults.temperature,
                    maxTokens:
                        typeof options?.maxTokens === 'number'
                            ? options?.maxTokens
                            : defaults.maxTokens,
                    maxReasoningTokens:
                        typeof options?.maxReasoningTokens === 'number'
                            ? options?.maxReasoningTokens
                            : defaults.maxReasoningTokens,
                });

                const resp = await client.invoke(lcMessages, {
                    stop: options?.stop ?? defaults.stop,
                    temperature:
                        typeof options?.temperature === 'number'
                            ? options?.temperature
                            : defaults.temperature,
                    maxReasoningTokens:
                        typeof options?.maxReasoningTokens === 'number'
                            ? options?.maxReasoningTokens
                            : defaults.maxReasoningTokens,
                });

                return resp as any;
            },
        };

        return createDirectLLMAdapter(wrappedLLM);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // MCP
    // ──────────────────────────────────────────────────────────────────────────
    protected async createMCPAdapter(
        organizationAndTeamData: OrganizationAndTeamData,
        options?: {
            allowedTools?: string[];
            serverName?: string;
            serviceUrlEnv?: string;
            timeoutMs?: number;
            retries?: number;
            headers?: Record<string, string>;
        },
    ) {
        const mcpManagerServers =
            (await this.mcpManagerService?.getConnections(
                organizationAndTeamData,
            )) || [];

        const defaultServers: MCPServerConfig[] = [
            {
                name: options?.serverName || 'kodus-mcp-server',
                type: 'http' as const,
                url: process.env[
                    options?.serviceUrlEnv || 'API_KODUS_MCP_SERVER_URL'
                ],
                timeout: options?.timeoutMs ?? 10000,
                retries: options?.retries ?? 1,
                headers: options?.headers || {
                    contentType: 'application/json',
                },
                allowedTools: options?.allowedTools || [],
            },
        ];

        const servers = [...defaultServers, ...mcpManagerServers];

        this.mcpAdapter = createMCPAdapter({
            servers,
            defaultTimeout: options?.timeoutMs ?? 10000,
            maxRetries: options?.retries ?? 1,
            onError: (err) => {},
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Orchestration
    // ──────────────────────────────────────────────────────────────────────────
    protected async createOrchestration(
        tenantId: string,
        telemetryServiceName: string,
    ) {
        const uri = new ConnectionString('', {
            user: this.config.username,
            password: this.config.password,
            protocol: this.config.port ? 'mongodb' : 'mongodb+srv',
            hosts: [{ name: this.config.host, port: this.config.port }],
        }).toString();

        this.orchestration = await createOrchestration({
            tenantId,
            llmAdapter: this.llmAdapter,
            mcpAdapter: this.mcpAdapter,
            observability: {
                logging: { enabled: true, level: 'info' },
                mongodb: {
                    type: 'mongodb',
                    connectionString: uri,
                    database: this.config.database,
                },
                telemetry: {
                    enabled: true,
                    serviceName: telemetryServiceName,
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

    protected async connectMCPIfAvailable() {
        try {
            await this.orchestration.connectMCP();
            await this.orchestration.registerMCPTools();
        } catch (error) {}
    }

    protected async createAgent(options: {
        name: string;
        identity: {
            goal: string;
            description: string;
            language: string;
            languageInstructions?: string;
            [k: string]: unknown;
        };
        llmDefaults?: LLMDefaults;
        maxIterations?: number;
        timeout?: number;
        enableSession?: boolean;
        enableMemory?: boolean;
        plannerType?: PlannerType;
    }) {
        await this.orchestration.createAgent({
            name: options.name,
            identity: options.identity as any,
            llmDefaults: options.llmDefaults,
            maxIterations: options.maxIterations,
            timeout: options.timeout,
            enableSession: options.enableSession ?? true,
            enableMemory: options.enableMemory ?? true,
            plannerOptions: {
                type: options.plannerType || PlannerType.REACT,
            },
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Language
    // ──────────────────────────────────────────────────────────────────────────
    protected async getLanguage(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<string> {
        let language: any = null;

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
