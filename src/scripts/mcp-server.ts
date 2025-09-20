#!/usr/bin/env node

/**
 * Standalone MCP Server
 * 
 * This script runs MCP as a standalone service.
 * For integrated mode, add McpModule to your main AppModule and set MCP_ENABLED=true
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { McpModule } from '../core/infrastructure/adapters/mcp/mcp.module';
import { McpServerService } from '../core/infrastructure/adapters/mcp/services/mcp-server.service';

async function bootstrap() {
    const logger = new Logger('MCP Server');

    try {
        // Force enable MCP for standalone mode
        process.env.API_MCP_SERVER_ENABLED = 'true';
        
        // Create NestJS application with HTTP support
        const app = await NestFactory.create(McpModule, {
            logger: ['error', 'warn', 'log'],
        });

        // Enable CORS for MCP clients
        app.enableCors({
            origin: '*',
            methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'mcp-session-id'],
            exposedHeaders: ['mcp-session-id'],
        });

        const port = process.env.MCP_PORT || 3001;
        
        // Start the HTTP server
        await app.listen(port, '0.0.0.0');
        
        logger.log(`Kodus Code Management MCP Server started on http://0.0.0.0:${port}`);
        logger.log(`MCP endpoint: POST/GET/DELETE http://0.0.0.0:${port}/mcp`);
        logger.log(`Health check: GET http://0.0.0.0:${port}/health`);
        
        // Get MCP service for cleanup
        const mcpService = app.get(McpServerService);
        
        // Graceful shutdown
        const shutdown = async (signal: string) => {
            logger.log(`Received ${signal}. Shutting down MCP Server...`);
            
            try {
                await mcpService.cleanup();
                await app.close();
                logger.log('MCP Server shutdown complete');
                process.exit(0);
            } catch (error) {
                logger.error('Error during shutdown:', error);
                process.exit(1);
            }
        };
        
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        
    } catch (error) {
        logger.error('Failed to start MCP Server', error);
        process.exit(1);
    }
}

bootstrap();
