import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { IWebhookLog } from '../interfaces/webhook-log.interface';
import { WebhookLogEntity } from '../entities/webhook-log.entity';

export const WEBHOOK_LOG_REPOSITORY = Symbol('WEBHOOK_LOG_REPOSITORY');

export interface IWebhookLogRepository {
    create(
        data: Omit<IWebhookLog, 'uuid' | 'createdAt' | 'updatedAt'>,
    ): Promise<WebhookLogEntity | null>;

    update(
        uuid: string,
        data: Partial<Omit<IWebhookLog, 'uuid' | 'createdAt' | 'updatedAt'>>,
    ): Promise<WebhookLogEntity | null>;

    find(filter: Partial<IWebhookLog>): Promise<WebhookLogEntity[]>;

    findOne(filter: Partial<IWebhookLog>): Promise<WebhookLogEntity | null>;

    delete(uuid: string): Promise<void>;
}
