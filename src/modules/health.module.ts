import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from '@/core/infrastructure/http/controllers/health.controller';
import { DatabaseHealthIndicator } from '@/core/infrastructure/adapters/services/health/database.health';
import { ApplicationHealthIndicator } from '@/core/infrastructure/adapters/services/health/application.health';

@Module({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [
        DatabaseHealthIndicator,
        ApplicationHealthIndicator,
    ],
})
export class HealthModule {}
