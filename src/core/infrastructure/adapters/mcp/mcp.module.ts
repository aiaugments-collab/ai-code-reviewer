import { Module, DynamicModule, Provider, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpController } from './controllers/mcp.controller';
import { McpServerService } from './services/mcp-server.service';
import { McpEnabledGuard } from './guards/mcp-enabled.guard';
import { PlatformIntegrationModule } from '../../../../modules/platformIntegration.module';
import { CodeManagementTools, KodyRulesTools } from './tools';
import { MCPManagerService } from './services/mcp-manager.service';
import { JwtModule } from '@nestjs/jwt';
import { KodyRulesModule } from '@/modules/kodyRules.module';

@Module({})
export class McpModule {
    static forRoot(configService?: ConfigService): DynamicModule {
        const imports = [];
        const providers: Provider[] = [];
        const controllers = [];
        const exports = [];

        const isEnabled =
            process.env.API_MCP_SERVER_ENABLED === 'true' ||
            configService?.get<boolean>('API_MCP_SERVER_ENABLED', false);

        if (isEnabled) {
            imports.push(
                forwardRef(() => PlatformIntegrationModule),
                JwtModule,
                forwardRef(() => KodyRulesModule),
            );

            controllers.push(McpController);

            providers.push(
                McpServerService,
                McpEnabledGuard,
                CodeManagementTools,
                KodyRulesTools,
                MCPManagerService,
            );

            exports.push(McpServerService, MCPManagerService);
        }

        return {
            module: McpModule,
            imports,
            controllers,
            providers,
            exports,
            global: true,
        };
    }
}
