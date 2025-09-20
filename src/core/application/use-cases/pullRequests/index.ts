import { SavePullRequestUseCase } from './save.use-case';
import { GetPullRequestAuthorsUseCase } from './get-pull-request-authors-orderedby-contributions.use-case';
import { UpdatePullRequestToNewFormatUseCase } from './update-pull-request-to-new-format.use-case';
import { GetEnrichedPullRequestsUseCase } from './get-enriched-pull-requests.use-case';

export const UseCases = [
    SavePullRequestUseCase,
    GetPullRequestAuthorsUseCase,
    UpdatePullRequestToNewFormatUseCase,
    GetEnrichedPullRequestsUseCase
];
