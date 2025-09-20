import { Injectable } from '@nestjs/common';
import { PinoLoggerService } from '../../services/logger/pino.service';
import { Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { nanoid } from 'nanoid';
import { CodeManagementTools, KodyRulesTools } from '../tools';
import { toShape } from '../types/mcp-tool.interface';

interface McpSession {
    id: string;
    server: McpServer;
    transport: StreamableHTTPServerTransport;
    createdAt: Date;
}

@Injectable()
export class McpServerService {
    private sessions: Map<string, McpSession> = new Map();

    constructor(
        private readonly codeManagementTools: CodeManagementTools,
        private readonly kodyRulesTools: KodyRulesTools,
        private readonly logger: PinoLoggerService,
    ) {}

    async createSession(): Promise<string> {
        const sessionId = nanoid();

        // Create MCP server instance
        const server = new McpServer(
            {
                name: 'kodus-code-management',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            },
        );

        server.tool;

        // Register all tools
        this.registerTools(server);

        // Create transport
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId,
        });

        // Setup cleanup
        transport.onclose = () => {
            this.sessions.delete(sessionId);
            this.logger.log({
                message: 'MCP session closed',
                context: McpServerService.name,
                metadata: { sessionId },
            });
        };

        // Connect server to transport
        await server.connect(transport);

        // Store session
        const session: McpSession = {
            id: sessionId,
            server,
            transport,
            createdAt: new Date(),
        };

        this.sessions.set(sessionId, session);
        this.logger.log({
            message: 'MCP session created',
            context: McpServerService.name,
            metadata: { sessionId },
        });

        return sessionId;
    }

    private registerTools(server: McpServer): void {
        // Get all tools from tool classes
        const codeManagementTools = this.codeManagementTools.getAllTools();
        const kodyRulesTools = this.kodyRulesTools.getAllTools();
        const allTools = [...codeManagementTools, ...kodyRulesTools];

        for (const tool of allTools) {
            server.registerTool(
                tool.name,
                {
                    description: tool.description,
                    inputSchema: toShape(tool.inputSchema)!,
                    outputSchema: toShape(tool.outputSchema),
                    annotations: tool?.annotations,
                },
                tool.execute,
            );
        }

        this.logger.log({
            message: 'Registered MCP tools',
            context: McpServerService.name,
            metadata: { toolCount: allTools.length },
        });
    }

    hasSession(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    async handleRequest(
        sessionId: string,
        body: any,
        res: Response,
    ): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        await session.transport.handleRequest(res.req, res, body);
    }

    async handleServerNotifications(
        sessionId: string,
        res: Response,
    ): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        await session.transport.handleRequest(res.req, res);
    }

    async terminateSession(sessionId: string, res: Response): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        await session.transport.handleRequest(res.req, res);

        // Clean up session
        session.transport.close();
        this.sessions.delete(sessionId);
        this.logger.log({
            message: 'MCP session terminated',
            context: McpServerService.name,
            metadata: { sessionId },
        });
    }

    getActiveSessionCount(): number {
        return this.sessions.size;
    }

    getAvailableToolsCount(): number {
        const codeManagementTools = this.codeManagementTools.getAllTools();
        const kodyRulesTools = this.kodyRulesTools.getAllTools();
        return codeManagementTools.length + kodyRulesTools.length;
    }

    getSessionInfo(sessionId: string): Partial<McpSession> | undefined {
        const session = this.sessions.get(sessionId);
        if (!session) return undefined;

        return {
            id: session.id,
            createdAt: session.createdAt,
        };
    }

    getAllSessions(): Partial<McpSession>[] {
        return Array.from(this.sessions.values()).map((session) => ({
            id: session.id,
            createdAt: session.createdAt,
        }));
    }

    async cleanup(): Promise<void> {
        this.logger.log({
            message: 'Cleaning up MCP sessions',
            context: McpServerService.name,
        });

        for (const session of this.sessions.values()) {
            session.transport.close();
        }

        this.sessions.clear();
        this.logger.log({
            message: 'MCP sessions cleanup complete',
            context: McpServerService.name,
        });
    }
}
