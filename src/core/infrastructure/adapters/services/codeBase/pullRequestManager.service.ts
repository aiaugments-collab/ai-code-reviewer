import { Injectable } from '@nestjs/common';
import { FileChange } from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { CodeManagementService } from '../platformIntegration/codeManagement.service';
import { PinoLoggerService } from '../logger/pino.service';
import { IPullRequestManagerService } from '../../../../domain/codeBase/contracts/PullRequestManagerService.contract';
import { isFileMatchingGlob } from '@/shared/utils/glob-utils';
import { PullRequestAuthor } from '@/core/domain/platformIntegrations/types/codeManagement/pullRequests.type';
import { CacheService } from '@/shared/utils/cache/cache.service';
import { ICommit } from '@/core/domain/pullRequests/interfaces/pullRequests.interface';
import { Commit } from '@/config/types/general/commit.type';

@Injectable()
export class PullRequestHandlerService implements IPullRequestManagerService {
    constructor(
        private readonly codeManagementService: CodeManagementService,
        private readonly logger: PinoLoggerService,
        private readonly cacheService: CacheService,
    ) {}

    async getPullRequestDetails(
        organizationAndTeamData: OrganizationAndTeamData,
        repository: { name: string; id: any },
        prNumber: number,
    ): Promise<any> {
        // Existing implementation or add necessary implementation
    }

    async getChangedFiles(
        organizationAndTeamData: OrganizationAndTeamData,
        repository: { name: string; id: any },
        pullRequest: any,
        ignorePaths?: string[],
        lastCommit?: string,
    ): Promise<FileChange[]> {
        try {
            let changedFiles: FileChange[];

            if (lastCommit) {
                // Retrieve files changed since the last commit
                changedFiles =
                    await this.codeManagementService.getChangedFilesSinceLastCommit(
                        {
                            organizationAndTeamData,
                            repository,
                            prNumber: pullRequest?.number,
                            lastCommit,
                        },
                    );
            } else {
                // Retrieve all files changed in the pull request
                changedFiles =
                    await this.codeManagementService.getFilesByPullRequestId({
                        organizationAndTeamData,
                        repository,
                        prNumber: pullRequest?.number,
                    });
            }

            // Filter files based on ignorePaths and retrieve their content
            const filteredFiles = changedFiles?.filter((file) => {
                return !isFileMatchingGlob(file.filename, ignorePaths);
            });

            if (!filteredFiles?.length) {
                this.logger.warn({
                    message: `No files to review after filtering PR#${pullRequest?.number}`,
                    context: PullRequestHandlerService.name,
                    metadata: {
                        repository,
                        prNumber: pullRequest?.number,
                        ignorePaths,
                        changedFilePaths:
                            changedFiles?.map((file) => file.filename) || [],
                    },
                });
            }

            // Retrieve the content of the filtered files
            if (filteredFiles && filteredFiles.length > 0) {
                const filesWithContent = await Promise.all(
                    filteredFiles.map(async (file) => {
                        try {
                            const fileContent =
                                await this.codeManagementService.getRepositoryContentFile(
                                    {
                                        organizationAndTeamData,
                                        repository,
                                        file,
                                        pullRequest,
                                    },
                                );

                            // If the content exists and is in base64, decode it
                            const content = fileContent?.data?.content;
                            let decodedContent = content;

                            if (
                                content &&
                                fileContent?.data?.encoding === 'base64'
                            ) {
                                decodedContent = Buffer.from(
                                    content,
                                    'base64',
                                ).toString('utf-8');
                            }

                            return {
                                ...file,
                                fileContent: decodedContent,
                            };
                        } catch (error) {
                            this.logger.error({
                                message: `Error fetching content for file: ${file.filename}`,
                                context: PullRequestHandlerService.name,
                                error,
                                metadata: {
                                    ...pullRequest,
                                    repository,
                                    filename: file.filename,
                                },
                            });
                            return file;
                        }
                    }),
                );

                return filesWithContent;
            }

            return filteredFiles || [];
        } catch (error) {
            this.logger.error({
                message: 'Error fetching changed files',
                context: PullRequestHandlerService.name,
                error,
                metadata: { ...pullRequest, repository },
            });
            throw error;
        }
    }

    async getPullRequestAuthorsWithCache(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<PullRequestAuthor[]> {
        const cacheKey = `pr_authors_60d_${organizationAndTeamData.organizationId}`;
        const TTL = 10 * 60 * 1000; // 10 minutos

        try {
            const cachedAuthors =
                await this.cacheService.getFromCache<PullRequestAuthor[]>(
                    cacheKey,
                );

            if (cachedAuthors?.length > 0) {
                return cachedAuthors;
            }

            const authors =
                await this.codeManagementService.getPullRequestAuthors({
                    organizationAndTeamData,
                });

            await this.cacheService.addToCache(cacheKey, authors, TTL);

            return authors;
        } catch (error) {
            this.logger.error({
                message: 'Error fetching pull request authors',
                context: PullRequestHandlerService.name,
                error,
                metadata: { organizationAndTeamData },
            });
            throw error;
        }
    }

    async getNewCommitsSinceLastExecution(
        organizationAndTeamData: OrganizationAndTeamData,
        repository: { name: string; id: any },
        pullRequest: any,
        lastCommit?: any,
    ): Promise<Commit[]> {
        try {
            const commits =
                (await this.codeManagementService.getCommitsForPullRequestForCodeReview(
                    {
                        organizationAndTeamData,
                        repository,
                        prNumber: pullRequest?.number,
                    },
                )) as Commit[];

            if (!commits || commits.length === 0) {
                this.logger.warn({
                    message: `No commits found for PR#${pullRequest?.number}`,
                    context: PullRequestHandlerService.name,
                    metadata: {
                        organizationAndTeamData,
                        repository,
                        pullRequestNumber: pullRequest?.number,
                    },
                });
                return [];
            }

            if (lastCommit && lastCommit.sha) {
                const lastCommitIndex = commits.findIndex(
                    (commit) => commit.sha === lastCommit.sha,
                );

                if (lastCommitIndex !== -1) {
                    return commits.slice(lastCommitIndex + 1);
                }
            }

            return commits;
        } catch (error) {
            this.logger.error({
                message: 'Error fetching new commits since last execution',
                context: PullRequestHandlerService.name,
                error,
                metadata: {
                    organizationAndTeamData,
                    repository,
                    pullRequestNumber: pullRequest?.number,
                    lastCommit,
                },
            });

            throw error;
        }
    }
}
