import { UserRequest } from '@/config/types/http/user-request.type';
import {
    KODY_RULES_SERVICE_TOKEN,
    IKodyRulesService,
} from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { IKodyRule } from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';

@Injectable()
export class FindRulesInOrganizationByRuleFilterKodyRulesUseCase {
    constructor(
        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        private readonly logger: PinoLoggerService,

        @Inject(REQUEST)
        private readonly request: UserRequest,

        private readonly authorizationService: AuthorizationService,
    ) {}

    async execute(
        organizationId: string,
        filter: Partial<IKodyRule>,
        repositoryId?: string,
        directoryId?: string,
    ) {
        try {
            await this.authorizationService.ensure({
                user: this.request.user,
                action: Action.Read,
                resource: ResourceType.KodyRules,
                repoIds: [repositoryId],
            });

            const existingRules = await this.kodyRulesService.find({
                organizationId,
                rules: [{ repositoryId, directoryId }],
            });

            if (!existingRules || existingRules.length === 0) {
                return [];
            }

            const allRules = existingRules.reduce((acc, entity) => {
                return [...acc, ...entity.rules];
            }, []);

            let filteredRules = allRules;

            if (repositoryId && !directoryId) {
                filteredRules = allRules.filter((rule) => !rule.directoryId);
            } else if (repositoryId && directoryId) {
                filteredRules = allRules.filter(
                    (rule) => rule.directoryId === directoryId,
                );
            }

            // Aplica o filtro personalizado passado como parâmetro
            const rules = filteredRules.filter((rule) => {
                for (const key in filter) {
                    if (rule[key] !== filter[key]) {
                        return false;
                    }
                }
                return true;
            });

            return rules;
        } catch (error) {
            this.logger.error({
                message:
                    'Error finding Kody Rules in organization by rule filter',
                context:
                    FindRulesInOrganizationByRuleFilterKodyRulesUseCase.name,
                error: error,
                metadata: {
                    organizationId,
                    filter,
                },
            });
            throw error;
        }
    }
}
