import { CreateOrUpdatePullRequestMessagesUseCase } from '@/core/application/use-cases/pullRequestMessages/create-or-update-pull-request-messages.use-case';
import { FindByRepositoryIdPullRequestMessagesUseCase } from '@/core/application/use-cases/pullRequestMessages/find-by-repository-id.use-case';
import { FindByIdPullRequestMessagesUseCase } from '@/core/application/use-cases/pullRequestMessages/find-by-id.use-case';
import { FindByDirectoryIdPullRequestMessagesUseCase } from '@/core/application/use-cases/pullRequestMessages/find-by-directory-id.use-case';
import { IPullRequestMessages } from '@/core/domain/pullRequestMessages/interfaces/pullRequestMessages.interface';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

@Controller('pull-request-messages')
export class PullRequestMessagesController {
    constructor(
        private readonly createOrUpdatePullRequestMessagesUseCase: CreateOrUpdatePullRequestMessagesUseCase,
        private readonly findByRepositoryIdPullRequestMessagesUseCase: FindByRepositoryIdPullRequestMessagesUseCase,
        private readonly findByIdPullRequestMessagesUseCase: FindByIdPullRequestMessagesUseCase,
        private readonly findByDirectoryIdPullRequestMessagesUseCase: FindByDirectoryIdPullRequestMessagesUseCase,
    ) {}

    @Post('/')
    public async createOrUpdatePullRequestMessages(
        @Body() body: IPullRequestMessages,
    ) {
        return await this.createOrUpdatePullRequestMessagesUseCase.execute(
            body,
        );
    }

    @Get('/find-by-organization-id')
    public async findByRepositoryIdAndOrganizationId(
        @Query('repositoryId') repositoryId: string,
        @Query('organizationId') organizationId: string,
    ) {
        return await this.findByRepositoryIdPullRequestMessagesUseCase.execute(
            repositoryId,
            organizationId,
        );
    }

    @Get('/find-by-directory-id')
    public async findByDirectoryId(
        @Query('directoryId') directoryId: string,
        @Query('repositoryId') repositoryId: string,
        @Query('organizationId') organizationId: string,
    ) {
        return await this.findByDirectoryIdPullRequestMessagesUseCase.execute(
            directoryId,
            repositoryId,
            organizationId,
        );
    }

    @Get('/:id')
    public async findById(@Param('id') id: string) {
        return await this.findByIdPullRequestMessagesUseCase.execute(id);
    }
}
