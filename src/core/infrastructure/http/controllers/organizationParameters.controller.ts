import { CreateOrUpdateOrganizationParametersUseCase } from '@/core/application/use-cases/organizationParameters/create-or-update.use-case';
import { FindByKeyOrganizationParametersUseCase } from '@/core/application/use-cases/organizationParameters/find-by-key.use-case';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { OrganizationParametersKey } from '@/shared/domain/enums/organization-parameters-key.enum';

import {
    Body,
    Controller,
    Get,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import {
    PolicyGuard,
    CheckPolicies,
} from '../../adapters/services/permissions/policy.guard';
import { checkPermissions } from '../../adapters/services/permissions/policy.handlers';

@Controller('organization-parameters')
export class OrgnizationParametersController {
    constructor(
        private readonly createOrUpdateOrganizationParametersUseCase: CreateOrUpdateOrganizationParametersUseCase,
        private readonly findByKeyOrganizationParametersUseCase: FindByKeyOrganizationParametersUseCase,
    ) {}

    @Post('/create-or-update')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Create, ResourceType.OrganizationSettings),
    )
    public async createOrUpdate(
        @Body()
        body: {
            key: OrganizationParametersKey;
            configValue: any;
            organizationAndTeamData: { organizationId: string; teamId: string };
        },
    ) {
        return await this.createOrUpdateOrganizationParametersUseCase.execute(
            body.key,
            body.configValue,
            body.organizationAndTeamData,
        );
    }

    @Get('/find-by-key')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.OrganizationSettings),
    )
    public async findByKey(
        @Query('key') key: OrganizationParametersKey,
        @Query('organizationId') organizationId: string,
    ) {
        return await this.findByKeyOrganizationParametersUseCase.execute(key, {
            organizationId,
        });
    }

    @Get('/list-all')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.OrganizationSettings),
    )
    public async listAll() {}
}
