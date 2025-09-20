import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { TeamQueryDto } from '../dtos/teamId-query-dto';
import { AutomationType } from '@/core/domain/automation/enums/automation-type';
import { OrganizationAndTeamDataDto } from '../dtos/organizationAndTeamData.dto';
import { GetAllAutomationsUseCase } from '@/core/application/use-cases/automation/get-all-automations.use-case';
import { RunAutomationUseCase } from '@/core/application/use-cases/automation/run-automation.use-case';
import { getAllAutomationExecutionsUseCase } from '@/core/application/use-cases/automation/get-all-executions.use-case';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import {
    PolicyGuard,
    CheckPolicies,
} from '../../adapters/services/permissions/policy.guard';
import { checkPermissions } from '../../adapters/services/permissions/policy.handlers';

@Controller('automation')
export class AutomationController {
    constructor(
        private readonly getAllAutomationsUseCase: GetAllAutomationsUseCase,
        private readonly runAutomationUseCase: RunAutomationUseCase,
        private readonly getAllAutomationExecutionsUseCase: getAllAutomationExecutionsUseCase,
    ) {}

    @Get('/')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.CodeReviewSettings),
    )
    public async getAllAutomations(@Query() query: TeamQueryDto) {
        return this.getAllAutomationsUseCase.execute(query.teamId);
    }

    @Post('/run')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Create, ResourceType.CodeReviewSettings),
    )
    public async runAutomation(
        @Body()
        body: {
            automationName: AutomationType;
            organizationAndTeamData: OrganizationAndTeamDataDto;
            channelId?: string;
            origin?: string;
        },
    ) {
        let originModded = 'System';

        if (body.origin) {
            originModded = body.origin;
        }

        return await this.runAutomationUseCase.execute({
            ...body,
            origin: originModded,
        });
    }

    @Get('/executions')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.CodeReviewSettings),
    )
    public async getAllAutomationExecutions(@Query() query: TeamQueryDto) {
        return this.getAllAutomationExecutionsUseCase.execute(query);
    }
}
