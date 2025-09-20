import { AxiosLicenseService } from '@/config/axios/microservices/license.axios';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import {
    ILicenseService,
    OrganizationLicenseValidationResult,
    UserWithLicense,
} from './interfaces/license.interface';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';

/**
 * LicenseService handles organization and user license validation via billing service endpoints.
 */
export class LicenseService implements ILicenseService {
    private readonly licenseRequest: AxiosLicenseService;

    constructor(private readonly logger: PinoLoggerService) {
        this.licenseRequest = new AxiosLicenseService();
    }

    /**
     * Validate organization license by calling the billing service endpoint.
     * @param organizationAndTeamData Organization and team identifiers
     * @returns Promise with license validation result
     */
    async validateOrganizationLicense(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<OrganizationLicenseValidationResult> {
        try {
            const response = await this.licenseRequest.get(
                'validate-org-license',
                {
                    params: {
                        organizationId: organizationAndTeamData.organizationId,
                        teamId: organizationAndTeamData.teamId,
                    },
                },
            );

            return response;
        } catch (error) {
            this.logger.error({
                message: 'ValidateOrganizationLicense not working',
                context: LicenseService.name,
                error: error,
                serviceName: 'LicenseService validateOrganizationLicense',
                metadata: {
                    ...organizationAndTeamData,
                },
            });
            return { valid: false };
        }
    }

    /**
     * Get all users with license by calling the billing service endpoint.
     * @param organizationAndTeamData Organization and team identifiers
     * @returns Promise with array of users with license
     */
    async getAllUsersWithLicense(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<UserWithLicense[]> {
        try {
            return await this.licenseRequest.get('users-with-license', {
                params: {
                    organizationId: organizationAndTeamData.organizationId,
                    teamId: organizationAndTeamData.teamId,
                },
            });
        } catch (error) {
            this.logger.error({
                message: 'GetAllUsersWithLicense not working',
                error: error,
                context: LicenseService.name,
                serviceName: 'LicenseService getAllUsersWithLicense',
                metadata: {
                    ...organizationAndTeamData,
                },
            });
            return [];
        }
    }
}
