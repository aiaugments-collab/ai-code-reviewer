import { UseCases } from '@/core/application/use-cases/rule-like';
import { RULE_LIKES_REPOSITORY_TOKEN } from '@/core/domain/kodyRules/contracts/ruleLike.repository.contract';
import { RULE_LIKE_SERVICE_TOKEN } from '@/core/domain/kodyRules/contracts/ruleLike.service.contract';
import { RuleLikesRepository } from '@/core/infrastructure/adapters/repositories/mongoose/ruleLike.repository';
import {
    RuleLikeModel,
    RuleLikeSchema,
} from '@/core/infrastructure/adapters/repositories/mongoose/schema/rulesLikes.model';
import { RuleLikesService } from '@/core/infrastructure/adapters/services/ruleLike/ruleLike.service';
import { RuleLikeController } from '@/core/infrastructure/http/controllers/ruleLike.controller';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: RuleLikeModel.name,
                schema: RuleLikeSchema,
            },
        ]),
    ],
    controllers: [RuleLikeController],
    providers: [
        ...UseCases,
        {
            provide: RULE_LIKE_SERVICE_TOKEN,
            useClass: RuleLikesService,
        },
        {
            provide: RULE_LIKES_REPOSITORY_TOKEN,
            useClass: RuleLikesRepository,
        },
    ],
    exports: [
        RULE_LIKE_SERVICE_TOKEN,
        RULE_LIKES_REPOSITORY_TOKEN,
    ],
})
export class RuleLikeModule {}
