import { AutomationStatus } from '../../automation/enums/automation-status';
import { IAutomationExecution } from '../../automation/interfaces/automation-execution.interface';

export type CodeReviewExecution = {
    uuid: string;
    createdAt: Date;
    updatedAt: Date;

    automationExecution: Partial<IAutomationExecution>;
    status: AutomationStatus;
    message?: string | undefined;
};
