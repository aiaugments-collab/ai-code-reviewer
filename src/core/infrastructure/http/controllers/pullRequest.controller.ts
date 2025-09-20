import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { UseInterceptors } from '@nestjs/common';
import { GetPullRequestAuthorsUseCase } from '@/core/application/use-cases/pullRequests/get-pull-request-authors-orderedby-contributions.use-case';
import { UpdatePullRequestToNewFormatUseCase } from '@/core/application/use-cases/pullRequests/update-pull-request-to-new-format.use-case';
import { GetEnrichedPullRequestsUseCase } from '@/core/application/use-cases/pullRequests/get-enriched-pull-requests.use-case';
import { updatePullRequestDto } from '../dtos/update-pull-request.dto';
import { EnrichedPullRequestsQueryDto } from '../dtos/enriched-pull-requests-query.dto';
import { PaginatedEnrichedPullRequestsResponse } from '../dtos/paginated-enriched-pull-requests.dto';
import {
    CheckPolicies,
    PolicyGuard,
} from '../../adapters/services/permissions/policy.guard';
import {
    checkPermissions,
    checkRepoPermissions,
} from '../../adapters/services/permissions/policy.handlers';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Controller('pull-requests')
export class PullRequestController {
    constructor(
        private readonly getPullRequestAuthorsUseCase: GetPullRequestAuthorsUseCase,
        private readonly updatePullRequestToNewFormatUseCase: UpdatePullRequestToNewFormatUseCase,
        private readonly getEnrichedPullRequestsUseCase: GetEnrichedPullRequestsUseCase,
    ) {}

    @Get('/get-pull-request-authors')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.Billing))
    public async getPullRequestAuthors(
        @Query() query: { organizationId: string },
    ) {
        return await this.getPullRequestAuthorsUseCase.execute(
            query.organizationId,
        );
    }

    // TODO: remove, deprecated
    @Post('/update-pull-requests')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Update, ResourceType.PullRequests))
    public async updatePullRequestToNewFormat(
        @Body() body: updatePullRequestDto,
    ) {
        return await this.updatePullRequestToNewFormatUseCase.execute(body);
    }

    @Get('/executions')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.PullRequests))
    public async getPullRequestExecutions(
        @Query() query: EnrichedPullRequestsQueryDto,
    ): Promise<PaginatedEnrichedPullRequestsResponse> {
        return await this.getEnrichedPullRequestsUseCase.execute(query);
    }
}
