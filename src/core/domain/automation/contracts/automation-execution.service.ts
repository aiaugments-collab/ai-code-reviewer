import { AutomationExecutionEntity } from '../entities/automation-execution.entity';
import { IAutomationExecution } from '../interfaces/automation-execution.interface';
import { IAutomationExecutionRepository } from './automation-execution.repository';

export const AUTOMATION_EXECUTION_SERVICE_TOKEN = Symbol(
    'AutomationExecutionService',
);

export interface IAutomationExecutionService
    extends IAutomationExecutionRepository {
    findOneByOrganizationIdAndIssueId(
        organizationId: string,
        issueId: string,
    ): Promise<boolean>;

    createCodeReview(
        automationExecution: Omit<
            IAutomationExecution,
            'uuid' | 'createdAt' | 'updatedAt' | 'codeReviewExecutions'
        >,
        message: string,
    ): Promise<AutomationExecutionEntity | null>;

    updateCodeReview(
        filter: Partial<IAutomationExecution>,
        automationExecution: Partial<
            Omit<
                IAutomationExecution,
                'uuid' | 'createdAt' | 'updatedAt' | 'codeReviewExecutions'
            >
        >,
        message: string,
    ): Promise<AutomationExecutionEntity | null>;
}
