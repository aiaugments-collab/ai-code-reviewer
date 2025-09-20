import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { CoreDocument } from '@/shared/infrastructure/repositories/model/mongodb';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({
    collection: 'webhook_logs',
    autoIndex: true,
    timestamps: true,
})
export class WebhookLogModel extends CoreDocument {
    @Prop({
        type: String,
        enum: PlatformType,
        required: true,
    })
    platform: PlatformType;

    @Prop({
        type: String,
        required: true,
    })
    event: string;

    @Prop({
        type: Object,
        required: true,
    })
    payload: Record<string, any>;

    @Prop({
        type: Object,
        required: false,
    })
    meta: Record<string, any>;
}

export const WebhookLogSchema = SchemaFactory.createForClass(WebhookLogModel);
WebhookLogSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 7 },
); // 7 days
