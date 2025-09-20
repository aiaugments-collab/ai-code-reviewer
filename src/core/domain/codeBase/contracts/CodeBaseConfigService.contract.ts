import { CodeReviewConfig } from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';

export const CODE_BASE_CONFIG_SERVICE_TOKEN = Symbol('CodeBaseConfigService');

export interface ICodeBaseConfigService {
    getConfig(
        organizationAndTeamData: OrganizationAndTeamData,
        repository: { name: string; id: string },
        ignoreKodusConfigFile?: boolean,
    ): Promise<CodeReviewConfig>;
    getCodeManagementAuthenticationPlatform(
        organizationAndTeamData: OrganizationAndTeamData,
    );
    getCodeManagementPatConfigAndRepositories(
        organizationAndTeamData: OrganizationAndTeamData,
    );
    getCodeManagementConfigAndRepositories(
        organizationAndTeamData: OrganizationAndTeamData,
    );
    getDefaultConfigs(): CodeReviewConfig;

    resolveConfigByDirectories(
        organizationAndTeamData: OrganizationAndTeamData,
        repository: { name: string; id: string },
        affectedPaths: string[],
        repoConfig: any,
    ): Promise<CodeReviewConfig>;

    getDirectoryConfigs(
        organizationAndTeamData: OrganizationAndTeamData,
        repository: { id: string; name: string },
    ): Promise<{ hasConfigs: boolean; repoConfig?: any; parameters?: any }>;

    extractUniqueDirectoryPaths(files: { filename: string }[]): string[];
}
