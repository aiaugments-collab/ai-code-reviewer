import { CreateOrganizationUseCase } from './create.use-case';
import { GetOrganizationNameUseCase } from './get-organization-name';
import { GetOrganizationNameByTenantUseCase } from './get-organization-name-by-tenant';
import { GetOrganizationTenantNameUseCase } from './get-organization-tenant-name';
import { GetOrganizationsByDomainUseCase } from './get-organizations-domain.use-case';
import { UpdateInfoOrganizationAndPhoneUseCase } from './update-infos.use-case';

export const UseCases = [
    CreateOrganizationUseCase,
    GetOrganizationNameUseCase,
    GetOrganizationTenantNameUseCase,
    GetOrganizationNameByTenantUseCase,
    UpdateInfoOrganizationAndPhoneUseCase,
    GetOrganizationsByDomainUseCase,
];
