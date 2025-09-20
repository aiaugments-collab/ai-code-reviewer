import { CheckIfHasActiveSessionsUseCase } from '@/core/application/use-cases/agent/check-active-session.use-case';
import { CreateSessionUseCase } from '@/core/application/use-cases/agent/create-session.use-case';
import { ExecutionRouterPromptUseCase } from '@/core/application/use-cases/agent/execute-router-prompt.use-case';
import { GetAuthDetailsByOrganizationUseCase } from '@/core/application/use-cases/agent/get-auth-details-by-organization.usecase';
import { GetAuthDetailsUseCase } from '@/core/application/use-cases/agent/get-auth-details.use-case';
import { GetGuildByUserUseCase } from '@/core/application/use-cases/agent/get-guild-by-user';
import { GetMemoryUseCase } from '@/core/application/use-cases/agent/get-memory.use-case';
import { GetRouterUseCase } from '@/core/application/use-cases/agent/get-router-use-case';
import { SendMetricMessageUseCase } from '@/core/application/use-cases/agent/send-metrics-message';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { CheckIfHasTeamConfigUseCase } from '@/core/application/use-cases/agent/check-has-team-config.use-case';
import { ExecutionAgentPromptUseCase } from '@/core/application/use-cases/agent/execute-agent.use-case';
import { NewAgentUseCase } from '@/core/application/use-cases/agent/teste';
import { ConversationAgentUseCase } from '@/core/application/use-cases/agent/conversation-agent.use-case';
import { OrganizationAndTeamDataDto } from '../dtos/organizationAndTeamData.dto';
import { createThreadId } from '@kodus/flow';

@Controller('agent')
export class AgentController {
    constructor(
        private readonly getRouterUseCase: GetRouterUseCase,
        private readonly executionRouterPromptUseCase: ExecutionRouterPromptUseCase,
        private readonly getMemoryUseCase: GetMemoryUseCase,
        private readonly checkIfHasActiveSessionsUseCase: CheckIfHasActiveSessionsUseCase,
        private readonly createSessionUseCase: CreateSessionUseCase,
        private readonly getAuthDetailsUseCase: GetAuthDetailsUseCase,
        private readonly getUserDetailsByOrganizationUseCase: GetAuthDetailsByOrganizationUseCase,
        private readonly getGuildByUser: GetGuildByUserUseCase,
        private readonly sendMetricMessageUseCase: SendMetricMessageUseCase,
        private readonly checkIfHasTeamConfigUseCase: CheckIfHasTeamConfigUseCase,
        private readonly executionAgentPromptUseCase: ExecutionAgentPromptUseCase,
        private readonly newAgentUseCase: NewAgentUseCase,
        private readonly conversationAgentUseCase: ConversationAgentUseCase,
    ) {}

    @Post('/router')
    public async getRouter(@Body() body: any) {
        return this.getRouterUseCase.execute(body);
    }

    @Post('/execute-router-prompt')
    public async executeRouterPrompt(@Body() body: any) {
        return this.executionRouterPromptUseCase.execute(body);
    }

    @Post('/memory')
    public async getMemory(@Body() body: any) {
        return this.getMemoryUseCase.execute(body);
    }

    @Post('/auth-details')
    public async getAuthDetails(@Body() body: any) {
        return this.getAuthDetailsUseCase.execute(body);
    }

    @Post('/has-active-sessions')
    public async checkIfHasActiveSessions(@Body() body: any) {
        return this.checkIfHasActiveSessionsUseCase.execute(body);
    }

    @Post('/create-session')
    public async createSession(@Body() body: any) {
        return this.createSessionUseCase.execute(body);
    }

    @Post('/auth-details-organization')
    public async getAuthDetailByOrganization(@Body() body: any) {
        return this.getUserDetailsByOrganizationUseCase.execute(body);
    }

    @Post('/guild-by-member')
    public async getGuildByMember(@Body() body: any) {
        return this.getGuildByUser.execute(body);
    }

    @Post('/metrics')
    public async sendMetricMessage(@Body() body: any) {
        return this.sendMetricMessageUseCase.execute(body);
    }

    @Post('/has-team-config')
    public async checkIfHasTeamConfig(@Body() body: any) {
        return this.checkIfHasTeamConfigUseCase.execute(body);
    }

    @Post('/execute-agent')
    public async executeAgentByType(@Body() body: any) {
        return this.executionAgentPromptUseCase.execute(body);
    }

    @Get('/teste')
    public async newAgent() {
        // This method is not defined in the provided code, but it should be implemented similarly to the others.
        // Assuming there's an ExecuteToolUseCase that handles tool execution.
        return this.newAgentUseCase.execute();
    }

    @Post('/conversation')
    public async conversation(
        @Body()
        body: {
            prompt: string;
            organizationAndTeamData: OrganizationAndTeamDataDto;
        },
    ) {
        const thread = createThreadId(
            {
                organizationId: body.organizationAndTeamData.organizationId,
                teamId: body.organizationAndTeamData.teamId,
            },
            {
                prefix: 'cmc', // Code Management Chat
            },
        );
        return this.conversationAgentUseCase.execute({ ...body, thread });
    }
}
