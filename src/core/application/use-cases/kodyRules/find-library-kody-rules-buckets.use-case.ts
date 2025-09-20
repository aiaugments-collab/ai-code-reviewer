import {
    KODY_RULES_SERVICE_TOKEN,
    IKodyRulesService,
} from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { BucketInfo } from '@/config/types/kodyRules.type';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class FindLibraryKodyRulesBucketsUseCase {
    constructor(
        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        private readonly logger: PinoLoggerService,
    ) { }

    async execute(): Promise<BucketInfo[]> {
        try {
            const buckets = await this.kodyRulesService.getLibraryKodyRulesBuckets();
            return buckets;
        } catch (error) {
            this.logger.error({
                message: 'Error finding library Kody Rules buckets',
                context: FindLibraryKodyRulesBucketsUseCase.name,
                error: error,
            });
            throw error;
        }
    }
}
