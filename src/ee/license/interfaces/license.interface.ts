/**
 * Interface and types for license service.
 */

import { OrganizationAndTeamData } from "@/config/types/general/organizationAndTeamData";

export enum SubscriptionStatus {
    TRIAL = 'trial',
    ACTIVE = 'active',
    PAYMENT_FAILED = 'payment_failed',
    CANCELED = 'canceled',
    EXPIRED = 'expired',
    SELF_HOSTED = 'self-hosted',
}

export type OrganizationLicenseValidationResult = {
    valid: boolean;
    subscriptionStatus?: SubscriptionStatus;
    trialEnd?: Date;
    numberOfLicenses?: number;
};

export type UserWithLicense = {
    git_id: string;
};

export const LICENSE_SERVICE_TOKEN = Symbol('LicenseService');

export interface ILicenseService {
    /**
     * Validate organization license.
     *
     * @param organizationAndTeamData Organization ID and team ID.
     * @returns Promise with validation result.
     */
    validateOrganizationLicense(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<OrganizationLicenseValidationResult>;

    /**
     * Get all users with license.
     *
     * @param params Organization ID and team ID.
     * @returns Promise with array of users with license.
     */
    getAllUsersWithLicense(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<UserWithLicense[]>;
}
