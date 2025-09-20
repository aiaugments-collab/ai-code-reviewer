import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { AddLibraryKodyRulesDto } from '@/core/infrastructure/http/dtos/add-library-kody-rules.dto';
import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { CreateOrUpdateKodyRulesUseCase } from './create-or-update.use-case';
import { CreateKodyRuleDto } from '@/core/infrastructure/http/dtos/create-kody-rule.dto';
import {
    IKodyRule,
    KodyRulesOrigin,
} from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';

@Injectable()
export class AddLibraryKodyRulesUseCase {
    constructor(
        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string } };
        },

        private readonly createOrUpdateKodyRulesUseCase: CreateOrUpdateKodyRulesUseCase,

        private readonly logger: PinoLoggerService,

        private readonly authorizationService: AuthorizationService,
    ) {}

    async execute(libraryKodyRules: AddLibraryKodyRulesDto) {
        try {
            if (!this.request.user.organization.uuid) {
                throw new Error('Organization ID not found');
            }

            await this.authorizationService.ensure({
                user: this.request.user,
                action: Action.Create,
                resource: ResourceType.KodyRules,
                repoIds:
                    libraryKodyRules.repositoriesIds.length > 0
                        ? libraryKodyRules.repositoriesIds
                        : undefined,
            });

            let results: Partial<IKodyRule>[] = [];

            for await (const repoId of libraryKodyRules.repositoriesIds) {
                const kodyRule: CreateKodyRuleDto = {
                    title: libraryKodyRules.title,
                    rule: libraryKodyRules.rule,
                    path: libraryKodyRules.path,
                    severity: libraryKodyRules.severity,
                    repositoryId: repoId,
                    examples: libraryKodyRules.examples,
                    origin: KodyRulesOrigin.LIBRARY,
                };

                const result =
                    await this.createOrUpdateKodyRulesUseCase.execute(
                        kodyRule,
                        this.request.user.organization.uuid,
                    );

                if (!result) {
                    throw new Error('Failed to add library Kody rule');
                }
                results.push(result);
            }

            // Processar diretórios se existirem
            if (
                libraryKodyRules?.directoriesInfo &&
                libraryKodyRules?.directoriesInfo?.length > 0
            ) {
                for await (const directoryInfo of libraryKodyRules.directoriesInfo) {
                    const kodyRule: CreateKodyRuleDto = {
                        title: libraryKodyRules.title,
                        rule: libraryKodyRules.rule,
                        path: libraryKodyRules.path,
                        severity: libraryKodyRules.severity,
                        repositoryId: directoryInfo.repositoryId,
                        directoryId: directoryInfo.directoryId,
                        examples: libraryKodyRules.examples,
                        origin: KodyRulesOrigin.LIBRARY,
                    };

                    const result =
                        await this.createOrUpdateKodyRulesUseCase.execute(
                            kodyRule,
                            this.request.user.organization.uuid,
                        );

                    if (!result) {
                        throw new Error(
                            'Failed to add library Kody rule for directory',
                        );
                    }
                    results.push(result);
                }
            }

            return results;
        } catch (error) {
            this.logger.error({
                message: 'Could not add library Kody rules',
                context: AddLibraryKodyRulesUseCase.name,
                serviceName: 'AddLibraryKodyRulesUseCase',
                error: error,
                metadata: {
                    libraryKodyRules,
                    organizationAndTeamData: {
                        organizationId: this.request.user.organization.uuid,
                    },
                },
            });
            throw error;
        }
    }
}
