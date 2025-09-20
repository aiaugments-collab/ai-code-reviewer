import {
    EngineTool,
    MCPAdapter,
    MCPAdapterConfig,
    MCPPromptWithServer,
    MCPResourceWithServer,
    MCPTool,
} from '../../core/types/allTypes.js';
import { MCPRegistry } from './registry.js';
import { mcpToolsToEngineTools } from './tools.js';
/**
 * Create an MCP adapter for Kodus Flow
 *
 * @example
 * ```typescript
 * const mcpAdapter = createMCPAdapter({
 *   servers: [
 *     {
 *       name: 'filesystem',
 *       type: 'http',
 *       url: 'http://localhost:3000',
 *     },
 *     {
 *       name: 'github',
 *       type: 'http',
 *       url: 'http://localhost:3001',
 *       headers: {
 *         Authorization: `Bearer ${process.env.GITHUB_TOKEN}`
 *       }
 *     }
 *   ],
 *   // Tool filtering
 *   allowedTools: {
 *     names: ['read_file', 'write_file'],
 *     servers: ['filesystem'],
 *   },
 *   blockedTools: {
 *     names: ['dangerous_tool'],
 *     patterns: [/delete/],
 *   },
 *   // Error handling
 *   onError: (error, serverName) => {
 *     console.error(`MCP server ${serverName} error:`, error);
 *   }
 * });
 *
 * // Connect all servers
 * await mcpAdapter.connect();
 *
 * // Use with an agent
 * const agent = createAgent({
 *   tools: await mcpAdapter.getTools(),
 * });
 * ```
 */
export function createMCPAdapter(config: MCPAdapterConfig): MCPAdapter {
    const registry = new MCPRegistry({
        defaultTimeout: config.defaultTimeout,
        maxRetries: config.maxRetries,
    });

    let isConnected = false;

    const adapter: MCPAdapter = {
        /**
         * Connect to all configured MCP servers
         */
        async connect(): Promise<void> {
            // Always reconnect to ensure fresh connections
            if (isConnected) {
                await this.disconnect();
            }

            const promises = config.servers.map((server) =>
                registry.register(server).catch((error) => {
                    if (config.onError) {
                        config.onError(error, server.name);
                    }
                    throw error;
                }),
            );

            await Promise.all(promises);
            isConnected = true;
        },

        /**
         * Disconnect from all MCP servers
         */
        async disconnect(): Promise<void> {
            if (!isConnected) {
                return;
            }

            try {
                registry.destroy();
            } catch {
            } finally {
                isConnected = false;
            }
        },

        /**
         * Get all tools as engine-compatible tools
         */
        async getTools(): Promise<MCPTool[]> {
            if (!isConnected) {
                throw new Error(
                    'MCP adapter not connected. Call connect() first.',
                );
            }

            await this.ensureConnection();

            const mcpTools = await registry.listAllTools();
            const engineTools = mcpToolsToEngineTools(mcpTools);

            return engineTools.map((tool: EngineTool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool?.inputSchema,
                outputSchema: tool?.outputSchema,
                annotations: tool?.annotations,
                title: tool?.title,
                execute: async (args: unknown, _ctx: unknown) => {
                    return registry.executeTool(
                        tool.name,
                        args as Record<string, unknown>,
                    );
                },
            }));
        },

        /**
         * Check if a tool exists
         */
        async hasTool(name: string): Promise<boolean> {
            if (!isConnected) {
                return false;
            }

            try {
                await this.ensureConnection();
                const tools = await registry.listAllTools();
                return tools.some((tool) => tool.name === name);
            } catch {
                return false;
            }
        },

        /**
         * List all resources from all servers
         */
        async listResources(): Promise<MCPResourceWithServer[]> {
            if (!isConnected) {
                throw new Error(
                    'MCP adapter not connected. Call connect() first.',
                );
            }

            // TODO: Implement resource listing with health checks
            return [];
        },

        /**
         * Read a resource
         */
        async readResource(
            _uri: string,
            _serverName?: string,
        ): Promise<unknown> {
            if (!isConnected) {
                throw new Error(
                    'MCP adapter not connected. Call connect() first.',
                );
            }

            // TODO: Implement resource reading with health checks
            throw new Error('Resource reading not implemented');
        },

        /**
         * List all prompts from all servers
         */
        async listPrompts(): Promise<MCPPromptWithServer[]> {
            if (!isConnected) {
                throw new Error(
                    'MCP adapter not connected. Call connect() first.',
                );
            }

            // TODO: Implement prompt listing with health checks
            return [];
        },

        /**
         * Get a prompt
         */
        async getPrompt(
            _name: string,
            _args?: Record<string, string>,
            _serverName?: string,
        ): Promise<unknown> {
            if (!isConnected) {
                throw new Error(
                    'MCP adapter not connected. Call connect() first.',
                );
            }

            // TODO: Implement prompt getting with health checks
            throw new Error('Prompt getting not implemented');
        },

        /**
         * Execute a tool directly
         */
        async executeTool(
            name: string,
            args?: Record<string, unknown>,
            serverName?: string,
        ) {
            if (!isConnected) {
                throw new Error(
                    'MCP adapter not connected. Call connect() first.',
                );
            }

            await this.ensureConnection();

            // Since we removed server prefix, use the name directly
            // If serverName is provided, use it; otherwise let registry find the tool
            return registry.executeTool(name, args, serverName);
        },

        /**
         * Ensure connection is fresh and working
         */
        async ensureConnection(): Promise<void> {
            if (!isConnected) {
                await this.connect();
                return;
            }

            try {
                await registry.listAllTools();
            } catch {
                await this.disconnect();
                await this.connect();
            }
        },

        getMetrics(): Record<string, unknown> {
            const metrics: Record<string, unknown> = {};

            return metrics;
        },

        getRegistry(): unknown {
            return registry;
        },
    };

    return adapter;
}

export { MCPRegistry } from './registry.js';
export { SpecCompliantMCPClient as MCPClient } from './client.js';
