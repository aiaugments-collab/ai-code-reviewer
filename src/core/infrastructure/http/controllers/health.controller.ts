import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { DatabaseHealthIndicator } from '@/core/infrastructure/adapters/services/health/database.health';
import { ApplicationHealthIndicator } from '@/core/infrastructure/adapters/services/health/application.health';

@Controller('health')
export class HealthController {
    constructor(
        private readonly databaseHealthIndicator: DatabaseHealthIndicator,
        private readonly applicationHealthIndicator: ApplicationHealthIndicator,
    ) {}

    @Get()
    async check(@Res() res: Response) {
        try {
            // Verificar aplicação
            const appResult =
                await this.applicationHealthIndicator.isApplicationHealthy();
            const appHealthy = appResult.application.status === 'up';

            // Verificar database
            const dbResult =
                await this.databaseHealthIndicator.isDatabaseHealthy();
            const dbHealthy = dbResult.database.status === 'up';

            // Ambos precisam estar UP
            const overallHealthy = appHealthy && dbHealthy;

            const response = {
                status: overallHealthy ? 'ok' : 'error',
                timestamp: new Date().toISOString(),
                details: {
                    application: appResult.application,
                    database: dbResult.database,
                },
            };

            // Se unhealthy, retorna HTTP 503
            const statusCode = overallHealthy
                ? HttpStatus.OK
                : HttpStatus.SERVICE_UNAVAILABLE;

            return res.status(statusCode).json(response);
        } catch (error) {
            const response = {
                status: 'error',
                error: 'Health check failed',
                timestamp: new Date().toISOString(),
            };

            return res.status(HttpStatus.SERVICE_UNAVAILABLE).json(response);
        }
    }

    @Get('simple')
    simpleCheck(@Res() res: Response) {
        return res.status(HttpStatus.OK).json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            message: 'API is running',
            uptime: Math.floor(process.uptime()),
        });
    }
}
