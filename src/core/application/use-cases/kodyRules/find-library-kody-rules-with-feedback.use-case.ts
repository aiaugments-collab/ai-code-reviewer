import { KodyRuleFilters } from '@/config/types/kodyRules.type';
import {
    KODY_RULES_SERVICE_TOKEN,
    IKodyRulesService,
} from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { FindLibraryKodyRulesDto } from '@/core/infrastructure/http/dtos/find-library-kody-rules.dto';
import { PaginatedLibraryKodyRulesResponse, PaginationMetadata } from '@/core/infrastructure/http/dtos/paginated-library-kody-rules.dto';

@Injectable()
export class FindLibraryKodyRulesWithFeedbackUseCase {
    constructor(
        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        private readonly logger: PinoLoggerService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user?: { uuid: string; organization: { uuid: string } };
        },
    ) { }

    async execute(filters: FindLibraryKodyRulesDto): Promise<PaginatedLibraryKodyRulesResponse> {
        try {
            const { page = 1, limit = 100, skip, ...kodyRuleFilters } = filters;
            
            // Passa userId se o usuário estiver logado
            const userId = this.request.user?.uuid;
            
            const allLibraryKodyRules =
                await this.kodyRulesService.getLibraryKodyRulesWithFeedback(kodyRuleFilters, userId);

            // Aplicar paginação
            const totalItems = allLibraryKodyRules.length;
            const totalPages = Math.ceil(totalItems / limit);
            const offset = skip || (page - 1) * limit;
            const paginatedRules = allLibraryKodyRules.slice(offset, offset + limit);

            const paginationMetadata: PaginationMetadata = {
                currentPage: page,
                totalPages,
                totalItems,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            };

            this.logger.log({
                message: 'Successfully retrieved library Kody Rules with feedback',
                context: FindLibraryKodyRulesWithFeedbackUseCase.name,
                metadata: {
                    userId,
                    totalItems,
                    page,
                    limit,
                    returnedItems: paginatedRules.length,
                },
            });

            return {
                data: paginatedRules,
                pagination: paginationMetadata,
            };
        } catch (error) {
            this.logger.error({
                message: 'Error finding library Kody Rules with feedback',
                context: FindLibraryKodyRulesWithFeedbackUseCase.name,
                error: error,
            });
            throw error;
        }
    }
}

