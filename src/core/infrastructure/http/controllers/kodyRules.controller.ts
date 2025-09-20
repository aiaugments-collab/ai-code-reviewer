import { CreateOrUpdateKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/create-or-update.use-case';
import { DeleteByOrganizationIdKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/delete-by-organization-id.use-case';
import { DeleteRuleInOrganizationByIdKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/delete-rule-in-organization-by-id.use-case';
import { FindByOrganizationIdKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/find-by-organization-id.use-case';
import { FindRuleInOrganizationByRuleIdKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/find-rule-in-organization-by-id.use-case';
import { FindRulesInOrganizationByRuleFilterKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/find-rules-in-organization-by-filter.use-case';
import { CreateKodyRuleDto } from '../dtos/create-kody-rule.dto';
import { FindLibraryKodyRulesDto } from '../dtos/find-library-kody-rules.dto';
import {
    Body,
    Controller,
    Delete,
    Get,
    Inject,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { FindLibraryKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/find-library-kody-rules.use-case';
import { FindLibraryKodyRulesWithFeedbackUseCase } from '@/core/application/use-cases/kodyRules/find-library-kody-rules-with-feedback.use-case';
import { FindLibraryKodyRulesBucketsUseCase } from '@/core/application/use-cases/kodyRules/find-library-kody-rules-buckets.use-case';
import { AddLibraryKodyRulesDto } from '../dtos/add-library-kody-rules.dto';
import { AddLibraryKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/add-library-kody-rules.use-case';
import { GenerateKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/generate-kody-rules.use-case';
import { GenerateKodyRulesDTO } from '../dtos/generate-kody-rules.dto';
import { ChangeStatusKodyRulesDTO } from '../dtos/change-status-kody-rules.dto';
import { ChangeStatusKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/change-status-kody-rules.use-case';
import { REQUEST } from '@nestjs/core';
import { CheckSyncStatusUseCase } from '@/core/application/use-cases/kodyRules/check-sync-status.use-case';
import { CacheService } from '@/shared/utils/cache/cache.service';
import { SyncSelectedRepositoriesKodyRulesUseCase } from '@/core/application/use-cases/kodyRules/sync-selected-repositories.use-case';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import {
    PolicyGuard,
    CheckPolicies,
} from '../../adapters/services/permissions/policy.guard';
import { checkPermissions } from '../../adapters/services/permissions/policy.handlers';

@Controller('kody-rules')
export class KodyRulesController {
    constructor(
        private readonly createOrUpdateKodyRulesUseCase: CreateOrUpdateKodyRulesUseCase,
        private readonly findByOrganizationIdKodyRulesUseCase: FindByOrganizationIdKodyRulesUseCase,
        private readonly findRuleInOrganizationByIdKodyRulesUseCase: FindRuleInOrganizationByRuleIdKodyRulesUseCase,
        private readonly findRulesInOrganizationByRuleFilterKodyRulesUseCase: FindRulesInOrganizationByRuleFilterKodyRulesUseCase,
        private readonly deleteByOrganizationIdKodyRulesUseCase: DeleteByOrganizationIdKodyRulesUseCase,
        private readonly deleteRuleInOrganizationByIdKodyRulesUseCase: DeleteRuleInOrganizationByIdKodyRulesUseCase,
        private readonly findLibraryKodyRulesUseCase: FindLibraryKodyRulesUseCase,
        private readonly findLibraryKodyRulesWithFeedbackUseCase: FindLibraryKodyRulesWithFeedbackUseCase,
        private readonly findLibraryKodyRulesBucketsUseCase: FindLibraryKodyRulesBucketsUseCase,
        private readonly addLibraryKodyRulesUseCase: AddLibraryKodyRulesUseCase,
        private readonly generateKodyRulesUseCase: GenerateKodyRulesUseCase,
        private readonly changeStatusKodyRulesUseCase: ChangeStatusKodyRulesUseCase,
        private readonly checkSyncStatusUseCase: CheckSyncStatusUseCase,
        private readonly cacheService: CacheService,
        private readonly syncSelectedReposKodyRulesUseCase: SyncSelectedRepositoriesKodyRulesUseCase,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string } };
        },
    ) {}

    @Post('/create-or-update')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.KodyRules))
    public async create(
        @Body()
        body: CreateKodyRuleDto,
    ) {
        if (!this.request.user.organization.uuid) {
            throw new Error('Organization ID not found');
        }
        return this.createOrUpdateKodyRulesUseCase.execute(
            body,
            this.request.user.organization.uuid,
        );
    }

    @Get('/find-by-organization-id')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.KodyRules))
    public async findByOrganizationId() {
        return this.findByOrganizationIdKodyRulesUseCase.execute();
    }

    @Get('/find-rule-in-organization-by-id')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.KodyRules))
    public async findRuleInOrganizationById(
        @Query('ruleId')
        ruleId: string,
    ) {
        return this.findRuleInOrganizationByIdKodyRulesUseCase.execute(ruleId);
    }

    @Get('/find-rules-in-organization-by-title')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.KodyRules))
    public async findRulesInOrganizationByTitle(
        @Query('title')
        title: string,
    ) {
        if (!this.request.user.organization.uuid) {
            throw new Error('Organization ID not found');
        }

        return this.findRulesInOrganizationByRuleFilterKodyRulesUseCase.execute(
            this.request.user.organization.uuid,
            { title },
        );
    }

    @Get('/find-rules-in-organization-by-severity')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.KodyRules))
    public async findRulesInOrganizationBySeverity(
        @Query('severity')
        severity: string,
    ) {
        if (!this.request.user.organization.uuid) {
            throw new Error('Organization ID not found');
        }

        return this.findRulesInOrganizationByRuleFilterKodyRulesUseCase.execute(
            this.request.user.organization.uuid,
            { severity },
        );
    }

    @Get('/find-rules-in-organization-by-path')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.KodyRules))
    public async findRulesInOrganizationByPath(
        @Query('path')
        path: string,
    ) {
        if (!this.request.user.organization.uuid) {
            throw new Error('Organization ID not found');
        }

        return this.findRulesInOrganizationByRuleFilterKodyRulesUseCase.execute(
            this.request.user.organization.uuid,
            { path },
        );
    }

    @Get('/find-rules-in-organization-by-filter')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.KodyRules))
    public async findRulesInOrganizationByFilter(
        @Query('key')
        key: string,
        @Query('value')
        value: string,
        @Query('repositoryId')
        repositoryId?: string,
        @Query('directoryId')
        directoryId?: string,
    ) {
        if (!this.request.user.organization.uuid) {
            throw new Error('Organization ID not found');
        }

        return this.findRulesInOrganizationByRuleFilterKodyRulesUseCase.execute(
            this.request.user.organization.uuid,
            { [key]: value },
            repositoryId,
            directoryId,
        );
    }

    @Delete('/delete-by-organization-id')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Delete, ResourceType.KodyRules))
    public async deleteByOrganizationId() {
        return this.deleteByOrganizationIdKodyRulesUseCase.execute();
    }

    @Delete('/delete-rule-in-organization-by-id')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Delete, ResourceType.KodyRules))
    public async deleteRuleInOrganizationById(
        @Query('ruleId')
        ruleId: string,
    ) {
        return this.deleteRuleInOrganizationByIdKodyRulesUseCase.execute(
            ruleId,
        );
    }

    @Get('/find-library-kody-rules')
    public async findLibraryKodyRules(@Query() query: FindLibraryKodyRulesDto) {
        return this.findLibraryKodyRulesUseCase.execute(query);
    }

    @Get('/find-library-kody-rules-with-feedback')
    public async findLibraryKodyRulesWithFeedback(
        @Query() query: FindLibraryKodyRulesDto,
    ) {
        return this.findLibraryKodyRulesWithFeedbackUseCase.execute(query);
    }

    @Get('/find-library-kody-rules-buckets')
    public async findLibraryKodyRulesBuckets() {
        return this.findLibraryKodyRulesBucketsUseCase.execute();
    }

    @Post('/add-library-kody-rules')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.KodyRules))
    public async addLibraryKodyRules(@Body() body: AddLibraryKodyRulesDto) {
        return this.addLibraryKodyRulesUseCase.execute(body);
    }

    @Post('/generate-kody-rules')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.KodyRules))
    public async generateKodyRules(@Body() body: GenerateKodyRulesDTO) {
        if (!this.request.user.organization.uuid) {
            throw new Error('Organization ID not found');
        }

        return this.generateKodyRulesUseCase.execute(
            body,
            this.request.user.organization.uuid,
        );
    }

    @Post('/change-status-kody-rules')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Update, ResourceType.KodyRules))
    public async changeStatusKodyRules(@Body() body: ChangeStatusKodyRulesDTO) {
        return this.changeStatusKodyRulesUseCase.execute(body);
    }

    @Get('/check-sync-status')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.KodyRules))
    public async checkSyncStatus(
        @Query('teamId')
        teamId: string,
        @Query('repositoryId')
        repositoryId?: string,
    ) {
        const cacheKey = `check-sync-status:${this.request.user.organization.uuid}:${teamId}:${repositoryId || 'no-repo'}`;

        // Tenta buscar do cache primeiro
        const cachedResult = await this.cacheService.getFromCache(cacheKey);
        if (cachedResult) {
            return cachedResult;
        }

        // Se não estiver no cache, executa o use case
        const result = await this.checkSyncStatusUseCase.execute(
            teamId,
            repositoryId,
        );

        // Salva no cache por 15 minutos
        await this.cacheService.addToCache(cacheKey, result, 900000); // 15 minutos em milissegundos

        return result;
    }

    @Post('/sync-ide-rules')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.KodyRules))
    public async syncIdeRules(
        @Body() body: { teamId: string; repositoryId: string },
    ) {
        const respositories = [body.repositoryId];

        return this.syncSelectedReposKodyRulesUseCase.execute({
            teamId: body.teamId,
            repositoriesIds: respositories,
        });
    }
}
