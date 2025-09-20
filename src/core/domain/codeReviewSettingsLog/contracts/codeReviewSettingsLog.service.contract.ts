import { ICodeReviewSettingsLogRepository } from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.repository.contract';
import { CodeReviewConfigLogParams } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/codeReviewConfigLog.handler';
import { IntegrationLogParams } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/integrationLog.handler';
import { KodyRuleLogParams } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/kodyRulesLog.handler';
import { PullRequestMessagesLogParams } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/pullRequestMessageLog.handler';
import { RepositoriesLogParams, RepositoryConfigRemovalParams, DirectoryConfigRemovalParams } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/repositoriesLog.handler';
import { UserStatusLogParams } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/userStatusLog.handler';

export const CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN = Symbol(
    'CodeReviewSettingsLogService',
);

export interface ICodeReviewSettingsLogService
    extends ICodeReviewSettingsLogRepository {
    registerCodeReviewConfigLog(
        params: CodeReviewConfigLogParams,
    ): Promise<void>;
    registerKodyRulesLog(params: KodyRuleLogParams): Promise<void>;
    registerRepositoriesLog(params: RepositoriesLogParams): Promise<void>;
    registerRepositoryConfigurationRemoval(
        params: RepositoryConfigRemovalParams,
    ): Promise<void>;
    registerDirectoryConfigurationRemoval(
        params: DirectoryConfigRemovalParams,
    ): Promise<void>;
    registerIntegrationLog(params: IntegrationLogParams): Promise<void>;
    registerUserStatusLog(params: UserStatusLogParams): Promise<void>;
    registerPullRequestMessagesLog(
        params: PullRequestMessagesLogParams,
    ): Promise<void>;
}
