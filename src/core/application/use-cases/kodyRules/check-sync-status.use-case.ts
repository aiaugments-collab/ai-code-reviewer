import { CommentAnalysisService } from '@/core/infrastructure/adapters/services/codeBase/commentAnalysis.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { GenerateKodyRulesDTO } from '@/core/infrastructure/http/dtos/generate-kody-rules.dto';
import { Inject, Injectable } from '@nestjs/common';

import { CreateOrUpdateKodyRulesUseCase } from './create-or-update.use-case';
import {
    CreateKodyRuleDto,
    KodyRuleSeverity,
} from '@/core/infrastructure/http/dtos/create-kody-rule.dto';
import {
    IKodyRule,
    KodyRulesStatus,
} from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import { FindRulesInOrganizationByRuleFilterKodyRulesUseCase } from './find-rules-in-organization-by-filter.use-case';
import { generateDateFilter } from '@/shared/utils/transforms/date';
import {
    IIntegrationConfigService,
    INTEGRATION_CONFIG_SERVICE_TOKEN,
} from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import {
    IIntegrationService,
    INTEGRATION_SERVICE_TOKEN,
} from '@/core/domain/integrations/contracts/integration.service.contracts';
import { IntegrationConfigKey } from '@/shared/domain/enums/Integration-config-key.enum';
import { Repositories } from '@/core/domain/platformIntegrations/types/codeManagement/repositories.type';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { KodyLearningStatus } from '@/core/domain/parameters/types/configValue.type';
import { ParametersEntity } from '@/core/domain/parameters/entities/parameters.entity';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { SendRulesNotificationUseCase } from './send-rules-notification.use-case';
import { REQUEST } from '@nestjs/core';
import {
    ICodeRepository,
    ICodeReviewParameter,
    IRepositoryCodeReviewConfig,
} from '@/config/types/general/codeReviewConfig.type';

@Injectable()
export class CheckSyncStatusUseCase {
    constructor(
        @Inject(INTEGRATION_SERVICE_TOKEN)
        private readonly integrationService: IIntegrationService,

        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IIntegrationConfigService,

        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,

        private readonly findRulesInOrganizationByRuleFilterKodyRulesUseCase: FindRulesInOrganizationByRuleFilterKodyRulesUseCase,

        private readonly logger: PinoLoggerService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string } };
        },
    ) {}

    async execute(
        teamId: string,
        repositoryId?: string,
    ): Promise<{
        ideRulesSyncEnabledFirstTime: boolean;
        kodyRulesGeneratorEnabledFirstTime: boolean;
    }> {
        const syncStatusFlags = {
            ideRulesSyncEnabledFirstTime: true,
            kodyRulesGeneratorEnabledFirstTime: true,
        };

        const organizationAndTeamData = {
            organizationId: this.request.user.organization.uuid,
            teamId: teamId,
        };

        const platformConfig = await this.parametersService.findByKey(
            ParametersKey.PLATFORM_CONFIGS,
            organizationAndTeamData,
        );

        try {
            const codeReviewConfigs: ICodeReviewParameter =
                await this.getCodeReviewConfigs(organizationAndTeamData);

            const currentRepositoryConfig = codeReviewConfigs.repositories.find(
                (repository: IRepositoryCodeReviewConfig) =>
                    repository.id === repositoryId,
            ) as IRepositoryCodeReviewConfig;

            // Se não encontrou o repositório, retorna configuração padrão
            if (!currentRepositoryConfig) {
                return syncStatusFlags;
            }

            const ideRulesSyncEnabled =
                currentRepositoryConfig.ideRulesSyncEnabled;

            if (!ideRulesSyncEnabled) {
                const rules =
                    await this.findRulesInOrganizationByRuleFilterKodyRulesUseCase.execute(
                        organizationAndTeamData.organizationId,
                        {},
                        repositoryId,
                    );

                const ideRules = rules.find((rule) =>
                    rule.rules.find((r: IKodyRule) => r.sourcePath),
                );

                syncStatusFlags.ideRulesSyncEnabledFirstTime = !ideRules;
            }

            const kodyRulesGeneratorEnabled =
                currentRepositoryConfig.kodyRulesGeneratorEnabled;

            if (
                platformConfig.configValue.kodyLearningStatus ===
                KodyLearningStatus.DISABLED
            ) {
                syncStatusFlags.kodyRulesGeneratorEnabledFirstTime = false;
            } else {
                syncStatusFlags.kodyRulesGeneratorEnabledFirstTime =
                    kodyRulesGeneratorEnabled;
            }

            return syncStatusFlags;
        } catch (error) {
            this.logger.error({
                message: 'Error checking sync status',
                error,
                context: CheckSyncStatusUseCase.name,
                metadata: {
                    organizationId: this.request.user.organization.uuid,
                    teamId,
                    repositoryId,
                },
            });

            return syncStatusFlags;
        }
    }

    private async getCodeReviewConfigs(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<ICodeReviewParameter> {
        const codeReviewConfig = await this.parametersService.findByKey(
            ParametersKey.CODE_REVIEW_CONFIG,
            organizationAndTeamData,
        );

        return codeReviewConfig?.configValue;
    }

    private async getFormattedRepositories(
        organizationAndTeamData: OrganizationAndTeamData,
    ) {
        return await this.integrationConfigService.findIntegrationConfigFormatted<
            ICodeRepository[]
        >(IntegrationConfigKey.REPOSITORIES, organizationAndTeamData);
    }
}
