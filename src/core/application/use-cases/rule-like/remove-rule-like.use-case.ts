import { Inject, Injectable } from '@nestjs/common';
import {
    IRuleLikeService,
    RULE_LIKE_SERVICE_TOKEN,
} from '@/core/domain/kodyRules/contracts/ruleLike.service.contract';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';

@Injectable()
export class RemoveRuleLikeUseCase {
    constructor(
        @Inject(RULE_LIKE_SERVICE_TOKEN)
        private readonly ruleLikeService: IRuleLikeService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(
        ruleId: string,
        userId?: string,
    ): Promise<boolean> {
        if (!userId) {
            throw new Error('userId is required to remove rule like');
        }

        try {
            const result = await this.ruleLikeService.removeFeedback(
                ruleId,
                userId,
            );

            return result;
        } catch (error) {
            this.logger.error({
                message: `Failed to remove rule feedback`,
                context: RemoveRuleLikeUseCase.name,
                error,
                metadata: {
                    ruleId,
                    userId,
                },
            });
            throw error;
        }
    }
}
