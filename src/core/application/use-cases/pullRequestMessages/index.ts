import { CreateOrUpdatePullRequestMessagesUseCase } from './create-or-update-pull-request-messages.use-case';
import { FindByRepositoryIdPullRequestMessagesUseCase } from './find-by-repository-id.use-case';
import { FindByIdPullRequestMessagesUseCase } from './find-by-id.use-case';
import { FindByDirectoryIdPullRequestMessagesUseCase } from './find-by-directory-id.use-case';
import { DeleteByRepositoryOrDirectoryPullRequestMessagesUseCase } from './delete-by-repository-or-directory.use-case';

export const PullRequestMessagesUseCases = [
    CreateOrUpdatePullRequestMessagesUseCase,
    FindByRepositoryIdPullRequestMessagesUseCase,
    FindByIdPullRequestMessagesUseCase,
    FindByDirectoryIdPullRequestMessagesUseCase,
    DeleteByRepositoryOrDirectoryPullRequestMessagesUseCase,
];
