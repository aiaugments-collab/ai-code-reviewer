import {
    IWebhookLogRepository,
    WEBHOOK_LOG_REPOSITORY,
} from '@/core/domain/webhookLog/contracts/webhook-log.repository.contract';
import { IWebhookLogService } from '@/core/domain/webhookLog/contracts/webhook-log.service.contract';
import { WebhookLogEntity } from '@/core/domain/webhookLog/entities/webhook-log.entity';
import { IWebhookLog } from '@/core/domain/webhookLog/interfaces/webhook-log.interface';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class WebhookLogService implements IWebhookLogService {
    constructor(
        @Inject(WEBHOOK_LOG_REPOSITORY)
        private readonly webhookLogRepository: IWebhookLogRepository,
    ) {}

    create(data: IWebhookLog): Promise<WebhookLogEntity | null> {
        return this.webhookLogRepository.create(data);
    }

    update(
        uuid: string,
        data: Partial<Exclude<IWebhookLog, 'uuid' | 'createdAt' | 'updatedAt'>>,
    ): Promise<WebhookLogEntity | null> {
        return this.webhookLogRepository.update(uuid, data);
    }

    find(filter: Partial<IWebhookLog>): Promise<WebhookLogEntity[]> {
        return this.webhookLogRepository.find(filter);
    }

    findOne(filter: Partial<IWebhookLog>): Promise<WebhookLogEntity | null> {
        return this.webhookLogRepository.findOne(filter);
    }

    delete(uuid: string): Promise<void> {
        return this.webhookLogRepository.delete(uuid);
    }

    async log(
        platform: PlatformType,
        event: string,
        payload: Record<string, any>,
        meta?: Record<string, any>,
    ): Promise<void> {
        await this.webhookLogRepository.create({
            platform,
            event,
            payload,
            meta,
        });
    }
}
