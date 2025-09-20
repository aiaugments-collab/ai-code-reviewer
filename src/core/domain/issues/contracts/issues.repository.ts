import { IssueStatus } from '@/config/types/general/issues.type';
import { IssuesEntity } from '../entities/issues.entity';
import { IIssue } from '../interfaces/issues.interface';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { LabelType } from '@/shared/utils/codeManagement/labels';

export const ISSUES_REPOSITORY_TOKEN = Symbol('IssuesRepository');

export interface IIssuesRepository {
    getNativeCollection(): any;

    create(issue: Omit<IIssue, 'uuid'>): Promise<IssuesEntity>;

    findById(uuid: string): Promise<IssuesEntity | null>;
    findOne(filter?: Partial<IIssue>): Promise<IssuesEntity | null>;
    findByFileAndStatus(
        organizationId: string,
        repositoryId: string,
        filePath: string,
        status?: IssueStatus,
    ): Promise<IssuesEntity[] | null>;
    find(organizationId: string): Promise<IssuesEntity[]>;
    findByFilters(filter?: Partial<IIssue>): Promise<IssuesEntity[]>;

    count(filter?: Partial<IIssue>): Promise<number>;

    update(
        issue: IssuesEntity,
        updateData: Partial<IIssue>,
    ): Promise<IssuesEntity | null>;

    updateLabel(
        uuid: string,
        label: LabelType,
    ): Promise<IssuesEntity | null>;

    updateSeverity(
        uuid: string,
        severity: SeverityLevel,
    ): Promise<IssuesEntity | null>;

    updateStatus(
        uuid: string,
        status: IssueStatus,
    ): Promise<IssuesEntity | null>;

    updateStatusByIds(
        uuids: string[],
        status: IssueStatus,
    ): Promise<IssuesEntity[] | null>;

    addSuggestionIds(
        uuid: string,
        suggestionIds: string[],
    ): Promise<IssuesEntity | null>;
}
