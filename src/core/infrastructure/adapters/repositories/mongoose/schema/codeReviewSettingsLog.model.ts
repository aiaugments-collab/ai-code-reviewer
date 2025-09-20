import {
    ActionType,
    ChangedData,
    ConfigLevel,
} from '@/config/types/general/codeReviewSettingsLog.type';
import { CoreDocument } from '@/shared/infrastructure/repositories/model/mongodb';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({
    collection: 'codeReviewSettingsLog',
    timestamps: true,
    autoIndex: true,
})
export class CodeReviewSettingsLogModel extends CoreDocument {
    @Prop({ type: String, required: true })
    organizationId: string;

    @Prop({ type: String, required: false })
    teamId: string;

    @Prop({ type: String, required: true, enum: ActionType })
    action: ActionType;

    @Prop({ type: Object, required: true })
    userInfo: {
        userId: string;
        userEmail: string;
    };

    @Prop({ type: String, required: false, enum: ConfigLevel })
    configLevel: ConfigLevel;

    @Prop({ type: Object, required: false })
    repository: {
        id: string;
        name?: string;
    };

    @Prop({ type: Object, required: false })
    directory: {
        id: string;
        path?: string;
    };

    @Prop({ type: [Object], required: true })
    changedData: ChangedData[];
}

export const CodeReviewSettingsLogSchema = SchemaFactory.createForClass(
    CodeReviewSettingsLogModel,
);
