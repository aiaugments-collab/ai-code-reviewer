import { CountRuleLikesUseCase } from './count-rule-likes.use-case';
import { FindRuleLikesUseCase } from './find-rule-likes.use-case';
import { GetAllRuleLikesUseCase } from './get-all-rules-likes.use-case';
import { GetAllRulesWithLikesUseCase } from './get-all-rules-with-likes.use-case';
import { GetTopRulesByLanguageUseCase } from './get-top-rules-by-language.use-case';
import { RemoveRuleLikeUseCase } from './remove-rule-like.use-case';
import { SetRuleLikeUseCase } from './set-rule-like.use-case';

export const UseCases = [
    CountRuleLikesUseCase,
    FindRuleLikesUseCase,
    GetAllRuleLikesUseCase,
    GetTopRulesByLanguageUseCase,
    RemoveRuleLikeUseCase,
    SetRuleLikeUseCase,
    GetAllRulesWithLikesUseCase,
];
