import { AddLibraryKodyRulesUseCase } from './add-library-kody-rules.use-case';
import { ChangeStatusKodyRulesUseCase } from './change-status-kody-rules.use-case';
import { CheckSyncStatusUseCase } from './check-sync-status.use-case';
import { CreateOrUpdateKodyRulesUseCase } from './create-or-update.use-case';
import { DeleteByOrganizationIdKodyRulesUseCase } from './delete-by-organization-id.use-case';
import { DeleteRuleInOrganizationByIdKodyRulesUseCase } from './delete-rule-in-organization-by-id.use-case';
import { FindByOrganizationIdKodyRulesUseCase } from './find-by-organization-id.use-case';
import { FindLibraryKodyRulesUseCase } from './find-library-kody-rules.use-case';
import { FindLibraryKodyRulesWithFeedbackUseCase } from './find-library-kody-rules-with-feedback.use-case';
import { FindLibraryKodyRulesBucketsUseCase } from './find-library-kody-rules-buckets.use-case';
import { FindRuleInOrganizationByRuleIdKodyRulesUseCase } from './find-rule-in-organization-by-id.use-case';
import { FindRulesInOrganizationByRuleFilterKodyRulesUseCase } from './find-rules-in-organization-by-filter.use-case';
import { GenerateKodyRulesUseCase } from './generate-kody-rules.use-case';
import { SendRulesNotificationUseCase } from './send-rules-notification.use-case';
import { SyncSelectedRepositoriesKodyRulesUseCase } from './sync-selected-repositories.use-case';

export const UseCases = [
    CreateOrUpdateKodyRulesUseCase,
    FindByOrganizationIdKodyRulesUseCase,
    FindRuleInOrganizationByRuleIdKodyRulesUseCase,
    FindRulesInOrganizationByRuleFilterKodyRulesUseCase,
    DeleteByOrganizationIdKodyRulesUseCase,
    DeleteRuleInOrganizationByIdKodyRulesUseCase,
    FindLibraryKodyRulesUseCase,
    FindLibraryKodyRulesWithFeedbackUseCase,
    FindLibraryKodyRulesBucketsUseCase,
    AddLibraryKodyRulesUseCase,
    GenerateKodyRulesUseCase,
    ChangeStatusKodyRulesUseCase,
    SendRulesNotificationUseCase,
    SyncSelectedRepositoriesKodyRulesUseCase,
    CheckSyncStatusUseCase,
];
