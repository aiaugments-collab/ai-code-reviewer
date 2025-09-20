/**
 * @license
 * Kodus Tech. All rights reserved.
 */

import { Inject, Injectable } from '@nestjs/common';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { KodyFineTuningService } from '@/ee/kodyFineTuning/kodyFineTuning.service';
import { CodeSuggestion } from '@/config/types/general/codeReview.type';
import { CodeReviewPipelineContext } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/context/code-review-pipeline.context';
import { BaseKodyFineTuningContextPreparation } from '@/core/infrastructure/adapters/services/kodyFineTuning/base-fine-tuning.service';
import {
    ISuggestionService,
    SUGGESTION_SERVICE_TOKEN,
} from '@/core/domain/codeBase/contracts/SuggestionService.contract';
import { IClusterizedSuggestion } from '../domain/interfaces/kodyFineTuning.interface';

/**
 * Enterprise implementation of fine tuning service
 * Extends the base class and adds advanced functionality
 * Available only in the cloud version or with an enterprise license
 */
@Injectable()
export class KodyFineTuningContextPreparationServiceEE extends BaseKodyFineTuningContextPreparation {
    private context: CodeReviewPipelineContext;

    constructor(
        @Inject(SUGGESTION_SERVICE_TOKEN)
        private readonly suggestionService: ISuggestionService,
        private readonly kodyFineTuningService: KodyFineTuningService,
        protected readonly logger: PinoLoggerService,
    ) {
        super(logger);
    }

    /**
     * Performs advanced fine tuning analysis
     * @param organizationId Organization identifier
     * @param prNumber Pull Request number
     * @param repository Repository information
     * @param suggestionsToAnalyze Suggestions to be analyzed
     * @param clusterizedSuggestions Clusterized suggestions
     * @param isFineTuningEnabled Whether fine tuning is enabled
     * @returns Array of analyzed suggestions
     * @override
     */
    async prepareKodyFineTuningContextInternal(
        organizationId: string,
        prNumber: number,
        repository: {
            id: string;
            full_name: string;
        },
        suggestionsToAnalyze: CodeSuggestion[],
        isFineTuningEnabled: boolean,
        mainClusterizedSuggestions: IClusterizedSuggestion[],
    ): Promise<{
        keepedSuggestions: Partial<CodeSuggestion>[];
        discardedSuggestions: Partial<CodeSuggestion>[];
    }> {
        if (!suggestionsToAnalyze || suggestionsToAnalyze.length === 0) {
            return {
                keepedSuggestions: [],
                discardedSuggestions: [],
            };
        }

        if (!isFineTuningEnabled) {
            return {
                keepedSuggestions: suggestionsToAnalyze,
                discardedSuggestions: [],
            };
        }

        // Verifica se há clusterizedSuggestions
        if (
            !mainClusterizedSuggestions ||
            mainClusterizedSuggestions.length === 0
        ) {
            return {
                keepedSuggestions: suggestionsToAnalyze,
                discardedSuggestions: [],
            };
        }

        try {
            const result = await this.kodyFineTuningService.fineTuningAnalysis(
                organizationId,
                prNumber,
                {
                    id: repository.id,
                    full_name: repository.full_name,
                    language: suggestionsToAnalyze[0]?.language,
                },
                suggestionsToAnalyze,
                mainClusterizedSuggestions,
            );

            return {
                keepedSuggestions: result?.keepedSuggestions?.map(
                    (suggestion) => {
                        const { suggestionEmbed, ...rest } = suggestion as any;

                        return rest;
                    },
                ),
                discardedSuggestions: result?.discardedSuggestions?.map(
                    (suggestion) => {
                        const { suggestionEmbed, ...rest } = suggestion as any;

                        return rest;
                    },
                ),
            };
        } catch (error) {
            this.logger.error({
                message: 'Error performing fine tuning analysis',
                error,
                context: KodyFineTuningContextPreparationServiceEE.name,
                metadata: {
                    organizationId,
                    prNumber,
                    repository: {
                        id: repository.id,
                        full_name: repository.full_name,
                    },
                },
            });
            return {
                keepedSuggestions: suggestionsToAnalyze,
                discardedSuggestions: [],
            };
        }
    }
}
