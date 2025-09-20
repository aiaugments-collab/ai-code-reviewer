import {
    IOrganizationService,
    ORGANIZATION_SERVICE_TOKEN,
} from '@/core/domain/organization/contracts/organization.service.contract';
import { OrganizationEntity } from '@/core/domain/organization/entities/organization.entity';
import { IOrganization } from '@/core/domain/organization/interfaces/organization.interface';
import {
    IOrganizationParametersService,
    ORGANIZATION_PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/organizationParameters/contracts/organizationParameters.service.contract';
import { OrganizationParametersAutoJoinConfig } from '@/core/domain/organizationParameters/types/organizationParameters.types';
import { Role } from '@/core/domain/permissions/enums/permissions.enum';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { OrganizationParametersKey } from '@/shared/domain/enums/organization-parameters-key.enum';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetOrganizationsByDomainUseCase implements IUseCase {
    constructor(
        @Inject(ORGANIZATION_SERVICE_TOKEN)
        private readonly organizationService: IOrganizationService,

        @Inject(ORGANIZATION_PARAMETERS_SERVICE_TOKEN)
        private readonly organizationParametersService: IOrganizationParametersService,

        private readonly logger: PinoLoggerService,
    ) {}

    public async execute(domain: string): Promise<Partial<IOrganization>[]> {
        try {
            if (!domain) {
                this.logger.warn({
                    message: 'Domain is required to fetch organizations',
                    context: GetOrganizationsByDomainUseCase.name,
                });
                return [];
            }

            const autoJoinOrgs =
                await this.organizationParametersService.findByKeyAndValue({
                    configKey: OrganizationParametersKey.AUTO_JOIN_CONFIG,
                    configValue: { enabled: true },
                    fuzzy: true,
                });

            if (!autoJoinOrgs || autoJoinOrgs.length === 0) {
                this.logger.warn({
                    message: 'No organizations found with auto-join enabled',
                    context: GetOrganizationsByDomainUseCase.name,
                    metadata: { domain },
                    serviceName: GetOrganizationsByDomainUseCase.name,
                });
                return [];
            }

            const lowercaseDomain = domain.toLowerCase();
            const matchingDomains = autoJoinOrgs.filter((org) => {
                const config =
                    org.configValue as OrganizationParametersAutoJoinConfig;
                return config?.domains?.some(
                    (d) => d.toLowerCase() === lowercaseDomain,
                );
            });

            if (!matchingDomains || matchingDomains.length === 0) {
                this.logger.warn({
                    message: 'No organizations match the provided domain',
                    context: GetOrganizationsByDomainUseCase.name,
                    metadata: { domain },
                    serviceName: GetOrganizationsByDomainUseCase.name,
                });
                return [];
            }

            const organizationUuids = matchingDomains.map(
                (org) => org.organization.uuid,
            );

            const organizationsPromises = organizationUuids.map(
                async (uuid) =>
                    await this.organizationService.findOne({ uuid }),
            );

            const organizations = (
                await Promise.all(organizationsPromises)
            ).filter(Boolean);

            if (!organizations || organizations.length === 0) {
                this.logger.warn({
                    message: 'No organizations found for the provided domain',
                    context: GetOrganizationsByDomainUseCase.name,
                    metadata: { domain },
                    serviceName: GetOrganizationsByDomainUseCase.name,
                });
                return [];
            }

            this.logger.log({
                message: 'Organizations fetched successfully by domain',
                context: GetOrganizationsByDomainUseCase.name,
                metadata: { domain, count: organizations.length },
                serviceName: GetOrganizationsByDomainUseCase.name,
            });

            return organizations.map((org) => ({
                uuid: org.uuid,
                name: org.name,
                owner: org.user.find((u) => u.role === Role.OWNER)?.email,
            }));
        } catch (error) {
            this.logger.error({
                message: 'Error fetching organizations by domain',
                error,
                context: GetOrganizationsByDomainUseCase.name,
                metadata: { domain },
                serviceName: GetOrganizationsByDomainUseCase.name,
            });
            throw error;
        }
    }
}
