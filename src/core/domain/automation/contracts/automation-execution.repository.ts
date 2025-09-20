import { FindOptionsWhere } from 'typeorm';
import { AutomationExecutionEntity } from '../entities/automation-execution.entity';
import { IAutomationExecution } from '../interfaces/automation-execution.interface';

export const AUTOMATION_EXECUTION_REPOSITORY_TOKEN = Symbol(
    'AutomationExecutionRepository',
);

export interface IAutomationExecutionRepository {
    create(
        automationExecution: Omit<IAutomationExecution, 'uuid'>,
    ): Promise<AutomationExecutionEntity | null>;
    update(
        filter: Partial<IAutomationExecution>,
        data: Omit<
            Partial<IAutomationExecution>,
            'uuid' | 'createdAt' | 'updatedAt'
        >,
    ): Promise<AutomationExecutionEntity | null>;
    delete(uuid: string): Promise<void>;
    findById(uuid: string): Promise<AutomationExecutionEntity | null>;
    find(
        filter?: Partial<IAutomationExecution>,
    ): Promise<AutomationExecutionEntity[]>;
    findLatestExecutionByFilters(
        filters?: Partial<any>,
    ): Promise<AutomationExecutionEntity | null>;
    findByPeriodAndTeamAutomationId(
        startDate: Date,
        endDate: Date,
        teamAutomationId: string,
    ): Promise<AutomationExecutionEntity[]>;
}
