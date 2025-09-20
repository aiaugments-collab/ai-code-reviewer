import { Inject, Injectable } from '@nestjs/common';
import { ProgrammingLanguage } from '@/shared/domain/enums/programming-language.enum';
import {
    IRuleLikeService,
    RULE_LIKE_SERVICE_TOKEN,
} from '@/core/domain/kodyRules/contracts/ruleLike.service.contract';

@Injectable()
export class GetTopRulesByLanguageUseCase {
    constructor(
        @Inject(RULE_LIKE_SERVICE_TOKEN)
        private readonly ruleLikeService: IRuleLikeService,
    ) {}

    async execute(
        language: ProgrammingLanguage,
        limit?: number,
    ): Promise<{ ruleId: string; count: number }[]> {
        return this.ruleLikeService.topByLanguage(language, limit);
    }
}
