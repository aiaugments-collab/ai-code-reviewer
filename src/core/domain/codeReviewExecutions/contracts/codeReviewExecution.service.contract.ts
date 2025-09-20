import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { ICodeReviewExecutionRepository } from './codeReviewExecution.repository.contract';
import { CodeReviewExecution } from '../interfaces/codeReviewExecution.interface';

export const CODE_REVIEW_EXECUTION_SERVICE = Symbol(
    'CODE_REVIEW_EXECUTION_SERVICE',
);

export interface ICodeReviewExecutionService
    extends ICodeReviewExecutionRepository {}
