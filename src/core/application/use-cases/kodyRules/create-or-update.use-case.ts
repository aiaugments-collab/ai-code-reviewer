import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { KODY_RULES_SERVICE_TOKEN } from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { IKodyRulesService } from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import { CreateKodyRuleDto } from '@/core/infrastructure/http/dtos/create-kody-rule.dto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';

@Injectable()
export class CreateOrUpdateKodyRulesUseCase {
    constructor(
        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        private readonly logger: PinoLoggerService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: {
                organization: { uuid: string };
                uuid: string;
                email: string;
            };
        },

        private readonly authorizationService: AuthorizationService,
    ) {}

    async execute(
        kodyRule: CreateKodyRuleDto,
        organizationId: string,
        userInfo?: { userId: string; userEmail: string },
    ) {
        try {
            const organizationAndTeamData: OrganizationAndTeamData = {
                organizationId,
            };

            const req: any = this.request as any;
            const reqUser = req?.user;
            const userInfoData =
                userInfo ||
                (reqUser?.uuid && reqUser?.email
                    ? { userId: reqUser.uuid, userEmail: reqUser.email }
                    : { userId: 'kody-system', userEmail: 'kody@kodus.io' });

            if (userInfoData.userId !== 'kody-system') {
                await this.authorizationService.ensure({
                    user: this.request.user,
                    action: Action.Create,
                    resource: ResourceType.KodyRules,
                    repoIds: kodyRule.repositoryId
                        ? [kodyRule.repositoryId]
                        : undefined,
                });
            }

            const result = await this.kodyRulesService.createOrUpdate(
                organizationAndTeamData,
                kodyRule,
                userInfoData,
            );

            if (!result) {
                throw new NotFoundException(
                    'Failed to create or update kody rule',
                );
            }

            return result;
        } catch (error) {
            this.logger.error({
                message: 'Could not create or update Kody rules',
                context: CreateOrUpdateKodyRulesUseCase.name,
                serviceName: 'CreateOrUpdateKodyRulesUseCase',
                error: error,
                metadata: {
                    kodyRule,
                    organizationAndTeamData: {
                        organizationId,
                    },
                },
            });
            throw error;
        }
    }
}
