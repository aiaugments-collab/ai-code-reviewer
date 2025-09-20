import { GenerateIssuesFromPrClosedUseCase } from './generate-issues-from-pr-closed.use-case';
import { GetIssueByIdUseCase } from './get-issue-by-id.use-case';
import { GetIssuesByFiltersUseCase } from './get-issues-by-filters.use-case';
import { GetIssuesUseCase } from './get-issues.use-case';
import { GetTotalIssuesUseCase } from './get-total-issues.use-case';
import { UpdateIssuePropertyUseCase } from './update-issue-property.use-case';

export const UseCases = [
    GenerateIssuesFromPrClosedUseCase,
    GetIssuesByFiltersUseCase,
    GetIssuesUseCase,
    GetTotalIssuesUseCase,
    GetIssueByIdUseCase,
    UpdateIssuePropertyUseCase,
];