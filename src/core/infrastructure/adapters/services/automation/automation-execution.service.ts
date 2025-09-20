import {
    AUTOMATION_EXECUTION_REPOSITORY_TOKEN,
    IAutomationExecutionRepository,
} from '@/core/domain/automation/contracts/automation-execution.repository';
import { IAutomationExecutionService } from '@/core/domain/automation/contracts/automation-execution.service';
import { AutomationExecutionEntity } from '@/core/domain/automation/entities/automation-execution.entity';
import { IAutomationExecution } from '@/core/domain/automation/interfaces/automation-execution.interface';
import {
    CODE_REVIEW_EXECUTION_SERVICE,
    ICodeReviewExecutionService,
} from '@/core/domain/codeReviewExecutions/contracts/codeReviewExecution.service.contract';
import { Inject, Injectable } from '@nestjs/common';
import { FindOptionsWhere } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { PinoLoggerService } from '../logger/pino.service';
import { CacheService } from '@/shared/utils/cache/cache.service';

@Injectable()
export class AutomationExecutionService implements IAutomationExecutionService {
    constructor(
        @Inject(AUTOMATION_EXECUTION_REPOSITORY_TOKEN)
        private readonly automationExecutionRepository: IAutomationExecutionRepository,

        @Inject(CODE_REVIEW_EXECUTION_SERVICE)
        private readonly codeReviewExecutionService: ICodeReviewExecutionService,

        private readonly logger: PinoLoggerService,
        private readonly cacheService: CacheService,
    ) {}

    findLatestExecutionByFilters(
        filters?: Partial<any>,
    ): Promise<AutomationExecutionEntity | null> {
        return this.automationExecutionRepository.findLatestExecutionByFilters(
            filters,
        );
    }

    async findOneByOrganizationIdAndIssueId(
        organizationId: string,
        issueId: string,
    ): Promise<boolean> {
        const automation = await this.automationExecutionRepository.find();

        return automation?.some(
            (item) =>
                item?.dataExecution?.issueId === issueId &&
                item?.dataExecution?.organizationId === organizationId,
        );
    }

    async create(
        automationExecution: Omit<IAutomationExecution, 'uuid'>,
    ): Promise<AutomationExecutionEntity> {
        const result = await this.automationExecutionRepository.create(automationExecution);
        
        try {
            await this.cacheService.deleteByKeyPattern('/pull-requests/executions*');
            this.logger.log({
                message: 'Cache invalidated after automation execution creation',
                context: AutomationExecutionService.name,
                metadata: { executionUuid: result?.uuid }
            });
        } catch (error) {
            this.logger.warn({
                message: 'Failed to invalidate cache after automation execution creation',
                context: AutomationExecutionService.name,
                error,
                metadata: { executionUuid: result?.uuid }
            });
        }
        
        return result;
    }

    update(
        filter: Partial<IAutomationExecution>,
        data: Omit<
            Partial<IAutomationExecution>,
            'uuid' | 'createdAt' | 'updatedAt'
        >,
    ): Promise<AutomationExecutionEntity | null> {
        return this.automationExecutionRepository.update(filter, data);
    }

    delete(uuid: string): Promise<void> {
        return this.automationExecutionRepository.delete(uuid);
    }

    findById(uuid: string): Promise<AutomationExecutionEntity> {
        return this.automationExecutionRepository.findById(uuid);
    }

    find(
        filter?: Partial<IAutomationExecution>,
    ): Promise<AutomationExecutionEntity[]> {
        return this.automationExecutionRepository.find(filter);
    }

    findByPeriodAndTeamAutomationId(
        startDate: Date,
        endDate: Date,
        teamAutomationId: string,
    ): Promise<AutomationExecutionEntity[]> {
        return this.automationExecutionRepository.findByPeriodAndTeamAutomationId(
            startDate,
            endDate,
            teamAutomationId,
        );
    }

    async createCodeReview(
        automationExecution: Omit<IAutomationExecution, 'uuid'>,
        message: string,
    ): Promise<AutomationExecutionEntity | null> {
        try {
            if (
                !automationExecution ||
                !automationExecution.status ||
                !message
            ) {
                this.logger.warn({
                    message: 'Invalid parameters provided to createCodeReview',
                    context: AutomationExecutionService.name,
                    metadata: { automationExecution, message },
                });
                return null;
            }

            const newAutomationExecution =
                await this.automationExecutionRepository.create(
                    automationExecution,
                );

            if (!newAutomationExecution) {
                this.logger.warn({
                    message:
                        'Failed to create automation execution before creating code review',
                    context: AutomationExecutionService.name,
                    metadata: { automationExecution, message },
                });
                return null;
            }

            await this.codeReviewExecutionService.create({
                automationExecution: {
                    uuid: newAutomationExecution.uuid,
                },
                status: automationExecution.status,
                message,
            });

            return newAutomationExecution;
        } catch (error) {
            this.logger.error({
                message: 'Error creating automation execution with code review',
                error,
                context: AutomationExecutionService.name,
                metadata: { automationExecution, message },
            });
            return null;
        }
    }

    async updateCodeReview(
        filter: Partial<IAutomationExecution>,
        automationExecution: Partial<
            Omit<IAutomationExecution, 'uuid' | 'createdAt' | 'updatedAt'>
        >,
        message: string,
    ): Promise<AutomationExecutionEntity | null> {
        try {
            if (
                !filter ||
                !message ||
                !automationExecution ||
                !automationExecution.status
            ) {
                this.logger.warn({
                    message: 'Invalid parameters provided to updateCodeReview',
                    context: AutomationExecutionService.name,
                    metadata: { filter, message, automationExecution },
                });
                return null;
            }

            const updatedAutomationExecution =
                await this.automationExecutionRepository.update(
                    filter,
                    automationExecution,
                );

            if (!updatedAutomationExecution) {
                this.logger.warn({
                    message:
                        'Failed to update automation execution before updating code review',
                    context: AutomationExecutionService.name,
                    metadata: { filter, message, automationExecution },
                });
                return null;
            }

            await this.codeReviewExecutionService.create({
                automationExecution: {
                    uuid: updatedAutomationExecution.uuid,
                },
                status: automationExecution.status,
                message,
            });

            return updatedAutomationExecution;
        } catch (error) {
            this.logger.error({
                message: 'Error updating automation execution with code review',
                error,
                context: AutomationExecutionService.name,
                metadata: { filter, message, automationExecution },
            });
            return null;
        }
    }
}
