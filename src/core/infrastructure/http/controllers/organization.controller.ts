import { GetOrganizationNameUseCase } from '@/core/application/use-cases/organization/get-organization-name';
import { GetOrganizationNameByTenantUseCase } from '@/core/application/use-cases/organization/get-organization-name-by-tenant';
import { GetOrganizationTenantNameUseCase } from '@/core/application/use-cases/organization/get-organization-tenant-name';
import { UpdateInfoOrganizationAndPhoneUseCase } from '@/core/application/use-cases/organization/update-infos.use-case';
import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { UpdateInfoOrganizationAndPhoneDto } from '../dtos/updateInfoOrgAndPhone.dto';
import { GetOrganizationsByDomainUseCase } from '@/core/application/use-cases/organization/get-organizations-domain.use-case';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import {
    PolicyGuard,
    CheckPolicies,
} from '../../adapters/services/permissions/policy.guard';
import { checkPermissions } from '../../adapters/services/permissions/policy.handlers';

@Controller('organization')
export class OrganizationController {
    constructor(
        private readonly getOrganizationNameUseCase: GetOrganizationNameUseCase,
        private readonly getOrganizationTenantNameUseCase: GetOrganizationTenantNameUseCase,
        private readonly getOrganizationNameByTenantUseCase: GetOrganizationNameByTenantUseCase,
        private readonly updateInfoOrganizationAndPhoneUseCase: UpdateInfoOrganizationAndPhoneUseCase,
        private readonly getOrganizationsByDomainUseCase: GetOrganizationsByDomainUseCase,
    ) {}

    @Get('/name')
    public getOrganizationName() {
        return this.getOrganizationNameUseCase.execute();
    }

    @Get('/name-by-tenant')
    public getOrganizationNameByTenant(
        @Query('tenantName')
        tenantName: string,
    ) {
        return this.getOrganizationNameByTenantUseCase.execute(tenantName);
    }

    @Get('/tenant-name')
    public getOrganizationTenantName() {
        return this.getOrganizationTenantNameUseCase.execute();
    }

    @Patch('/update-infos')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Update, ResourceType.OrganizationSettings),
    )
    public async updateInfoOrganizationAndPhone(
        @Body() body: UpdateInfoOrganizationAndPhoneDto,
    ) {
        return await this.updateInfoOrganizationAndPhoneUseCase.execute(body);
    }

    @Get('/domain')
    public async getOrganizationsByDomain(
        @Query('domain')
        domain: string,
    ) {
        return await this.getOrganizationsByDomainUseCase.execute(domain);
    }
}
