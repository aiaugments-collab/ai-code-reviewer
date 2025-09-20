import {
    KODY_RULES_SERVICE_TOKEN,
    IKodyRulesService,
} from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { Injectable, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';

@Injectable()
export class DeleteRuleInOrganizationByIdKodyRulesUseCase {
    constructor(
        @Inject(REQUEST)
        private readonly request: Request & {
            user: {
                organization: { uuid: string };
                uuid: string;
                email: string;
            };
        },

        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(ruleId: string) {
        try {
            if (!this.request.user.organization.uuid) {
                throw new Error('Organization ID not found');
            }

            return await this.kodyRulesService.deleteRuleWithLogging(
                {
                    organizationId: this.request.user.organization.uuid,
                },
                ruleId,
                {
                    userId: this.request.user.uuid,
                    userEmail: this.request.user.email,
                },
            );
        } catch (error) {
            this.logger.error({
                message: 'Error deleting Kody Rule in organization by ID',
                context: DeleteRuleInOrganizationByIdKodyRulesUseCase.name,
                error: error,
                metadata: {
                    organizationId: this.request.user.organization.uuid,
                    ruleId,
                },
            });
            throw error;
        }
    }
}
