import { RuleLikeEntity, RuleFeedbackType } from '../entities/ruleLike.entity';
import { FilterQuery } from 'mongoose';
import { RuleLikeModel } from '@/core/infrastructure/adapters/repositories/mongoose/schema/rulesLikes.model';

export interface IRuleLike {
    _id?: string;
    language: string;
    ruleId: string;
    userId?: string;
    feedback: RuleFeedbackType;
}

export const RULE_LIKES_REPOSITORY_TOKEN = Symbol('RuleLikesRepository');

export interface IRuleLikeRepository {
    getNativeCollection(): any;

    setFeedback(
        ruleId: string,
        feedback: RuleFeedbackType,
        userId?: string,
    ): Promise<RuleLikeEntity | null>;

    findOne(filter?: Partial<IRuleLike>): Promise<RuleLikeEntity | null>;

    find(filter?: FilterQuery<RuleLikeModel>): Promise<RuleLikeEntity[]>;

    countByRule(ruleId: string): Promise<number>;

    topByLanguage(
        language: string,
        limit?: number,
    ): Promise<{ ruleId: string; count: number }[]>;

    getAllLikes(): Promise<RuleLikeEntity[]>;

    getAllRulesWithFeedback(
        userId?: string,
    ): Promise<{ ruleId: string; positiveCount: number; negativeCount: number; userFeedback: RuleFeedbackType | null }[]>;

    unlike(ruleId: string, userId?: string): Promise<boolean>;
}
