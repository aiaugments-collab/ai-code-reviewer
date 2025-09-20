import { ICodeReviewExecutionRepository } from '@/core/domain/codeReviewExecutions/contracts/codeReviewExecution.repository.contract';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CodeReviewExecutionModel } from './schema/codeReviewExecution.model';
import { FindOptionsWhere, Repository } from 'typeorm';
import { CodeReviewExecutionEntity } from '@/core/domain/codeReviewExecutions/entities/codeReviewExecution.entity';
import { CodeReviewExecution } from '@/core/domain/codeReviewExecutions/interfaces/codeReviewExecution.interface';
import {
    mapSimpleModelsToEntities,
    mapSimpleModelToEntity,
} from '@/shared/infrastructure/repositories/mappers';
import { PinoLoggerService } from '../../services/logger/pino.service';
import { IAutomationExecution } from '@/core/domain/automation/interfaces/automation-execution.interface';
import { createNestedConditions } from '@/shared/infrastructure/repositories/filters';

@Injectable()
export class CodeReviewExecutionRepository
    implements ICodeReviewExecutionRepository
{
    constructor(
        @InjectRepository(CodeReviewExecutionModel)
        private readonly codeReviewExecutionRepository: Repository<CodeReviewExecutionModel>,

        private readonly logger: PinoLoggerService,
    ) {}

    async create(
        codeReviewExecution: Omit<
            CodeReviewExecution,
            'uuid' | 'createdAt' | 'updatedAt'
        >,
    ): Promise<CodeReviewExecutionEntity | null> {
        try {
            const newObj =
                this.codeReviewExecutionRepository.create(codeReviewExecution);

            if (!newObj) {
                this.logger.warn({
                    message: 'Failed to create code review execution model',
                    context: CodeReviewExecutionRepository.name,
                    metadata: { codeReviewExecution },
                });

                return null;
            }

            const saved = await this.codeReviewExecutionRepository.save(newObj);

            if (!saved) {
                this.logger.warn({
                    message: 'Failed to save code review execution model',
                    context: CodeReviewExecutionRepository.name,
                    metadata: { codeReviewExecution },
                });

                return null;
            }

            return mapSimpleModelToEntity(saved, CodeReviewExecutionEntity);
        } catch (error) {
            this.logger.error({
                message: 'Error creating code review execution',
                error,
                context: CodeReviewExecutionRepository.name,
                metadata: { codeReviewExecution },
            });

            return null;
        }
    }

    async update(
        filter: Partial<CodeReviewExecution>,
        codeReviewExecution: Partial<
            Omit<CodeReviewExecution, 'uuid' | 'createdAt' | 'updatedAt'>
        >,
    ): Promise<CodeReviewExecutionEntity | null> {
        try {
            const conditions = this.getFilterConditions(filter);

            const update = await this.codeReviewExecutionRepository.update(
                conditions,
                codeReviewExecution,
            );

            if (update.affected === 0) {
                this.logger.warn({
                    message: `No code review execution updated`,
                    context: CodeReviewExecutionRepository.name,
                    metadata: { conditions, codeReviewExecution },
                });
                return null;
            }

            const updated = await this.codeReviewExecutionRepository.findOne({
                where: conditions,
            });

            if (!updated) {
                this.logger.warn({
                    message: `No code review execution found after update`,
                    context: CodeReviewExecutionRepository.name,
                    metadata: { conditions, codeReviewExecution },
                });
                return null;
            }

            return mapSimpleModelToEntity(updated, CodeReviewExecutionEntity);
        } catch (error) {
            this.logger.error({
                message: 'Error updating code review execution',
                error,
                context: CodeReviewExecutionRepository.name,
                metadata: { filter, codeReviewExecution },
            });

            return null;
        }
    }

    async find(
        filter?: Partial<CodeReviewExecution>,
    ): Promise<CodeReviewExecutionEntity[]> {
        try {
            const conditions = this.getFilterConditions(filter);

            const found = await this.codeReviewExecutionRepository.find({
                where: conditions,
            });

            if (!found || found.length === 0) {
                this.logger.warn({
                    message: 'No code review executions found',
                    context: CodeReviewExecutionRepository.name,
                    metadata: { filter },
                });

                return [];
            }

            return mapSimpleModelsToEntities(found, CodeReviewExecutionEntity);
        } catch (error) {
            this.logger.error({
                message: 'Error finding code review executions',
                error,
                context: CodeReviewExecutionRepository.name,
                metadata: { filter },
            });

            return [];
        }
    }

    async findOne(
        filter?: Partial<CodeReviewExecution>,
    ): Promise<CodeReviewExecutionEntity | null> {
        try {
            const conditions = this.getFilterConditions(filter);

            const found = await this.codeReviewExecutionRepository.findOne({
                where: conditions,
            });

            if (!found) {
                this.logger.warn({
                    message: 'Code review execution not found',
                    context: CodeReviewExecutionRepository.name,
                    metadata: { filter },
                });

                return null;
            }

            return mapSimpleModelToEntity(found, CodeReviewExecutionEntity);
        } catch (error) {
            this.logger.error({
                message: 'Error finding code review execution',
                error,
                context: CodeReviewExecutionRepository.name,
                metadata: { filter },
            });

            return null;
        }
    }

    async delete(uuid: string): Promise<boolean> {
        try {
            const res = await this.codeReviewExecutionRepository.delete({
                uuid,
            });

            return res.affected > 0;
        } catch (error) {
            this.logger.error({
                message: 'Error deleting code review execution',
                error,
                context: CodeReviewExecutionRepository.name,
                metadata: { uuid },
            });

            return false;
        }
    }

    private getFilterConditions(
        filter: Partial<CodeReviewExecution>,
    ): FindOptionsWhere<CodeReviewExecutionModel> {
        const { automationExecution, ...restFilter } = filter || {};

        const automationExecutionCondition = createNestedConditions(
            'automationExecution',
            automationExecution,
        );

        return {
            ...restFilter,
            ...automationExecutionCondition,
        };
    }
}
