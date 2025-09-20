import { IKodyRulesRepository } from './kodyRules.repository.contract';
import { CreateKodyRuleDto } from '@/core/infrastructure/http/dtos/create-kody-rule.dto';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { IKodyRule, KodyRulesStatus } from '../interfaces/kodyRules.interface';
import { KodyRulesEntity } from '../entities/kodyRules.entity';
import {
    KodyRuleFilters,
    LibraryKodyRule,
    BucketInfo,
} from '@/config/types/kodyRules.type';
import { UserInfo } from '@/config/types/general/codeReviewSettingsLog.type';

export const KODY_RULES_SERVICE_TOKEN = 'KODY_RULES_SERVICE_TOKEN';

export interface IKodyRulesService extends IKodyRulesRepository {
    createOrUpdate(
        organizationAndTeamData: OrganizationAndTeamData,
        kodyRule: CreateKodyRuleDto,
        userInfo?: UserInfo,
    ): Promise<Partial<IKodyRule> | IKodyRule | null>;

    getLibraryKodyRules(
        filters?: KodyRuleFilters,
        userId?: string,
    ): Promise<LibraryKodyRule[]>;
    getLibraryKodyRulesWithFeedback(
        filters?: KodyRuleFilters,
        userId?: string,
    ): Promise<LibraryKodyRule[]>;

    getLibraryKodyRulesBuckets(): Promise<BucketInfo[]>;

    findRulesByDirectory(
        organizationId: string,
        repositoryId: string,
        directoryId: string,
    ): Promise<Partial<IKodyRule>[]>;
    updateRulesStatusByFilter(
        organizationId: string,
        repositoryId: string,
        directoryId?: string,
        newStatus?: KodyRulesStatus,
    ): Promise<KodyRulesEntity | null>;

    deleteRuleWithLogging(
        organizationAndTeamData: OrganizationAndTeamData,
        ruleId: string,
        userInfo: UserInfo,
    ): Promise<boolean>;

    updateRuleWithLogging(
        organizationAndTeamData: OrganizationAndTeamData,
        kodyRule: CreateKodyRuleDto,
        userInfo?: UserInfo,
    ): Promise<Partial<IKodyRule> | IKodyRule | null>;
}
