import { WEBHOOK_LOG_REPOSITORY } from '@/core/domain/webhookLog/contracts/webhook-log.repository.contract';
import { WEBHOOK_LOG_SERVICE } from '@/core/domain/webhookLog/contracts/webhook-log.service.contract';
import {
    WebhookLogModel,
    WebhookLogSchema,
} from '@/core/infrastructure/adapters/repositories/mongoose/schema/webhook-log.model';
import { WebhookLogRepository } from '@/core/infrastructure/adapters/repositories/mongoose/webhook-log.repository';
import { WebhookLogService } from '@/core/infrastructure/adapters/services/webhookLog/webhook-log.service';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: WebhookLogModel.name, schema: WebhookLogSchema },
        ]),
    ],
    providers: [
        {
            provide: WEBHOOK_LOG_REPOSITORY,
            useClass: WebhookLogRepository,
        },
        {
            provide: WEBHOOK_LOG_SERVICE,
            useClass: WebhookLogService,
        },
    ],
    exports: [WEBHOOK_LOG_SERVICE],
    controllers: [],
})
export class WebhookLogModule {}
