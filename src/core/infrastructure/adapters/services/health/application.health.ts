import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorResult } from '@nestjs/terminus';

@Injectable()
export class ApplicationHealthIndicator {
    constructor(private readonly configService: ConfigService) {}

    async isApplicationHealthy(): Promise<HealthIndicatorResult> {
        const env = process.env.API_NODE_ENV;
        const postgresConfig = this.configService.get('postgresDatabase');
        const mongoConfig = this.configService.get('mongoDatabase');
        const uptime = Math.floor(process.uptime());

        const hasValidEnv = !!env;
        const hasPostgresConfig = !!postgresConfig;
        const hasMongoConfig = !!mongoConfig;
        const hasMinUptime = uptime > 5;

        const allChecksPass = hasValidEnv && hasPostgresConfig && hasMongoConfig && hasMinUptime;
        const uptimeFormatted = this.formatUptime(uptime);

        return {
            application: {
                status: allChecksPass ? 'up' : 'down',
                uptime: uptimeFormatted,
                timestamp: new Date().toISOString(),
                checks_passed: allChecksPass,
            },
        };
    }

    private formatUptime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }
}
