import { Body, Controller, Get, Patch, Post, Put } from '@nestjs/common';
import { TeamQueryDto } from '../dtos/teamId-query-dto';
import { GetOrganizationArtifactsUseCase } from '@/core/application/use-cases/organizationArtifacts/get-organization-artifacts.use-case';
import { DismissOrganizationArtifactsUseCase } from '@/core/application/use-cases/organizationArtifacts/dismiss-organization-artifacts.use-case';

@Controller('organization-artifacts')
export class OrganizationArtifactsController {
    constructor(
        private readonly getOrganizationArtifactsUseCase: GetOrganizationArtifactsUseCase,
        private readonly dismissOrganizationArtifactsUseCase: DismissOrganizationArtifactsUseCase,
    ) {}

    @Get('/')
    public async getOrganizationArtifacts(@Body() body: { teamId: string }) {
        return await this.getOrganizationArtifactsUseCase.execute(body?.teamId);
    }

    @Patch('/dismiss')
    public async dismissOrganizationArtifacts(
        @Body() body: { artifactId: string; teamId: string },
    ) {
        return await this.dismissOrganizationArtifactsUseCase.execute(
            body?.artifactId,
            body?.teamId,
        );
    }
}
