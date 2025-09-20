import { CreateOrUpdateParametersUseCase } from '@/core/application/use-cases/parameters/create-or-update-use-case';
import { FindByKeyParametersUseCase } from '@/core/application/use-cases/parameters/find-by-key-use-case';
import { ListCodeReviewAutomationLabelsUseCase } from '@/core/application/use-cases/parameters/list-code-review-automation-labels-use-case';
import { UpdateCodeReviewParameterRepositoriesUseCase } from '@/core/application/use-cases/parameters/update-code-review-parameter-repositories-use-case';
import { UpdateOrCreateCodeReviewParameterUseCase } from '@/core/application/use-cases/parameters/update-or-create-code-review-parameter-use-case';

import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import {
    Body,
    Controller,
    Get,
    Post,
    Query,
    Res,
    UseGuards,
} from '@nestjs/common';
import { Response } from 'express';

import { CreateOrUpdateCodeReviewParameterDto } from '../dtos/create-or-update-code-review-parameter.dto';
import { GenerateKodusConfigFileUseCase } from '@/core/application/use-cases/parameters/generate-kodus-config-file.use-case';
import { CopyCodeReviewParameterDTO } from '../dtos/copy-code-review-parameter.dto';
import { CopyCodeReviewParameterUseCase } from '@/core/application/use-cases/parameters/copy-code-review-parameter.use-case';
import { GenerateCodeReviewParameterUseCase } from '@/core/application/use-cases/parameters/generate-code-review-paremeter.use-case';
import { GenerateCodeReviewParameterDTO } from '../dtos/generate-code-review-parameter.dto';
import { DeleteRepositoryCodeReviewParameterDto } from '../dtos/delete-repository-code-review-parameter.dto';
import { DeleteRepositoryCodeReviewParameterUseCase } from '@/core/application/use-cases/parameters/delete-repository-code-review-parameter.use-case';
import { PreviewPrSummaryDto } from '../dtos/preview-pr-summary.dto';
import { PreviewPrSummaryUseCase } from '@/core/application/use-cases/parameters/preview-pr-summary.use-case';
import { CodeReviewVersion } from '@/config/types/general/codeReview.type';
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
@Controller('parameters')
export class ParametersController {
    constructor(
        private readonly createOrUpdateParametersUseCase: CreateOrUpdateParametersUseCase,
        private readonly findByKeyParametersUseCase: FindByKeyParametersUseCase,
        private readonly listCodeReviewAutomationLabelsUseCase: ListCodeReviewAutomationLabelsUseCase,
        private readonly updateOrCreateCodeReviewParameterUseCase: UpdateOrCreateCodeReviewParameterUseCase,
        private readonly updateCodeReviewParameterRepositoriesUseCase: UpdateCodeReviewParameterRepositoriesUseCase,
        private readonly generateKodusConfigFileUseCase: GenerateKodusConfigFileUseCase,
        private readonly copyCodeReviewParameterUseCase: CopyCodeReviewParameterUseCase,
        private readonly generateCodeReviewParameterUseCase: GenerateCodeReviewParameterUseCase,
        private readonly deleteRepositoryCodeReviewParameterUseCase: DeleteRepositoryCodeReviewParameterUseCase,
        private readonly previewPrSummaryUseCase: PreviewPrSummaryUseCase,
    ) {}

    //#region Parameters
    @Post('/create-or-update')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Create, ResourceType.CodeReviewSettings),
    )
    public async createOrUpdate(
        @Body()
        body: {
            key: ParametersKey;
            configValue: any;
            organizationAndTeamData: { organizationId: string; teamId: string };
        },
    ) {
        return await this.createOrUpdateParametersUseCase.execute(
            body.key,
            body.configValue,
            body.organizationAndTeamData,
        );
    }

    @Get('/find-by-key')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.CodeReviewSettings),
    )
    public async findByKey(
        @Query('key') key: ParametersKey,
        @Query('teamId') teamId: string,
    ) {
        return await this.findByKeyParametersUseCase.execute(key, { teamId });
    }

    @Get('/list-all')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.CodeReviewSettings),
    )
    public async listAll() {}

    //endregion
    //#region Code review routes

    @Get('/list-code-review-automation-labels')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.CodeReviewSettings),
    )
    public async listCodeReviewAutomationLabels(
        @Query('codeReviewVersion') codeReviewVersion?: CodeReviewVersion,
    ) {
        return this.listCodeReviewAutomationLabelsUseCase.execute(
            codeReviewVersion,
        );
    }

    @Post('/create-or-update-code-review')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Create, ResourceType.CodeReviewSettings),
    )
    public async updateOrCreateCodeReviewParameter(
        @Body()
        body: CreateOrUpdateCodeReviewParameterDto,
    ) {
        return await this.updateOrCreateCodeReviewParameterUseCase.execute(
            body,
        );
    }

    @Post('/update-code-review-parameter-repositories')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Create, ResourceType.CodeReviewSettings),
    )
    public async UpdateCodeReviewParameterRepositories(
        @Body()
        body: {
            organizationAndTeamData: { organizationId: string; teamId: string };
        },
    ) {
        return await this.updateCodeReviewParameterRepositoriesUseCase.execute(
            body,
        );
    }

    @Get('/generate-kodus-config-file')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.CodeReviewSettings),
    )
    public async GenerateKodusConfigFile(
        @Res() response: Response,
        @Query('teamId') teamId: string,
        @Query('repositoryId') repositoryId?: string,
    ) {
        const { yamlString } =
            await this.generateKodusConfigFileUseCase.execute(
                teamId,
                repositoryId,
            );

        response.set({
            'Content-Type': 'application/x-yaml',
            'Content-Disposition': 'attachment; filename=kodus-config.yml',
        });

        return response.send(yamlString);
    }

    @Post('/copy-code-review-parameter')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkRepoPermissions(Action.Read, ResourceType.CodeReviewSettings, {
            key: {
                body: 'sourceRepositoryId',
            },
        }),
        checkRepoPermissions(Action.Create, ResourceType.CodeReviewSettings, {
            key: {
                body: 'targetRepositoryId',
            },
        }),
    )
    public async copyCodeReviewParameter(
        @Body()
        body: CopyCodeReviewParameterDTO,
    ) {
        return this.copyCodeReviewParameterUseCase.execute(body);
    }

    @Post('/generate-code-review-parameter')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Create, ResourceType.CodeReviewSettings),
    )
    public async generateCodeReviewParameter(
        @Body()
        body: GenerateCodeReviewParameterDTO,
    ) {
        return this.generateCodeReviewParameterUseCase.execute(body);
    }

    @Post('/delete-repository-code-review-parameter')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkRepoPermissions(Action.Delete, ResourceType.CodeReviewSettings, {
            key: {
                body: 'repositoryId',
            },
        }),
    )
    public async deleteRepositoryCodeReviewParameter(
        @Body()
        body: DeleteRepositoryCodeReviewParameterDto,
    ) {
        return this.deleteRepositoryCodeReviewParameterUseCase.execute(body);
    }
    //#endregion

    @Post('/preview-pr-summary')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkRepoPermissions(Action.Read, ResourceType.CodeReviewSettings, {
            key: {
                body: 'repository.id',
            },
        }),
    )
    public async previewPrSummary(
        @Body()
        body: PreviewPrSummaryDto,
    ) {
        return this.previewPrSummaryUseCase.execute(body);
    }
}
