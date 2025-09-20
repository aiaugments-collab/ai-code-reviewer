import { CodeReviewExecution } from '../../codeReviewExecutions/interfaces/codeReviewExecution.interface';
import { AutomationStatus } from '../enums/automation-status';
import { ITeamAutomation } from './team-automation.interface';

export interface IAutomationExecution {
    uuid: string;
    createdAt?: Date;
    updatedAt?: Date;
    status: AutomationStatus;
    errorMessage?: string;
    dataExecution?: any;
    pullRequestNumber?: number;
    repositoryId?: string;
    teamAutomation?: Partial<ITeamAutomation>;
    codeReviewExecutions?: Array<Partial<CodeReviewExecution>>;
    origin: string;
}
