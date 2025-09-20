import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { DismissTeamArtifactUseCase } from '@/core/application/use-cases/teamArtifacts/dismiss.use-case';
import { ExecuteTeamArtifactsUseCase } from '@/core/application/use-cases/teamArtifacts/execute-teamArtifacts';
import { GetTeamArtifactsUseCase } from '@/core/application/use-cases/teamArtifacts/get-team-artifacts.use-case';
import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';

@Controller('team-artifacts')
export class TeamArtifactsController {
    constructor(
        private readonly executeTeamArtifacts: ExecuteTeamArtifactsUseCase,
        private readonly getTeamArtifactsUseCase: GetTeamArtifactsUseCase,
        private readonly dismissTeamArtifactsUseCase: DismissTeamArtifactUseCase,
    ) {}

    @Post('/run')
    public async runTeamArtifacts(
        @Body()
        body: {
            teamId: string;
            organizationId: string;
            type: string;
        },
    ) {
        return await this.executeTeamArtifacts.execute(body);
    }

    @Get('/')
    public async getTeamArtifacts(
        @Query('teamId')
        teamId: string,
    ) {
        return await this.getTeamArtifactsUseCase.execute(teamId);
    }

    @Patch('/dismiss')
    public async dismissTeamArtifacts(
        @Body() body: { artifactId: string; teamId: string },
    ) {
        return await this.dismissTeamArtifactsUseCase.execute(
            body.artifactId,
            body.teamId,
        );
    }
}
