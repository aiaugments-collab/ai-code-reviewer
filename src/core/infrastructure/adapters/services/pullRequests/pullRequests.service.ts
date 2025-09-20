import { Inject, Injectable } from '@nestjs/common';
import { PinoLoggerService } from '../logger/pino.service';
import {
    IPullRequestsRepository,
    PULL_REQUESTS_REPOSITORY_TOKEN,
} from '@/core/domain/pullRequests/contracts/pullRequests.repository';
import { PullRequestsEntity } from '@/core/domain/pullRequests/entities/pullRequests.entity';
import {
    IPullRequests,
    ISuggestion,
    IFile,
    IPullRequestUser,
    ICommit,
    ISuggestionByPR,
} from '@/core/domain/pullRequests/interfaces/pullRequests.interface';
import { IPullRequestsService } from '@/core/domain/pullRequests/contracts/pullRequests.service.contracts';
import { PullRequestState } from '@/shared/domain/enums/pullRequestState.enum';
import { v4 as uuidv4 } from 'uuid';
import { CodeManagementService } from '../platformIntegration/codeManagement.service';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { DeliveryStatus } from '@/core/domain/pullRequests/enums/deliveryStatus.enum';
import { Repository } from '@/config/types/general/codeReview.type';

@Injectable()
export class PullRequestsService implements IPullRequestsService {
    constructor(
        @Inject(PULL_REQUESTS_REPOSITORY_TOKEN)
        private readonly pullRequestsRepository: IPullRequestsRepository,

        private readonly codeManagement: CodeManagementService,

        private readonly logger: PinoLoggerService,
    ) {}

    getNativeCollection() {
        throw new Error('Method not implemented.');
    }

    //#region Create
    async create(
        suggestion: Omit<IPullRequests, 'uuid'>,
    ): Promise<PullRequestsEntity> {
        return this.pullRequestsRepository.create(suggestion);
    }
    //#endregion

    //#region Get/Find
    async findById(uuid: string): Promise<PullRequestsEntity | null> {
        return this.pullRequestsRepository.findById(uuid);
    }

    async findOne(
        filter?: Partial<IPullRequests>,
    ): Promise<PullRequestsEntity | null> {
        return this.pullRequestsRepository.findOne(filter);
    }

    async find(filter?: Partial<IPullRequests>): Promise<PullRequestsEntity[]> {
        return this.pullRequestsRepository.find(filter);
    }

    findByNumberAndRepositoryName(
        prNumber: number,
        repositoryName: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<PullRequestsEntity | null> {
        return this.pullRequestsRepository.findByNumberAndRepositoryName(
            prNumber,
            repositoryName,
            organizationAndTeamData,
        );
    }

    findByNumberAndRepositoryId(
        prNumber: number,
        repositoryId: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<PullRequestsEntity | null> {
        return this.pullRequestsRepository.findByNumberAndRepositoryId(
            prNumber,
            repositoryId,
            organizationAndTeamData,
        );
    }

    async findSuggestionsByPRAndFilename(
        prNumber: number,
        repoFullName: string,
        filename: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ) {
        return this.pullRequestsRepository.findSuggestionsByPRAndFilename(
            prNumber,
            repoFullName,
            filename,
            organizationAndTeamData,
        );
    }

    async findSuggestionsByPR(
        organizationId: string,
        prNumber: number,
        deliveryStatus: DeliveryStatus,
    ): Promise<ISuggestion[]> {
        return this.pullRequestsRepository.findSuggestionsByPR(
            organizationId,
            prNumber,
            deliveryStatus,
        );
    }

    findFileWithSuggestions(
        prnumber: number,
        repositoryName: string,
        filePath: string,
    ): Promise<IFile | null> {
        return this.pullRequestsRepository.findFileWithSuggestions(
            prnumber,
            repositoryName,
            filePath,
        );
    }

    async findByOrganizationAndRepositoryWithStatusAndSyncedFlag(
        organizationId: string,
        repository: Pick<Repository, 'id' | 'fullName'>,
        status?: PullRequestState,
        syncedEmbeddedSuggestions?: boolean,
    ): Promise<IPullRequests[]> {
        return this.pullRequestsRepository.findByOrganizationAndRepositoryWithStatusAndSyncedFlag(
            organizationId,
            repository,
            status,
            syncedEmbeddedSuggestions,
        );
    }

    async findByOrganizationAndRepositoryWithStatusAndSyncedWithIssuesFlag(
        organizationId: string,
        repository: Pick<Repository, 'id' | 'fullName'>,
        status?: PullRequestState,
        syncedEmbeddedSuggestions?: boolean,
    ): Promise<IPullRequests[]> {
        return this.pullRequestsRepository.findByOrganizationAndRepositoryWithStatusAndSyncedWithIssuesFlag(
            organizationId,
            repository,
            status,
            syncedEmbeddedSuggestions,
        );
    }

    //#endregion

    //#region Add
    async addFileToPullRequest(
        pullRequestNumber: number,
        repositoryName: string,
        newFile: Omit<IFile, 'id'>,
    ): Promise<PullRequestsEntity | null> {
        return this.pullRequestsRepository.addFileToPullRequest(
            pullRequestNumber,
            repositoryName,
            newFile,
        );
    }

    async addSuggestionToFile(
        fileId: string,
        newSuggestion: Omit<ISuggestion, 'id'>,
        pullRequestNumber: number,
        repositoryName: string,
    ): Promise<PullRequestsEntity | null> {
        return this.pullRequestsRepository.addSuggestionToFile(
            fileId,
            newSuggestion,
            pullRequestNumber,
            repositoryName,
        );
    }

    async addPrLevelSuggestions(
        pullRequestNumber: number,
        repositoryName: string,
        prLevelSuggestions: ISuggestionByPR[],
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<PullRequestsEntity | null> {
        try {
            const existingPR = await this.findByNumberAndRepositoryName(
                pullRequestNumber,
                repositoryName,
                organizationAndTeamData,
            );

            if (!existingPR) {
                this.logger.warn({
                    message: `PR not found when trying to add PR level suggestions`,
                    context: PullRequestsService.name,
                    metadata: {
                        pullRequestNumber,
                        repositoryName,
                        organizationAndTeamData,
                    },
                });
                return null;
            }

            const existingPrLevelSuggestions =
                existingPR.prLevelSuggestions || [];
            const updatedPrLevelSuggestions = [
                ...existingPrLevelSuggestions,
                ...prLevelSuggestions,
            ];

            return this.update(existingPR, {
                prLevelSuggestions: updatedPrLevelSuggestions,
                updatedAt: new Date().toISOString(),
            });
        } catch (error) {
            this.logger.error({
                message: `Failed to add PR level suggestions to PR#${pullRequestNumber}`,
                context: PullRequestsService.name,
                error,
                metadata: {
                    pullRequestNumber,
                    repositoryName,
                    suggestionsCount: prLevelSuggestions.length,
                    organizationAndTeamData,
                },
            });
            return null;
        }
    }
    //#endregion

    //#region Update
    async update(
        pullRequest: PullRequestsEntity,
        updateData: Partial<IPullRequests>,
    ): Promise<PullRequestsEntity | null> {
        return this.pullRequestsRepository.update(pullRequest, updateData);
    }

    async updateFile(
        fileId: string,
        updateData: Partial<IFile>,
    ): Promise<PullRequestsEntity | null> {
        return this.pullRequestsRepository.updateFile(fileId, updateData);
    }

    async updateSuggestion(
        suggestionId: string,
        updateData: Partial<ISuggestion>,
    ): Promise<PullRequestsEntity | null> {
        return this.pullRequestsRepository.updateSuggestion(
            suggestionId,
            updateData,
        );
    }

    async updateSyncedSuggestionsFlag(
        pullRequestNumbers: number[],
        repositoryId: string,
        organizationId: string,
        synced: boolean,
    ): Promise<void> {
        return this.pullRequestsRepository.updateSyncedSuggestionsFlag(
            pullRequestNumbers,
            repositoryId,
            organizationId,
            synced,
        );
    }

    async updateSyncedWithIssuesFlag(
        prNumber: number,
        repositoryId: string,
        organizationId: string,
        synced: boolean,
    ): Promise<void> {
        return this.pullRequestsRepository.updateSyncedWithIssuesFlag(
            prNumber,
            repositoryId,
            organizationId,
            synced,
        );
    }
    //#endregion

    //#region Save Full PR Structure
    async aggregateAndSaveDataStructure(
        pullRequest: any,
        repository: any,
        changedFiles: Array<any>,
        prioritizedSuggestions: Array<ISuggestion>,
        unusedSuggestions: Array<ISuggestion>,
        platformType: PlatformType,
        organizationAndTeamData: OrganizationAndTeamData,
        commits: ICommit[],
        prLevelSuggestions?: ISuggestionByPR[],
    ): Promise<IPullRequests | null> {
        try {
            const organizationId = organizationAndTeamData?.organizationId;

            if (!organizationId) {
                this.logger.error({
                    message: `organizationId is missing in organizationAndTeamData for PR #${pullRequest?.number}`,
                    context: PullRequestsService.name,
                    metadata: {
                        organizationAndTeamData,
                        repositoryName: repository?.name,
                        pullRequestNumber: pullRequest?.number,
                    },
                });
                return null;
            }

            const enrichedPullRequest = {
                ...pullRequest,
                organizationId,
                commits,
            };

            // Sometimes gitlab sends an array of ids instead of assignees and reviewers
            const shouldGetAssigneesFromIds =
                !enrichedPullRequest.assignees &&
                enrichedPullRequest.assignee_ids;
            if (shouldGetAssigneesFromIds) {
                const foundAssignees = await this.getUsers(
                    organizationAndTeamData,
                    enrichedPullRequest.assignee_ids,
                );
                enrichedPullRequest.assignees = foundAssignees;
            }

            const shouldGetReviewersFromIds =
                (!enrichedPullRequest.reviewers ||
                    !enrichedPullRequest.requested_reviewers) &&
                enrichedPullRequest.reviewer_ids;
            if (shouldGetReviewersFromIds) {
                const foundReviewers = await this.getUsers(
                    organizationAndTeamData,
                    enrichedPullRequest.reviewer_ids,
                );
                enrichedPullRequest.reviewers = foundReviewers;
            }

            const existingPR =
                await this.pullRequestsRepository.findByNumberAndRepositoryName(
                    pullRequest?.number,
                    repository.name,
                    organizationAndTeamData,
                );

            if (!existingPR) {
                return this.handleInitialPullRequest(
                    enrichedPullRequest,
                    repository,
                    changedFiles,
                    prioritizedSuggestions,
                    unusedSuggestions,
                    platformType,
                    organizationAndTeamData,
                    prLevelSuggestions,
                );
            }

            await this.update(existingPR, {
                status: await this.identifyPullRequestStatus(pullRequest),
                merged: this.extractMergedStatus(pullRequest),
                updatedAt: new Date().toISOString(),
                closedAt: this.extractClosedAt(pullRequest),
                user: await this.extractUser(
                    pullRequest.user,
                    organizationAndTeamData,
                    platformType,
                    pullRequest?.number,
                ),
                reviewers: await this.extractUsers(
                    (pullRequest.reviewers ||
                        pullRequest?.requested_reviewers) ??
                        enrichedPullRequest.reviewers,
                    organizationAndTeamData,
                    platformType,
                    pullRequest?.number,
                ),
                assignees: await this.extractUsers(
                    (pullRequest.assignees || pullRequest?.participants) ??
                        enrichedPullRequest.assignees,
                    organizationAndTeamData,
                    platformType,
                    pullRequest?.number,
                ),
                commits: enrichedPullRequest.commits,
                isDraft: enrichedPullRequest.isDraft ?? false,
            });

            if (prLevelSuggestions && prLevelSuggestions.length > 0) {
                await this.addPrLevelSuggestions(
                    pullRequest.number,
                    repository.name,
                    prLevelSuggestions,
                    organizationAndTeamData,
                );
            }

            return this.handleExistingPullRequest(
                enrichedPullRequest,
                repository,
                changedFiles,
                prioritizedSuggestions,
                unusedSuggestions,
                organizationAndTeamData,
            );
        } catch (error) {
            this.logger.log({
                message: `Failed to aggregate and save code review data for PR#${pullRequest?.number}`,
                context: PullRequestsService.name,
                error: error,
                metadata: {
                    pullRequestNumber: pullRequest?.number,
                    repositoryName: repository?.name,
                },
            });
        }
    }

    private async initializeCodeReviewStructure(
        pullRequest: any,
        repository: any,
        platformType: PlatformType,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<Partial<IPullRequests>> {
        try {
            return {
                title: pullRequest.title || '',
                status: await this.identifyPullRequestStatus(pullRequest),
                merged: this.extractMergedStatus(pullRequest),
                number: pullRequest.number,
                url: pullRequest.url || '',
                baseBranchRef: this.extractBaseBranchRef(pullRequest),
                headBranchRef: this.extractHeadBranchRef(pullRequest),
                repository: {
                    id: repository.id?.toString() || '',
                    name: repository.name || '',
                    fullName: this.extractRepoFullName(pullRequest),
                    language: repository.language || '',
                    url: repository.url || '',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
                openedAt: this.extractOpenedAt(pullRequest),
                closedAt: this.extractClosedAt(pullRequest),
                files: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                totalAdded: 0,
                totalDeleted: 0,
                totalChanges: 0,
                provider: platformType,
                user:
                    (await this.extractUser(
                        pullRequest.user,
                        organizationAndTeamData,
                        platformType,
                        pullRequest?.number,
                    )) || null,
                reviewers:
                    (await this.extractUsers(
                        pullRequest.reviewers,
                        organizationAndTeamData,
                        platformType,
                        pullRequest?.number,
                    )) || [],
                assignees:
                    (await this.extractUsers(
                        pullRequest.assignees,
                        organizationAndTeamData,
                        platformType,
                        pullRequest?.number,
                    )) || [],
                organizationId: pullRequest.organizationId,
                commits: Array.isArray(pullRequest.commits)
                    ? [...pullRequest.commits]
                    : [],
                syncedEmbeddedSuggestions: false,
                syncedWithIssues: false,
                prLevelSuggestions: [],
                isDraft: pullRequest.isDraft ?? false,
            };
        } catch (error) {
            this.logger.log({
                message: `Failed to initialize code review structure for PR#${pullRequest?.number}`,
                context: PullRequestsService.name,
                error: error,
                metadata: {
                    pullRequestId: pullRequest.id,
                    repositoryName: repository.name,
                },
            });
        }
    }

    private async identifyPullRequestStatus(pullRequest: any): Promise<string> {
        if (
            pullRequest.state === 'open' ||
            pullRequest.state === 'opened' ||
            pullRequest.state === 'OPEN' ||
            pullRequest.status === 'active'
        ) {
            return PullRequestState.OPENED;
        } else if (
            pullRequest.state === 'close' ||
            pullRequest.state === 'closed' ||
            pullRequest.state === 'DECLINED' ||
            pullRequest.state === 'merge' ||
            pullRequest.state === 'merged' ||
            pullRequest.state === 'MERGED' ||
            pullRequest.status === 'completed'
        ) {
            return PullRequestState.CLOSED;
        } else {
            return PullRequestState.OPENED;
        }
    }

    private async addFilesToStructure(
        baseStructure: Partial<IPullRequests>,
        changedFiles: Array<any>,
        prioritizedSuggestions: Array<ISuggestion>,
        unusedSuggestions: Array<ISuggestion>,
    ): Promise<Partial<IPullRequests>> {
        try {
            baseStructure.files = changedFiles.map((file) => ({
                id: uuidv4(),
                sha: file.sha,
                path: file.filename,
                filename: file.filename.split('/').pop() || '',
                previousName: file.previous_filename || '',
                status: file.status,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                suggestions: this.getSuggestionsForFile(
                    file.filename,
                    prioritizedSuggestions,
                    unusedSuggestions,
                ),
                added: file.additions ?? 0,
                deleted: file.deletions ?? 0,
                changes: file.changes ?? 0,
            }));

            const { totalAdded, totalDeleted, totalChanges } =
                this.generateTotalFileMetrics(baseStructure.files);

            baseStructure.totalAdded = totalAdded;
            baseStructure.totalDeleted = totalDeleted;
            baseStructure.totalChanges = totalChanges;

            return baseStructure;
        } catch (error) {
            this.logger.log({
                message: `Failed to add files to structure for PR#${baseStructure?.number}`,
                context: PullRequestsService.name,
                error: error,
                metadata: {
                    filesCount: changedFiles.length,
                },
            });
        }
    }

    private getSuggestionsForFile(
        filePath: string,
        prioritizedSuggestions: Array<ISuggestion>,
        unusedSuggestions: Array<ISuggestion>,
    ): Array<ISuggestion> {
        try {
            if (
                prioritizedSuggestions.length <= 0 &&
                unusedSuggestions.length <= 0
            ) {
                return [];
            }

            const allSuggestions = [
                ...prioritizedSuggestions,
                ...unusedSuggestions,
            ];

            const filteredSuggestions = allSuggestions
                .filter((suggestion) => {
                    const matches = suggestion.relevantFile === filePath;
                    return matches;
                })
                .map((suggestion) => ({
                    ...suggestion,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                }));

            return filteredSuggestions;
        } catch (error) {
            this.logger.log({
                message: `Failed to get suggestions for file ${filePath}`,
                context: PullRequestsService.name,
                error: error,
                metadata: {
                    filePath,
                    totalSuggestions:
                        prioritizedSuggestions.length +
                        unusedSuggestions.length,
                },
            });
        }
    }

    private async handleInitialPullRequest(
        pullRequest: any,
        repository: any,
        changedFiles: Array<any>,
        prioritizedSuggestions: Array<ISuggestion>,
        unusedSuggestions: Array<ISuggestion>,
        platformType: PlatformType,
        organizationAndTeamData: OrganizationAndTeamData,
        prLevelSuggestions?: ISuggestionByPR[],
    ): Promise<IPullRequests> {
        try {
            this.logger.log({
                message: `Starting pull request data aggregation for PR#${pullRequest?.number}`,
                context: PullRequestsService.name,
                metadata: {
                    pullRequestNumber: pullRequest?.number,
                    repositoryName: repository?.name,
                    filesCount: changedFiles?.length,
                    suggestionsCount:
                        prioritizedSuggestions.length +
                        unusedSuggestions.length,
                },
            });

            let structure = await this.initializeCodeReviewStructure(
                pullRequest,
                repository,
                platformType,
                organizationAndTeamData,
            );

            structure = await this.addFilesToStructure(
                structure,
                changedFiles,
                prioritizedSuggestions,
                unusedSuggestions,
            );

            if (prLevelSuggestions && prLevelSuggestions.length > 0) {
                structure.prLevelSuggestions = prLevelSuggestions;
            }

            return this.create(structure as Omit<IPullRequests, 'uuid'>);
        } catch (error) {
            this.logger.log({
                message: `Failed to process initial pull request data for PR#${pullRequest?.number}`,
                context: PullRequestsService.name,
                error: error,
                metadata: {
                    pullRequestNumber: pullRequest?.number,
                    repositoryName: repository?.name,
                    filesCount: changedFiles?.length,
                    prioritizedSuggestionsCount: prioritizedSuggestions?.length,
                },
            });
        }
    }

    private async handleExistingPullRequest(
        pullRequest: any,
        repository: any,
        changedFiles: Array<any>,
        prioritizedSuggestions: Array<ISuggestion>,
        unusedSuggestions: Array<ISuggestion>,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<IPullRequests> {
        try {
            for (const file of changedFiles) {
                const existingFile = await this.findFileWithSuggestions(
                    pullRequest?.number,
                    repository?.name,
                    file?.filename,
                );

                if (existingFile) {
                    const updatedFile = {
                        patch: file.patch ?? '',
                        status: file.status ?? '',
                        added: file.additions ?? 0,
                        deleted: file.deletions ?? 0,
                        changes: file.changes ?? 0,
                        reviewMode: file.reviewMode ?? '',
                        codeReviewModelUsed: file.codeReviewModelUsed ?? '',
                    };

                    await this.updateFile(existingFile.id, updatedFile);

                    const newSuggestions = this.getSuggestionsForFile(
                        file.filename,
                        prioritizedSuggestions,
                        unusedSuggestions,
                    );

                    for (const suggestion of newSuggestions) {
                        await this.addSuggestionToFile(
                            existingFile.id,
                            suggestion,
                            pullRequest?.number,
                            repository?.name,
                        );
                    }

                    this.logger.log({
                        message: `Added new suggestions to existing file ${file.filename} for PR#${pullRequest?.number}`,
                        context: PullRequestsService.name,
                        metadata: {
                            fileId: existingFile.id,
                            newSuggestionsCount: newSuggestions.length,
                        },
                    });
                } else {
                    const formattedFile = {
                        path: file.filename,
                        sha: file.sha,
                        filename: file.filename.split('/').pop() || '',
                        previousName: file.previous_filename || '',
                        status: file.status,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        suggestions: this.getSuggestionsForFile(
                            file.filename,
                            prioritizedSuggestions,
                            unusedSuggestions,
                        ),
                        added: file.additions ?? 0,
                        deleted: file.deletions ?? 0,
                        changes: file.changes ?? 0,
                    };

                    await this.pullRequestsRepository.addFileToPullRequest(
                        pullRequest.number,
                        repository.name,
                        formattedFile,
                    );

                    this.logger.log({
                        message: `Added new file ${file.filename} to PR#${pullRequest?.number}`,
                        context: PullRequestsService.name,
                        metadata: {
                            filename: file.filename,
                            suggestionsCount: formattedFile.suggestions.length,
                        },
                    });
                }
            }

            const newPrEntity = await this.findByNumberAndRepositoryName(
                pullRequest?.number,
                repository?.name,
                organizationAndTeamData,
            );

            const { totalAdded, totalDeleted, totalChanges } =
                this.generateTotalFileMetrics(newPrEntity?.files || []);

            const updatedPr = await this.update(newPrEntity, {
                totalAdded,
                totalDeleted,
                totalChanges,
                updatedAt: new Date().toISOString(),
            });

            return updatedPr;
        } catch (error) {
            this.logger.log({
                message: `Failed to process existing pull request for PR#${pullRequest?.number}`,
                context: PullRequestsService.name,
                error: error,
                metadata: {
                    pullRequestNumber: pullRequest?.number,
                    repositoryName: repository?.name,
                    changedFilesCount: changedFiles?.length,
                },
            });
        }
    }

    async extractUser(
        data: any,
        organizationAndTeamData: OrganizationAndTeamData,
        platformType: PlatformType,
        prNumber: number,
    ): Promise<IPullRequestUser | null> {
        try {
            const rawEmail = data?.email ?? data?.uniqueName;

            /**
             *  used to extract data from bitbucket participants,
             *  so we can build the assignee array properly.
             */
            if (data?.role) {
                const completeUser =
                    await this.codeManagement.getUserByUsername(
                        {
                            organizationAndTeamData,
                            username:
                                data?.login ||
                                data?.username ||
                                data?.nickname ||
                                '',
                        },
                        platformType,
                    );

                return {
                    id: data?.user?.uuid.replace(/[{}]/g, '') || '',
                    username: data?.user?.nickname || '',
                    name: data?.user?.display_name || '',
                    email: completeUser?.email || null,
                };
            }

            if (!data?.email && !data?.uniqueName) {
                const completeUser =
                    await this.codeManagement.getUserByUsername(
                        {
                            organizationAndTeamData,
                            username:
                                data?.login ||
                                data?.username ||
                                data?.nickname ||
                                data?.descriptor ||
                                '',
                        },
                        platformType,
                    );

                return {
                    id: data?.id || data?.uuid || '',
                    username:
                        data?.login ||
                        data?.username ||
                        data?.nickname ||
                        completeUser?.principalName ||
                        '',
                    name: this.extractUserName(data, completeUser),
                    email:
                        completeUser?.email ||
                        completeUser?.mailAddress ||
                        null,
                };
            }

            // Gitlab returns [REDACTED] instead of a valid email, so we can search for it by name.
            if (!this.isValidEmail(rawEmail)) {
                const completeUser =
                    await this.codeManagement.getUserByEmailOrName(
                        {
                            userName: data?.name || '',
                            organizationAndTeamData,
                        },
                        platformType,
                    );

                return {
                    id: completeUser.id,
                    username:
                        completeUser?.login ||
                        completeUser?.username ||
                        completeUser?.nickname ||
                        '',
                    name:
                        completeUser?.name ||
                        completeUser?.actor?.display_name ||
                        '',
                    email: completeUser?.email || null,
                };
            }

            return {
                id: data?.id || data?.uuid || '',
                username:
                    data?.login ||
                    data?.username ||
                    data?.nickname ||
                    data?.uniqueName ||
                    '',
                name: data?.actor?.display_name || data?.displayName || '',
                email: this.isValidEmail(rawEmail) ? rawEmail : null,
            };
        } catch (error) {
            this.logger.log({
                message: `Failed to extract user for PR#${prNumber}`,
                context: PullRequestsService.name,
                error: error,
                metadata: {
                    pullRequestNumber: prNumber,
                    organizationAndTeamData,
                },
            });
            return null;
        }
    }

    async extractUsers(
        data: any,
        organizationAndTeamData: OrganizationAndTeamData,
        platformType: PlatformType,
        prNumber: number,
    ): Promise<Array<IPullRequestUser>> {
        try {
            if (!data || !data.length) {
                return [];
            }

            if (data) {
                // Use Promise.all to handle the asynchronous extractUser calls
                // If were dealing with the participants array remove any object that is not an active participant
                return Promise.all(
                    data.map(async (user: any) => {
                        if (user.role && user.role != 'PARTICIPANT') {
                            return;
                        }
                        return this.extractUser(
                            user,
                            organizationAndTeamData,
                            platformType,
                            prNumber,
                        );
                    }),
                ).then((results) =>
                    results.filter((user) => user != undefined),
                );
            }
        } catch (error) {
            this.logger.log({
                message: `Failed to extract users for PR#${prNumber}`,
                context: PullRequestsService.name,
                error: error,
                metadata: {
                    pullRequestNumber: prNumber,
                    organizationAndTeamData,
                },
            });
            return [];
        }
    }

    private isValidEmail(email?: string): boolean {
        if (!email) {
            return false;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    private extractBaseBranchRef(pullRequest: any): string {
        return (
            pullRequest?.base?.ref ||
            pullRequest?.target_branch ||
            pullRequest?.destination?.branch ||
            ''
        );
    }

    private extractMergedStatus(pullRequest: any): boolean {
        return (
            pullRequest?.merged ||
            pullRequest?.state === 'merged' ||
            pullRequest?.state === 'MERGED' ||
            pullRequest?.action === 'merge' ||
            false
        );
    }

    private extractHeadBranchRef(pullRequest: any): string {
        return (
            pullRequest?.head?.ref ||
            pullRequest?.source_branch ||
            pullRequest?.source?.branch ||
            ''
        );
    }

    private extractOpenedAt(pullRequest: any): string {
        return (
            pullRequest?.created_at ||
            pullRequest?.created_on ||
            pullRequest?.creationDate ||
            ''
        );
    }

    private extractClosedAt(pullRequest: any): string {
        const closedStatus = ['MERGED', 'DECLINED', 'merge', 'close'];

        // bitbucket && gitlab
        if (
            closedStatus.includes(pullRequest?.state) ||
            closedStatus.includes(pullRequest?.action)
        ) {
            return pullRequest?.updated_at || pullRequest?.updated_on || '';
        }

        return pullRequest.closed_at || pullRequest.closedDate || '';
    }

    private extractRepoFullName(pullRequest: any): string {
        return (
            pullRequest?.repository?.full_name ||
            pullRequest?.repository?.path_with_namespace ||
            pullRequest?.base?.repo?.fullName ||
            pullRequest?.target?.path_with_namespace ||
            pullRequest?.destination?.repository?.full_name ||
            ''
        );
    }

    private generateTotalFileMetrics(files: Array<IFile>) {
        if (!files || !files.length) {
            return {
                totalAdded: 0,
                totalDeleted: 0,
                totalChanges: 0,
            };
        }

        const totalAdded = files.reduce(
            (acc, file) => acc + (file.added ?? 0),
            0,
        );
        const totalDeleted = files.reduce(
            (acc, file) => acc + (file.deleted ?? 0),
            0,
        );
        const totalChanges = files.reduce(
            (acc, file) => acc + (file.changes ?? 0),
            0,
        );

        return {
            totalAdded,
            totalDeleted,
            totalChanges,
        };
    }

    private async getUsers(
        organizationAndTeamData: OrganizationAndTeamData,
        userIds: Array<string>,
    ) {
        const foundUsers = await Promise.all(
            userIds.map(async (id) => {
                const foundUser = await this.codeManagement.getUserById({
                    organizationAndTeamData,
                    userId: id,
                });
                return foundUser
                    ? {
                          id: foundUser.id,
                          username: foundUser.username,
                          name: foundUser.name,
                      }
                    : null;
            }),
        );

        return foundUsers.filter((user) => user !== null);
    }

    private extractUserName(
        data: any | null | undefined,
        completeUser: any,
    ): string {
        return (
            data?.name ||
            data?.display_name ||
            data?.displayName ||
            completeUser?.name ||
            completeUser?.display_name ||
            completeUser?.displayName ||
            ''
        );
    }

    //#endregion
}
