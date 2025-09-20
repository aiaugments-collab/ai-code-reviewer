import { Inject, Injectable } from '@nestjs/common';
import { ProgrammingLanguage } from '@/shared/domain/enums/programming-language.enum';
import {
    IRuleLikeRepository,
    RULE_LIKES_REPOSITORY_TOKEN,
} from '@/core/domain/kodyRules/contracts/ruleLike.repository.contract';
import { RuleLikeEntity, RuleFeedbackType } from '@/core/domain/kodyRules/entities/ruleLike.entity';
import { IRuleLikeService } from '@/core/domain/kodyRules/contracts/ruleLike.service.contract';

@Injectable()
export class RuleLikesService implements IRuleLikeService {
    constructor(
        @Inject(RULE_LIKES_REPOSITORY_TOKEN)
        private readonly likesRepo: IRuleLikeRepository,
    ) {}

    getNativeCollection() {
        return this.likesRepo.getNativeCollection();
    }

    async setFeedback(
        ruleId: string,
        feedback: RuleFeedbackType,
        userId?: string,
    ): Promise<RuleLikeEntity | null> {
        return this.likesRepo.setFeedback(
            ruleId,
            feedback,
            userId,
        );
    }

    async countByRule(ruleId: string): Promise<number> {
        return this.likesRepo.countByRule(ruleId);
    }

    async topByLanguage(
        language: ProgrammingLanguage,
        limit = 10,
    ): Promise<{ ruleId: string; count: number }[]> {
        return this.likesRepo.topByLanguage(language, limit);
    }

    async findOne(
        filter?: Partial<RuleLikeEntity>,
    ): Promise<RuleLikeEntity | null> {
        return this.likesRepo.findOne(filter);
    }

    async find(filter?: Partial<RuleLikeEntity>): Promise<RuleLikeEntity[]> {
        return this.likesRepo.find(filter);
    }

    async getAllLikes(): Promise<RuleLikeEntity[]> {
        return this.likesRepo.getAllLikes();
    }

    async getAllRulesWithFeedback(
        userId?: string,
    ): Promise<{ ruleId: string; positiveCount: number; negativeCount: number; userFeedback: RuleFeedbackType | null }[]> {
        return this.likesRepo.getAllRulesWithFeedback(userId);
    }

    async removeFeedback(ruleId: string, userId?: string): Promise<boolean> {
        return this.likesRepo.unlike(ruleId, userId);
    }
}
