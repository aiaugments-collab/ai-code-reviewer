import { Inject, Injectable } from '@nestjs/common';
import { ProgrammingLanguage } from '@/shared/domain/enums/programming-language.enum';
import {
    IRuleLikeService,
    RULE_LIKE_SERVICE_TOKEN,
} from '@/core/domain/kodyRules/contracts/ruleLike.service.contract';
import { RuleFeedbackType } from '@/core/domain/kodyRules/entities/ruleLike.entity';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';

@Injectable()
export class SetRuleLikeUseCase {
    constructor(
        @Inject(RULE_LIKE_SERVICE_TOKEN)
        private readonly ruleLikeService: IRuleLikeService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(
        ruleId: string,
        feedback: RuleFeedbackType,
        userId?: string,
    ): Promise<any> {
        try {
            const result = await this.ruleLikeService.setFeedback(
                ruleId,
                feedback,
                userId,
            );

            // Retorna o objeto limpo ao invés da entity
            return result?.toObject() || null;
        } catch (error) {
            this.logger.error({
                message: `Failed to save rule feedback`,
                context: SetRuleLikeUseCase.name,
                error,
                metadata: {
                    ruleId,
                    feedback,
                    userId,
                },
            });
            throw error;
        }
    }
}
