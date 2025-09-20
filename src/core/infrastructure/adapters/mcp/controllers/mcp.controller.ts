import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    Headers,
    Res,
    HttpStatus,
    UseGuards,
    Inject,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { McpServerService } from '../services/mcp-server.service';
import { McpEnabledGuard } from '../guards/mcp-enabled.guard';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { PinoLoggerService } from '../../services/logger/pino.service';
import { MCPManagerService } from '../services/mcp-manager.service';
import { REQUEST } from '@nestjs/core';
import { toJsonRpcError } from '../utils/serialize';
import { JsonRpcCode } from '../utils/errors';

function getJsonRpcId(body: any): string | number | null {
    return body && (typeof body.id === 'string' || typeof body.id === 'number')
        ? body.id
        : null;
}

function accepts(req: Request, mime: string) {
    const h = (req.headers['accept'] || '').toString().toLowerCase();
    return h.includes(mime.toLowerCase());
}

@Controller('mcp')
@UseGuards(McpEnabledGuard)
export class McpController {
    constructor(
        private readonly mcpServerService: McpServerService,
        private readonly logger: PinoLoggerService,
        private readonly mcpManagerService: MCPManagerService,
        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string } };
        },
    ) {}

    @Post()
    async handleClientRequest(
        @Body() body: any,
        @Headers('mcp-session-id') sessionId: string | undefined,
        @Res() res: Response,
    ) {
        const id = getJsonRpcId(body);
        try {
            if (!accepts(res.req, 'application/json')) {
                return res.status(HttpStatus.NOT_ACCEPTABLE).json(
                    toJsonRpcError(
                        {
                            code: JsonRpcCode.INVALID_REQUEST,
                            message: 'Client must accept application/json',
                        },
                        id,
                    ),
                );
            }

            if (sessionId && this.mcpServerService.hasSession(sessionId)) {
                await this.mcpServerService.handleRequest(sessionId, body, res);
                return;
            }

            if (!sessionId && isInitializeRequest(body)) {
                const newSessionId =
                    await this.mcpServerService.createSession();
                await this.mcpServerService.handleRequest(
                    newSessionId,
                    body,
                    res,
                );
                return;
            }

            return res.status(HttpStatus.BAD_REQUEST).json(
                toJsonRpcError(
                    {
                        code: JsonRpcCode.INVALID_REQUEST,
                        message:
                            'Bad Request: missing or invalid Mcp-Session-Id',
                    },
                    id,
                ),
            );
        } catch (error) {
            this.logger.error({
                message: 'Error handling MCP request',
                context: McpController.name,
                error,
                metadata: { sessionId, body },
            });
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(
                toJsonRpcError(
                    {
                        code: JsonRpcCode.INTERNAL_ERROR,
                        message: 'Internal error',
                        data: { reason: 'controller-failure' },
                    },
                    id,
                ),
            );
        }
    }

    @Get()
    async handleServerNotifications(
        @Headers('mcp-session-id') sessionId: string | undefined,
        @Res() res: Response,
    ) {
        if (!accepts(res.req, 'text/event-stream')) {
            return res
                .status(HttpStatus.NOT_ACCEPTABLE)
                .send('Client must accept text/event-stream');
        }

        if (!sessionId || !this.mcpServerService.hasSession(sessionId)) {
            return res
                .status(HttpStatus.BAD_REQUEST)
                .send('Invalid or missing session ID');
        }
        await this.mcpServerService.handleServerNotifications(sessionId, res);
    }

    @Delete()
    async handleSessionTermination(
        @Headers('mcp-session-id') sessionId: string | undefined,
        @Res() res: Response,
    ) {
        if (!sessionId || !this.mcpServerService.hasSession(sessionId)) {
            return res
                .status(HttpStatus.BAD_REQUEST)
                .send('Invalid or missing session ID');
        }
        await this.mcpServerService.terminateSession(sessionId, res);
    }
}
