import { SpecCompliantMCPClient } from './client.js';
import { createLogger } from '../../observability/index.js';
import {
    MCPClientConfig,
    MCPRegistryOptions,
    MCPServerConfig,
    MCPToolRawWithServer,
    TransportType,
} from '../../core/types/allTypes.js';

export class MCPRegistry {
    private clients = new Map<string, SpecCompliantMCPClient>();
    private pending = new Map<string, Promise<void>>();
    private options: MCPRegistryOptions & {
        defaultTimeout: number;
        maxRetries: number;
    };
    private logger = createLogger('MCPRegistry');

    constructor(_options: MCPRegistryOptions = {}) {
        this.options = {
            defaultTimeout: 30000,
            maxRetries: 3,
        };

        this.logger.info('MCPRegistry initialized');
    }

    /**
     * Registra um servidor MCP
     */
    async register(config: MCPServerConfig): Promise<void> {
        // Verifica se já está registrando
        if (this.pending.has(config.name)) {
            await this.pending.get(config.name);
            return;
        }

        // cria a promessa de registro e salva no map
        const job = (async () => {
            try {
                this.logger.info('Registering MCP server', {
                    serverName: config.name,
                });

                // ─── 1. Normalizar tipo de transporte ───────────────────────────────
                const transportType: TransportType = config.type ?? 'http';

                // ─── 2. Montar configuração p/ SpecCompliantMCPClient ───────────────
                const clientConfig: MCPClientConfig = {
                    clientInfo: {
                        name: `mcp-registry-client-${config.name}`,
                        version: '1.0.0',
                    },
                    transport: {
                        type: transportType,
                        url: config.url, // obrigatório para http/sse/ws
                        headers: config.headers,
                        timeout: config.timeout ?? this.options.defaultTimeout,
                        retries: config.retries ?? this.options.maxRetries,
                    },
                    capabilities: {
                        roots: { listChanged: true },
                        sampling: {},
                        elicitation: {},
                    },
                    allowedTools: config.allowedTools || [],
                };

                // ─── 3. Criar & conectar cliente ───────────────────────────────────
                const client = new SpecCompliantMCPClient(clientConfig);
                await client.connect();
                this.clients.set(config.name, client);

                this.logger.info('Successfully registered MCP server', {
                    serverName: config.name,
                });
            } catch (error) {
                this.logger.error(
                    'Failed to register MCP server',
                    error instanceof Error ? error : undefined,
                    { serverName: config.name, config },
                );
                throw error;
            } finally {
                // remove promessa pendente (sucesso ou erro)
                this.pending.delete(config.name);
            }
        })();

        // salva e aguarda
        this.pending.set(config.name, job);
        await job;
    }

    /**
     * Remove um servidor MCP
     */
    async unregister(serverName: string): Promise<void> {
        const client = this.clients.get(serverName);
        if (client) {
            await client.disconnect();
            this.clients.delete(serverName);
        }
    }

    /**
     * Lista todas as tools
     */
    async listAllTools(): Promise<MCPToolRawWithServer[]> {
        const allTools: MCPToolRawWithServer[] = [];

        this.logger.info('Listing all tools from MCP registry', {
            totalClients: this.clients.size,
        });

        // Lista todas as tools
        for (const [serverName, client] of this.clients) {
            try {
                this.logger.debug('Listing tools from server', { serverName });

                // Check if client is still connected
                if (!client.isConnected()) {
                    this.logger.warn(
                        'Client not connected, attempting to reconnect',
                        { serverName },
                    );
                    try {
                        await client.connect();
                    } catch (reconnectError) {
                        this.logger.error(
                            'Failed to reconnect to server',
                            reconnectError instanceof Error
                                ? reconnectError
                                : undefined,
                            { serverName },
                        );
                        continue; // Skip this server
                    }
                }

                const tools = await client.listTools();
                this.logger.debug('Received tools from server', {
                    serverName,
                    toolCount: tools.length,
                    toolNames: tools.map((t) => t.name),
                });

                for (const tool of tools) {
                    // ✅ ADDED: Validate tool structure before processing
                    if (!tool || typeof tool !== 'object') {
                        this.logger.warn('Invalid tool structure received', {
                            serverName,
                            tool,
                        });
                        continue;
                    }

                    // ✅ ADDED: Validate tool name
                    if (!tool.name || typeof tool.name !== 'string') {
                        this.logger.warn('Invalid tool name received', {
                            serverName,
                            tool,
                        });
                        continue;
                    }

                    // ✅ ADDED: Validate tool schema
                    if (!tool.inputSchema) {
                        this.logger.warn('Tool missing inputSchema', {
                            serverName,
                            toolName: tool.name,
                        });
                        // Use fallback schema
                        tool.inputSchema = { type: 'object', properties: {} };
                    }

                    // ✅ ADDED: Log tool metadata for debugging
                    this.logger.debug('Processing MCP tool', {
                        serverName,
                        toolName: tool.name,
                        hasTitle: !!tool.title,
                        hasDescription: !!tool.description,
                        hasOutputSchema: !!tool.outputSchema,
                        hasAnnotations: !!tool.annotations,
                    });

                    allTools.push({
                        ...tool,
                        serverName,
                    });
                }
            } catch (error) {
                this.logger.error(
                    'Error listing tools from server',
                    error instanceof Error ? error : new Error(String(error)),
                    {
                        serverName,
                        errorMessage:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        errorName:
                            error instanceof Error ? error.name : 'Unknown',
                        errorStack:
                            error instanceof Error ? error.stack : undefined,
                    },
                );

                // ✅ ADDED: Continue processing other servers instead of breaking
                // This ensures one bad server doesn't break the entire registry
                continue;
            }
        }

        this.logger.info('Finished listing tools', {
            totalToolsFound: allTools.length,
            toolsByServer: allTools.reduce(
                (acc, tool) => {
                    if (tool.serverName) {
                        acc[tool.serverName] = (acc[tool.serverName] || 0) + 1;
                    }
                    return acc;
                },
                {} as Record<string, number>,
            ),
        });

        return allTools;
    }

    /**
     * Executa tool
     */
    async executeTool(
        toolName: string,
        args?: Record<string, unknown>,
        serverName?: string,
    ): Promise<unknown> {
        if (serverName) {
            const client = this.clients.get(serverName);

            if (!client) {
                throw new Error(`MCP server ${serverName} not found`);
            }

            return client.executeTool(toolName, args);
        }

        // Tenta encontrar tool em qualquer servidor
        for (const [, client] of this.clients) {
            try {
                const tools = await client.listTools();

                if (tools.some((tool) => tool.name === toolName)) {
                    return client.executeTool(toolName, args);
                }
            } catch {
                /* ignora */
            }
        }
        throw new Error(
            `Tool ${toolName} not found in any registered MCP server`,
        );
    }

    /**
     * Limpa recursos
     */
    destroy(): void {
        // Desconecta todos os clientes
        for (const [, client] of this.clients) {
            client.disconnect().catch((error) => {
                this.logger.warn('Failed to disconnect MCP client', {
                    error: error.message,
                });
            });
        }
        this.clients.clear();
    }
}
