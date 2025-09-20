import { PlatformType } from '@/shared/domain/enums/platform-type.enum';

export interface IWebhookLog {
    uuid: string;
    createdAt: Date;
    updatedAt: Date;
    platform: PlatformType;
    event: string;
    payload: Record<string, any>;
    meta?: Record<string, any>;
}
