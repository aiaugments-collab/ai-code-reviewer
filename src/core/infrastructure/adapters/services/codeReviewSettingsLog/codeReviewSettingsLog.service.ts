import { Inject, Injectable } from '@nestjs/common';
import { ICodeReviewSettingsLogService } from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.service.contract';
import {
    CODE_REVIEW_SETTINGS_LOG_REPOSITORY_TOKEN,
    ICodeReviewSettingsLogRepository,
} from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.repository.contract';
import { CodeReviewSettingsLogEntity } from '@/core/domain/codeReviewSettingsLog/entities/codeReviewSettingsLog.entity';
import { ICodeReviewSettingsLog } from '@/core/domain/codeReviewSettingsLog/interfaces/codeReviewSettingsLog.interface';

// Handlers
import { KodyRuleLogParams, KodyRulesLogHandler } from './kodyRulesLog.handler';
import {
    CodeReviewConfigLogHandler,
    CodeReviewConfigLogParams,
} from './codeReviewConfigLog.handler';
import {
    RepositoriesLogHandler,
    RepositoriesLogParams,
    RepositoryConfigRemovalParams,
    DirectoryConfigRemovalParams,
} from './repositoriesLog.handler';
import {
    IntegrationLogHandler,
    IntegrationLogParams,
} from './integrationLog.handler';
import {
    UserStatusLogHandler,
    UserStatusLogParams,
} from './userStatusLog.handler';
import { PullRequestMessagesLogHandler, PullRequestMessagesLogParams } from './pullRequestMessageLog.handler';

@Injectable()
export class CodeReviewSettingsLogService
    implements ICodeReviewSettingsLogService
{
    constructor(
        @Inject(CODE_REVIEW_SETTINGS_LOG_REPOSITORY_TOKEN)
        private readonly codeReviewSettingsLogRepository: ICodeReviewSettingsLogRepository,

        private readonly kodyRulesLogHandler: KodyRulesLogHandler,
        private readonly codeReviewConfigLogHandler: CodeReviewConfigLogHandler,
        private readonly repositoriesLogHandler: RepositoriesLogHandler,
        private readonly integrationLogHandler: IntegrationLogHandler,
        private readonly userStatusLogHandler: UserStatusLogHandler,
        private readonly pullRequestMessagesLogHandler: PullRequestMessagesLogHandler,
    ) {}

    async create(
        codeReviewSettingsLog: Omit<ICodeReviewSettingsLog, 'uuid'>,
    ): Promise<CodeReviewSettingsLogEntity> {
        return this.codeReviewSettingsLogRepository.create(
            codeReviewSettingsLog,
        );
    }

    async find(
        filter?: Partial<ICodeReviewSettingsLog>,
    ): Promise<CodeReviewSettingsLogEntity[]> {
        return this.codeReviewSettingsLogRepository.find(filter);
    }

    // Kody Rules
    public async registerKodyRulesLog(
        params: KodyRuleLogParams,
    ): Promise<void> {
        await this.kodyRulesLogHandler.logKodyRuleAction(params);
    }

    // Code Review Config
    public async registerCodeReviewConfigLog(
        params: CodeReviewConfigLogParams,
    ): Promise<void> {
        await this.codeReviewConfigLogHandler.logCodeReviewConfig(params);
    }

    // Repositories
    public async registerRepositoriesLog(
        params: RepositoriesLogParams,
    ): Promise<void> {
        await this.repositoriesLogHandler.logRepositoriesAction(params);
    }

    public async registerRepositoryConfigurationRemoval(
        params: RepositoryConfigRemovalParams,
    ): Promise<void> {
        await this.repositoriesLogHandler.logRepositoryConfigurationRemoval(
            params,
        );
    }

    public async registerDirectoryConfigurationRemoval(
        params: DirectoryConfigRemovalParams,
    ): Promise<void> {
        await this.repositoriesLogHandler.logDirectoryConfigurationRemoval(
            params,
        );
    }

    // Integrations
    public async registerIntegrationLog(
        params: IntegrationLogParams,
    ): Promise<void> {
        await this.integrationLogHandler.logIntegrationAction(params);
    }

    // User Status
    public async registerUserStatusLog(
        params: UserStatusLogParams,
    ): Promise<void> {
        await this.userStatusLogHandler.logUserStatusChanges(params);
    }

    // Pull Request Messages
    public async registerPullRequestMessagesLog(
        params: PullRequestMessagesLogParams,
    ): Promise<void> {
        await this.pullRequestMessagesLogHandler.logPullRequestMessagesAction(
            params,
        );
    }
}
