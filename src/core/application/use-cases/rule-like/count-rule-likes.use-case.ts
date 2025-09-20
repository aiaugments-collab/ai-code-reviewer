import { Inject, Injectable } from '@nestjs/common';
import { IRuleLikeService, RULE_LIKE_SERVICE_TOKEN } from '@/core/domain/kodyRules/contracts/ruleLike.service.contract';

@Injectable()
export class CountRuleLikesUseCase {
    constructor(
        @Inject(RULE_LIKE_SERVICE_TOKEN)
        private readonly ruleLikeService: IRuleLikeService) {}

    async execute(ruleId: string): Promise<number> {
        return this.ruleLikeService.countByRule(ruleId);
    }
} 