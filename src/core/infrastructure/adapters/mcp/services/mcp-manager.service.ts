import { AxiosMCPManagerService } from '@/config/axios/microservices/mcpManager.axios';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { MCPServerConfig } from '@kodus/flow';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

type MCPConnection = {
    id: string;
    mcpUrl: string;
    status: string;
    appName: string;
    authUrl: string;
    allowedTools: string[];
};

type Metadata = {
    connection: MCPConnection;
};

type MCPItem = {
    id: string;
    organizationId: string;
    integrationId: string;
    provider: string;
    status: string;
    appName: string;
    mcpUrl: string;
    allowedTools: string[];
    metadata: Metadata;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
};

type MCPData = {
    items: MCPItem[];
};

@Injectable()
export class MCPManagerService {
    private axiosMCPManagerService: AxiosMCPManagerService;

    constructor(private readonly jwt: JwtService) {
        this.axiosMCPManagerService = new AxiosMCPManagerService();
    }

    private generateToken(organizationId: string): string {
        return this.jwt.sign(
            {
                organizationId,
            },
            {
                secret: process.env.API_JWT_SECRET || '',
            },
        );
    }

    private getAuthHeaders(organizationAndTeamData: OrganizationAndTeamData): {
        Authorization: string;
    } {
        const token = this.generateToken(
            organizationAndTeamData.organizationId,
        );
        return {
            Authorization: `Bearer ${token}`,
        };
    }

    public async getConnections(
        organizationAndTeamData: OrganizationAndTeamData,
        format?: true,
    ): Promise<MCPServerConfig[]>;

    public async getConnections(
        organizationAndTeamData: OrganizationAndTeamData,
        format?: false,
    ): Promise<MCPItem[]>;

    public async getConnections(
        organizationAndTeamData: OrganizationAndTeamData,
        format: boolean = true,
        filters?: {
            provider?: string;
            status?: string;
        },
    ): Promise<MCPItem[] | MCPServerConfig[]> {
        try {
            const { provider, status = 'ACTIVE' } = filters || {};

            const data: MCPData = await this.axiosMCPManagerService.get(
                'mcp/connections',
                {
                    headers: this.getAuthHeaders(organizationAndTeamData),
                    params: { provider, status },
                },
            );

            if (!data) {
                return [];
            }

            if (format) {
                return data.items.map((connection) =>
                    this.formatConnection(connection),
                );
            }

            return data.items;
        } catch (error) {
            console.error('Error fetching MCP connections:', error);
            return [];
        }
    }

    public async getConnectionById(
        organizationAndTeamData: OrganizationAndTeamData,
        connectionId: string,
        format?: true,
    ): Promise<MCPServerConfig | null>;

    public async getConnectionById(
        organizationAndTeamData: OrganizationAndTeamData,
        connectionId: string,
        format?: false,
    ): Promise<MCPItem | null>;

    public async getConnectionById(
        organizationAndTeamData: OrganizationAndTeamData,
        connectionId: string,
        format: boolean = true,
        filters?: {
            provider?: string;
            status?: string;
        },
    ): Promise<MCPItem | MCPServerConfig | null> {
        try {
            const { provider, status = 'ACTIVE' } = filters || {};

            const data: MCPItem = await this.axiosMCPManagerService.get(
                `mcp/connections/${connectionId}`,
                {
                    headers: this.getAuthHeaders(organizationAndTeamData),
                    params: { provider, status },
                },
            );

            if (!data) {
                return null;
            }

            if (format) {
                return this.formatConnection(data);
            }

            return data || null;
        } catch (error) {
            console.error('Error fetching MCP connection by ID:', error);
            return null;
        }
    }

    private formatConnection(connection: MCPItem): MCPServerConfig {
        return {
            name: connection.appName,
            type: 'http',
            url: connection.mcpUrl,
            headers: {
                ...this.getAuthHeaders({
                    organizationId: connection.organizationId,
                }),
                'Content-Type': 'application/json',
            },
            retries: 1,
            timeout: 10_000,
            allowedTools: connection.allowedTools,
        };
    }
}
