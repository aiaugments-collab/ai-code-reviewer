import { Injectable, Inject } from '@nestjs/common';
import { ISSUES_REPOSITORY_TOKEN } from '@/core/domain/issues/contracts/issues.repository';
import { IIssuesRepository } from '@/core/domain/issues/contracts/issues.repository';
import { IssuesEntity } from '@/core/domain/issues/entities/issues.entity';
import { IIssue } from '@/core/domain/issues/interfaces/issues.interface';
import { IIssuesService } from '@/core/domain/issues/contracts/issues.service.contract';
import { IssueStatus } from '@/config/types/general/issues.type';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { LabelType } from '@/shared/utils/codeManagement/labels';
import { GetIssuesByFiltersDto } from '@/core/infrastructure/http/dtos/get-issues-by-filters.dto';

@Injectable()
export class IssuesService implements IIssuesService {
    constructor(
        @Inject(ISSUES_REPOSITORY_TOKEN)
        private readonly issuesRepository: IIssuesRepository,
    ) {}

    getNativeCollection() {
        return this.issuesRepository.getNativeCollection();
    }

    async create(issue: Omit<IIssue, 'uuid'>): Promise<IssuesEntity> {
        return this.issuesRepository.create(issue);
    }

    //#region Find
    async findByFileAndStatus(
        organizationId: string,
        repositoryId: string,
        filePath: string,
        status?: IssueStatus,
    ): Promise<IssuesEntity[] | null> {
        return this.issuesRepository.findByFileAndStatus(
            organizationId,
            repositoryId,
            filePath,
            status,
        );
    }

    async findById(uuid: string): Promise<IssuesEntity | null> {
        return await this.issuesRepository.findById(uuid);
    }

    async findOne(filter?: Partial<IIssue>): Promise<IssuesEntity | null> {
        return this.issuesRepository.findOne(filter);
    }

    async find(organizationId: string): Promise<IssuesEntity[]> {
        return await this.issuesRepository.find(organizationId);
    }

    async findByFilters(filter?: GetIssuesByFiltersDto): Promise<IssuesEntity[]> {
        return await this.issuesRepository.findByFilters(filter);
    }

    async count(filter?: GetIssuesByFiltersDto): Promise<number> {
        return await this.issuesRepository.count(filter);
    }
    //#endregion

    //#region Update
    async update(
        issue: IssuesEntity,
        updateData: Partial<IIssue>,
    ): Promise<IssuesEntity | null> {
        return this.issuesRepository.update(issue, updateData);
    }

    async updateLabel(
        uuid: string,
        label: LabelType,
    ): Promise<IssuesEntity | null> {
        return this.issuesRepository.updateLabel(uuid, label);
    }

    async updateSeverity(
        uuid: string,
        severity: SeverityLevel,
    ): Promise<IssuesEntity | null> {
        return this.issuesRepository.updateSeverity(uuid, severity);
    }
    async updateStatus(
        uuid: string,
        status: IssueStatus,
    ): Promise<IssuesEntity | null> {
        return this.issuesRepository.updateStatus(uuid, status);
    }

    async updateStatusByIds(
        uuids: string[],
        status: IssueStatus,
    ): Promise<IssuesEntity[] | null> {
        return this.issuesRepository.updateStatusByIds(uuids, status);
    }
    //#endregion

    async addSuggestionIds(
        uuid: string,
        suggestionIds: string[],
    ): Promise<IssuesEntity | null> {
        return this.issuesRepository.addSuggestionIds(uuid, suggestionIds);
    }
}
