import {
    ConfigLevel,
    PullRequestMessageStatus,
    PullRequestMessageType,
} from '@/config/types/general/pullRequestMessages.type';
import { CoreDocument } from '@/shared/infrastructure/repositories/model/mongodb';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({
    collection: 'pullRequestMessages',
    timestamps: true,
    autoIndex: true,
})
export class PullRequestMessagesModel extends CoreDocument {
    @Prop({ type: String, required: true })
    organizationId: string;

    @Prop({ type: String, required: true, enum: ConfigLevel })
    configLevel: ConfigLevel;

    @Prop({ type: String, required: false })
    repositoryId: string;

    @Prop({
        type: {
            content: { type: String, required: false },
            status: {
                type: String,
                required: true,
                enum: PullRequestMessageStatus,
            },
        },
        _id: false,
        required: false,
    })
    startReviewMessage: {
        content: string;
        status: PullRequestMessageStatus;
    };

    @Prop({
        type: {
            content: { type: String, required: false },
            status: {
                type: String,
                required: true,
                enum: PullRequestMessageStatus,
            },
        },
        _id: false,
        required: false,
    })
    endReviewMessage: {
        content: string;
        status: PullRequestMessageStatus;
    };

    @Prop({ type: String, required: false })
    directoryId: string;
}

export const PullRequestMessagesSchema = SchemaFactory.createForClass(
    PullRequestMessagesModel,
);
