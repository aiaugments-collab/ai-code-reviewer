import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { TeamQueryDto } from '../../dtos/teamId-query-dto';
import { CreateOrUpdateIntegrationConfigUseCase } from '@/core/application/use-cases/integrations/integrationConfig/createOrUpdateIntegrationConfig.use-case';
import { GetIntegrationConfigsByIntegrationCategoryUseCase } from '@/core/application/use-cases/integrations/integrationConfig/getIntegrationConfigsByIntegrationCategory.use-case';
import {
    CheckPolicies,
    PolicyGuard,
} from '@/core/infrastructure/adapters/services/permissions/policy.guard';
import { checkPermissions } from '@/core/infrastructure/adapters/services/permissions/policy.handlers';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Controller('integration-config')
export class IntegrationConfigController {
    constructor(
        private readonly getIntegrationConfigsByIntegrationCategoryUseCase: GetIntegrationConfigsByIntegrationCategoryUseCase,
        private readonly createOrUpdateIntegrationConfigUseCase: CreateOrUpdateIntegrationConfigUseCase,
    ) {}

    @Post('/create-or-update-config')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.GitSettings))
    public async create(
        @Body()
        body: {},
    ) {
        return this.createOrUpdateIntegrationConfigUseCase.execute(body);
    }

    @Get('/get-integration-configs-by-integration-category')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.GitSettings))
    public async getIntegrationConfigsByIntegrationCategory(
        @Query('integrationCategory') integrationCategory: string,
        @Query('teamId') teamId: string,
    ) {
        return this.getIntegrationConfigsByIntegrationCategoryUseCase.execute({
            integrationCategory,
            teamId,
        });
    }
}
