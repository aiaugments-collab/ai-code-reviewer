import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { IWebhookLogRepository } from './webhook-log.repository.contract';

export const WEBHOOK_LOG_SERVICE = Symbol('WEBHOOK_LOG_SERVICE');

export interface IWebhookLogService extends IWebhookLogRepository {
    log(
        platform: PlatformType,
        event: string,
        payload: Record<string, any>,
        meta?: Record<string, any>,
    ): Promise<void>;
}
