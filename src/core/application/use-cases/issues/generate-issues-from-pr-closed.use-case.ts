import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN } from '@/core/domain/codeBase/contracts/KodyIssuesManagement.contract';
import {
    IIntegrationConfigService,
    INTEGRATION_CONFIG_SERVICE_TOKEN,
} from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { stripCurlyBracesFromUUIDs } from '@/core/domain/platformIntegrations/types/webhooks/webhooks-bitbucket.type';
import {
    IMappedPullRequest,
    IMappedRepository,
} from '@/core/domain/platformIntegrations/types/webhooks/webhooks-common.type';
import {
    IPullRequestsService,
    PULL_REQUESTS_SERVICE_TOKEN,
} from '@/core/domain/pullRequests/contracts/pullRequests.service.contracts';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import {
    contextToGenerateIssues,
    IRepositoryToIssues,
} from '@/ee/kodyIssuesManagement/domain/kodyIssuesManagement.interface';
import { KodyIssuesManagementService } from '@/ee/kodyIssuesManagement/service/kodyIssuesManagement.service';
import { IntegrationConfigKey } from '@/shared/domain/enums/Integration-config-key.enum';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { getMappedPlatform } from '@/shared/utils/webhooks';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GenerateIssuesFromPrClosedUseCase implements IUseCase {
    constructor(
        @Inject(KODY_ISSUES_MANAGEMENT_SERVICE_TOKEN)
        private readonly kodyIssuesManagementService: KodyIssuesManagementService,

        @Inject(PULL_REQUESTS_SERVICE_TOKEN)
        private readonly pullRequestService: IPullRequestsService,

        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IIntegrationConfigService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(params: any): Promise<void> {
        const normalizedPayload = await this.normalizePayload(params);

        if (!normalizedPayload) {
            return;
        }

        const prData = await this.fillProperties(normalizedPayload);

        try {
            if (params?.platformType === PlatformType.AZURE_REPOS) {
                if (normalizedPayload?.pullRequest?.status !== 'completed') {
                    return;
                }
            }

            const pr = await this.pullRequestService.findByNumberAndRepositoryName(
                prData.context.pullRequest.number,
                prData.context.repository.name,
                {
                    organizationId:
                        prData.context.organizationAndTeamData.organizationId,
                },
            );

            if (!pr) {
                return;
            }

            const prFiles = pr.files;

            if (prFiles.length === 0) {
                return;
            }

            await this.kodyIssuesManagementService.processClosedPr({
                organizationAndTeamData: prData.context.organizationAndTeamData,
                pullRequest: prData.context.pullRequest,
                repository: prData.context.repository,
                prFiles: prFiles,
            });

            await this.kodyIssuesManagementService.clearIssuesCache(
                prData.context?.organizationAndTeamData?.organizationId,
            );
        } catch (error) {
            this.logger.error({
                context: GenerateIssuesFromPrClosedUseCase.name,
                serviceName: GenerateIssuesFromPrClosedUseCase.name,
                message: `Error processing closed pull request #${prData.context.pullRequest.number}: ${error.message}`,
                metadata: {
                    prNumber: prData.context.pullRequest.number,
                    repositoryId: prData.context.repository.id,
                    organizationId:
                        prData.context?.organizationAndTeamData?.organizationId,
                },
                error,
            });
        }
    }

    private async normalizePayload(params: any): Promise<{
        pullRequest: IMappedPullRequest;
        repository: IMappedRepository;
        platformType: PlatformType;
    } | null> {
        const { payload, platformType } = params;

        const sanitizedPayload =
            platformType === PlatformType.BITBUCKET
                ? stripCurlyBracesFromUUIDs(payload)
                : payload;

        const mappedPlatform = getMappedPlatform(platformType);

        if (!mappedPlatform) {
            return;
        }

        let pullRequest = mappedPlatform.mapPullRequest({
            payload: sanitizedPayload,
        });

        if (
            !pullRequest &&
            !pullRequest?.number &&
            !pullRequest?.repository &&
            !pullRequest?.user
        ) {
            return;
        }

        const repository = mappedPlatform.mapRepository({
            payload: sanitizedPayload,
        });

        if (!repository && !repository?.id && !repository?.name) {
            return;
        }

        return {
            pullRequest,
            repository,
            platformType,
        };
    }

    private async fillProperties(params: any): Promise<{
        context: contextToGenerateIssues;
    }> {
        const pullRequest = params?.pullRequest;
        const repositoryId = params?.repository?.id?.toString();
        const repositoryName = params?.repository?.name;
        const repositoryFullName = params?.repository?.fullName;
        const platformType = params?.platformType;

        const organizationAndTeamData = await this.getOrganizationAndTeamData(
            Number(pullRequest.number),
            params?.repository,
            platformType,
        );

        return {
            context: {
                pullRequest,
                repository: {
                    id: repositoryId,
                    name: repositoryName,
                    full_name: repositoryFullName,
                    platform: platformType,
                },
                organizationAndTeamData,
            },
        };
    }

    private async getOrganizationAndTeamData(
        prNumber: number,
        repository: IRepositoryToIssues,
        platformType: PlatformType,
    ): Promise<OrganizationAndTeamData | null> {
        const configs =
            await this.integrationConfigService.findIntegrationConfigWithTeams(
                IntegrationConfigKey.REPOSITORIES,
                repository.id,
                platformType,
            );

        if (!configs || !configs.length) {
            this.logger.warn({
                message: `No repository configuration found for repository ${repository?.name}`,
                context: GenerateIssuesFromPrClosedUseCase.name,
                metadata: {
                    prNumber: prNumber,
                    repositoryId: repository?.id,
                    repositoryName: repository?.name,
                },
            });

            return null;
        }

        const organizationAndTeamData: OrganizationAndTeamData[] = configs.map(
            (config) => ({
                organizationId: config.team.organization.uuid,
                teamId: config.team.uuid,
            }),
        );

        return organizationAndTeamData?.[0] || null;
    }
}
