import { CodeReviewSettingsLogRepository } from '@/core/infrastructure/adapters/repositories/mongoose/codeReviewSettingsLog.repository';
import { CodeReviewSettingsLogModelInstance } from '@/core/infrastructure/adapters/repositories/mongoose/schema';
import { CodeReviewSettingsLogService } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/codeReviewSettingsLog.service';
import { KodyRulesLogHandler } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/kodyRulesLog.handler';
import { CODE_REVIEW_SETTINGS_LOG_REPOSITORY_TOKEN } from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.repository.contract';
import { CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN } from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.service.contract';
import { MongooseModule } from '@nestjs/mongoose';
import { forwardRef, Module } from '@nestjs/common';
import { UsersModule } from './user.module';
import { CodeReviewConfigLogHandler } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/codeReviewConfigLog.handler';
import { RepositoriesLogHandler } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/repositoriesLog.handler';
import { UnifiedLogHandler } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/unifiedLog.handler';
import { IntegrationConfigModule } from './integrationConfig.module';
import { TeamsModule } from './team.module';
import { CodeReviewSettingLogController } from '@/core/infrastructure/http/controllers/codeReviewSettingLog.controller';
import { RegisterUserStatusLogUseCase } from '@/core/application/use-cases/user/register-user-status-log.use-case';
import { FindCodeReviewSettingsLogsUseCase } from '@/core/application/use-cases/codeReviewSettingsLog/find-code-review-settings-logs.use-case';
import { UserStatusLogHandler } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/userStatusLog.handler';
import { IntegrationLogHandler } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/integrationLog.handler';
import { LogModule } from './log.module';
import { PullRequestMessagesLogHandler } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/pullRequestMessageLog.handler';
import { GetAdditionalInfoHelper } from '@/shared/utils/helpers/getAdditionalInfo.helper';
import { IntegrationModule } from './integration.module';
import { ParametersModule } from './parameters.module';

@Module({
    imports: [
        MongooseModule.forFeature([CodeReviewSettingsLogModelInstance]),
        forwardRef(() => UsersModule),
        forwardRef(() => IntegrationConfigModule),
        forwardRef(() => TeamsModule),
        forwardRef(() => ParametersModule),
        forwardRef(() => IntegrationModule),
        LogModule,
    ],
    providers: [
        {
            provide: CODE_REVIEW_SETTINGS_LOG_REPOSITORY_TOKEN,
            useClass: CodeReviewSettingsLogRepository,
        },
        {
            provide: CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN,
            useClass: CodeReviewSettingsLogService,
        },
        UnifiedLogHandler,
        CodeReviewConfigLogHandler,
        RepositoriesLogHandler,
        KodyRulesLogHandler,
        IntegrationLogHandler,
        UserStatusLogHandler,
        PullRequestMessagesLogHandler,
        RegisterUserStatusLogUseCase,
        FindCodeReviewSettingsLogsUseCase,
        GetAdditionalInfoHelper,
    ],
    exports: [
        CODE_REVIEW_SETTINGS_LOG_REPOSITORY_TOKEN,
        CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN,
        UnifiedLogHandler,
        CodeReviewConfigLogHandler,
        RepositoriesLogHandler,
        KodyRulesLogHandler,
        RegisterUserStatusLogUseCase,
        FindCodeReviewSettingsLogsUseCase,
        IntegrationLogHandler,
        UserStatusLogHandler,
        PullRequestMessagesLogHandler,
        GetAdditionalInfoHelper,
    ],
    controllers: [CodeReviewSettingLogController],
})
export class CodeReviewSettingsLogModule {}
