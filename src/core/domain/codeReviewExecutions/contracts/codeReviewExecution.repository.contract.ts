import { FindOperator } from 'typeorm';
import { IAutomationExecution } from '../../automation/interfaces/automation-execution.interface';
import { CodeReviewExecutionEntity } from '../entities/codeReviewExecution.entity';
import { CodeReviewExecution } from '../interfaces/codeReviewExecution.interface';

export const CODE_REVIEW_EXECUTION_REPOSITORY = Symbol(
    'CODE_REVIEW_EXECUTION_REPOSITORY',
);

export interface ICodeReviewExecutionRepository {
    create(
        codeReviewExecution: Omit<
            CodeReviewExecution,
            'uuid' | 'createdAt' | 'updatedAt'
        >,
    ): Promise<CodeReviewExecutionEntity | null>;

    update(
        filter: Partial<CodeReviewExecution>,
        codeReviewExecution: Partial<
            Omit<CodeReviewExecution, 'uuid' | 'createdAt' | 'updatedAt'>
        >,
    ): Promise<CodeReviewExecutionEntity | null>;

    find(
        filter?: Partial<CodeReviewExecution>,
    ): Promise<CodeReviewExecutionEntity[]>;

    findOne(
        filter?: Partial<CodeReviewExecution>,
    ): Promise<CodeReviewExecutionEntity | null>;

    delete(uuid: string): Promise<boolean>;
}
