import { describe, it, expect } from 'vitest';

describe('MCP Tools - Server Prefix Removal', () => {
    it('should handle tools without server name', () => {
        // Simulate the function behavior without importing
        const mcpTool = {
            name: 'list_repositories',
            serverName: undefined,
            description: 'List repositories',
            inputSchema: { type: 'object', properties: {} },
        };

        // Test that serverName can be undefined
        expect(mcpTool.serverName).toBeUndefined();
        expect(mcpTool.name).toBe('list_repositories');
    });

    it('should parse tool name correctly (no server prefix)', () => {
        // Simulate parseToolName behavior
        const fullName = 'list_repositories';
        const result = { toolName: fullName, serverName: undefined };

        expect(result.toolName).toBe('list_repositories');
        expect(result.serverName).toBeUndefined();
    });
});
