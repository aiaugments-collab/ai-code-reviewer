import {
    ReviewOptions,
    reviewOptionsSchema,
} from '@/config/types/general/codeReview.type';
import {
    SeverityLevel,
    severityLevelSchema,
} from '@/shared/utils/enums/severityLevel.enum';
import z from 'zod';

export interface UncategorizedComment {
    id: string;
    body: string;
    language: string;
}

export interface CategorizedComment {
    id: string;
    body: string;
    category: keyof ReviewOptions;
    severity: SeverityLevel;
}

export const categorizedCommentSchema = z.object({
    id: z.string(),
    body: z.string(),
    category: reviewOptionsSchema.keyof(),
    severity: severityLevelSchema,
});

export type CommentFrequency = {
    categories: {
        [key in keyof ReviewOptions]: number;
    };
    severity: {
        [key in SeverityLevel]: number;
    };
};

export enum AlignmentLevel {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
}
