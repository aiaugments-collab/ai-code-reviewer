import { IssueStatus } from '@/config/types/general/issues.type';
import { IContributingSuggestion, IRepositoryToIssues } from '@/ee/kodyIssuesManagement/domain/kodyIssuesManagement.interface';
import { CoreDocument } from '@/shared/infrastructure/repositories/model/mongodb';
import { LabelType } from '@/shared/utils/codeManagement/labels';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({
    collection: 'issues',
    timestamps: true,
    autoIndex: true,
})

export class IssuesModel extends CoreDocument {
    @Prop({ type: String, required: true })
    public title: string;

    @Prop({ type: String, required: true })
    public description: string;

    @Prop({ type: String, required: true })
    public filePath: string;

    @Prop({ type: String, required: true })
    public language: string;

    @Prop({ type: String, required: true })
    public label: LabelType;

    @Prop({ type: String, required: true })
    public severity: SeverityLevel;

    @Prop({ type: String, required: true })
    public status: IssueStatus;

    @Prop({ type: Object, required: true })
    public contributingSuggestions: IContributingSuggestion[];

    @Prop({ type: Object, required: true })
    public repository: IRepositoryToIssues;

    @Prop({ type: String, required: true })
    public organizationId: string;
}

export const IssuesSchema = SchemaFactory.createForClass(IssuesModel);

// 1. Main - organization + status open
IssuesSchema.index(
    { organizationId: 1, createdAt: -1 },
    {
        partialFilterExpression: { status: 'open' },
        name: 'organization_open'
    }
);

// 2. By repository
IssuesSchema.index(
    { organizationId: 1, 'repository.name': 1, createdAt: -1 },
    {
        partialFilterExpression: { status: 'open' },
        name: 'organization_repository_open'
    }
);

// 3. Severity high or critical
IssuesSchema.index(
    { organizationId: 1, severity: 1, createdAt: -1 },
    {
        partialFilterExpression: {
            status: 'open',
            severity: { $in: ['critical', 'high'] }
        },
        name: 'organization_severity_high_critical_open'
    }
);

// 4. By label + severity
IssuesSchema.index(
    { organizationId: 1, label: 1, severity: 1, createdAt: -1 },
    {
        partialFilterExpression: { status: 'open' },
        name: 'organization_label_severity_open'
    }
);