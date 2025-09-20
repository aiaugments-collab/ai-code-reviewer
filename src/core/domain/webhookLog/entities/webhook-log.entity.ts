import { Entity } from '@/shared/domain/interfaces/entity';
import { IWebhookLog } from '../interfaces/webhook-log.interface';

export class WebhookLogEntity implements Entity<IWebhookLog> {
    private readonly _uuid: IWebhookLog['uuid'];
    private readonly _createdAt: IWebhookLog['createdAt'];
    private readonly _updatedAt: IWebhookLog['updatedAt'];
    private readonly _platform: IWebhookLog['platform'];
    private readonly _event: IWebhookLog['event'];
    private readonly _payload: IWebhookLog['payload'];
    private readonly _meta?: IWebhookLog['meta'];

    constructor(webhookLog: IWebhookLog | Partial<IWebhookLog>) {
        this._uuid = webhookLog.uuid;
        this._createdAt = webhookLog.createdAt;
        this._updatedAt = webhookLog.updatedAt;
        this._platform = webhookLog.platform;
        this._event = webhookLog.event;
        this._payload = webhookLog.payload;
        this._meta = webhookLog.meta;
    }

    toObject(): IWebhookLog {
        return {
            uuid: this.uuid,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            platform: this.platform,
            event: this.event,
            payload: this.payload,
            meta: this.meta,
        };
    }

    toJson(): IWebhookLog | Partial<IWebhookLog> {
        return this.toObject();
    }

    public get uuid(): IWebhookLog['uuid'] {
        return this._uuid;
    }

    public get createdAt(): IWebhookLog['createdAt'] {
        return this._createdAt;
    }

    public get updatedAt(): IWebhookLog['updatedAt'] {
        return this._updatedAt;
    }

    public get platform(): IWebhookLog['platform'] {
        return this._platform;
    }

    public get event(): IWebhookLog['event'] {
        return this._event;
    }

    public get payload(): IWebhookLog['payload'] {
        return { ...this._payload };
    }

    public get meta(): IWebhookLog['meta'] {
        return { ...(this._meta ?? {}) };
    }
}
