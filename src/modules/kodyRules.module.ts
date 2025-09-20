import { UseCases } from '@/core/application/use-cases/kodyRules';
import { KODY_RULES_REPOSITORY_TOKEN } from '@/core/domain/kodyRules/contracts/kodyRules.repository.contract';
import { KODY_RULES_SERVICE_TOKEN } from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import {
    KodyRulesModel,
    KodyRulesSchema,
} from '@/core/infrastructure/adapters/repositories/mongoose/schema/kodyRules.model';
import { KodyRulesController } from '@/core/infrastructure/http/controllers/kodyRules.controller';
import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlatformIntegrationModule } from './platformIntegration.module';
import { CodebaseModule } from './codeBase.module';
import { GenerateKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/generate-kody-rules.use-case';
import { FindRulesInOrganizationByRuleFilterKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/find-rules-in-organization-by-filter.use-case';
import { ChangeStatusKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/change-status-kody-rules.use-case';
import { IntegrationConfigModule } from './integrationConfig.module';
import { IntegrationModule } from './integration.module';
import { ParametersModule } from './parameters.module';
import { CreateOrUpdateKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/create-or-update.use-case';
import { KodyRulesValidationModule } from '@/ee/kodyRules/kody-rules-validation.module';
import { KodyRulesService } from '@/ee/kodyRules/service/kodyRules.service';
import { KodyRulesRepository } from '@/ee/kodyRules/repository/kodyRules.repository';
import { KodyRulesValidationService } from '@/ee/kodyRules/service/kody-rules-validation.service';
import { KodyRulesSyncService } from '@/core/infrastructure/adapters/services/kodyRules/kodyRulesSync.service';
import { SendRulesNotificationUseCase } from '@/core/application/use-cases/kodyRules/send-rules-notification.use-case';
import { SyncSelectedRepositoriesKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/sync-selected-repositories.use-case';
import { UsersModule } from './user.module';
import { OrganizationModule } from './organization.module';
import { CodeReviewSettingsLogModule } from './codeReviewSettingsLog.module';
import { GlobalCacheModule } from './cache.module';
import { RuleLikeModule } from './ruleLike.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: KodyRulesModel.name,
                schema: KodyRulesSchema,
            },
        ]),
        forwardRef(() => PlatformIntegrationModule),
        forwardRef(() => CodebaseModule),
        forwardRef(() => IntegrationConfigModule),
        forwardRef(() => IntegrationModule),
        forwardRef(() => ParametersModule),
        forwardRef(() => UsersModule),
        forwardRef(() => OrganizationModule),
        forwardRef(() => CodeReviewSettingsLogModule),
        forwardRef(() => RuleLikeModule),
        KodyRulesValidationModule,
        GlobalCacheModule,
    ],
    providers: [
        ...UseCases,
        {
            provide: KODY_RULES_REPOSITORY_TOKEN,
            useClass: KodyRulesRepository,
        },
        {
            provide: KODY_RULES_SERVICE_TOKEN,
            useClass: KodyRulesService,
        },
        KodyRulesValidationService,
        KodyRulesSyncService,
    ],
    controllers: [KodyRulesController],
    exports: [
        KODY_RULES_REPOSITORY_TOKEN,
        KODY_RULES_SERVICE_TOKEN,
        GenerateKodyRulesUseCase,
        FindRulesInOrganizationByRuleFilterKodyRulesUseCase,
        ChangeStatusKodyRulesUseCase,
        CreateOrUpdateKodyRulesUseCase,
        SendRulesNotificationUseCase,
        KodyRulesValidationService,
        KodyRulesSyncService,
        SyncSelectedRepositoriesKodyRulesUseCase,
    ],
})
export class KodyRulesModule {}
