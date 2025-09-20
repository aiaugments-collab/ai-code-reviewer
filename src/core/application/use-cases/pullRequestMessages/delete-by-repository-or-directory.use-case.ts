import { Injectable, Inject } from '@nestjs/common';
import {
    IPullRequestMessagesService,
    PULL_REQUEST_MESSAGES_SERVICE_TOKEN,
} from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { ConfigLevel } from '@/config/types/general/pullRequestMessages.type';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';

export interface DeletePullRequestMessagesParams {
    organizationId: string;
    repositoryId?: string;
    directoryId?: string;
}

@Injectable()
export class DeleteByRepositoryOrDirectoryPullRequestMessagesUseCase implements IUseCase {
    constructor(
        @Inject(PULL_REQUEST_MESSAGES_SERVICE_TOKEN)
        private readonly pullRequestMessagesService: IPullRequestMessagesService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(params: DeletePullRequestMessagesParams): Promise<boolean> {
        const { organizationId, repositoryId, directoryId } = params;

        try {
            let wasDeleted = false;

            if (repositoryId && directoryId) {
                wasDeleted = await this.pullRequestMessagesService.deleteByFilter({
                    organizationId,
                    repositoryId,
                    directoryId,
                    configLevel: ConfigLevel.DIRECTORY,
                });

                this.logger.log({
                    message: 'Directory pull request messages deletion attempt completed',
                    context: DeleteByRepositoryOrDirectoryPullRequestMessagesUseCase.name,
                    metadata: {
                        organizationId,
                        repositoryId,
                        directoryId,
                        wasDeleted,
                    },
                });
            } else if (repositoryId && !directoryId) {
                wasDeleted = await this.pullRequestMessagesService.deleteByFilter({
                    organizationId,
                    repositoryId,
                    configLevel: ConfigLevel.REPOSITORY,
                });

                this.logger.log({
                    message: 'Repository pull request messages deletion attempt completed',
                    context: DeleteByRepositoryOrDirectoryPullRequestMessagesUseCase.name,
                    metadata: {
                        organizationId,
                        repositoryId,
                        wasDeleted,
                    },
                });
            } else {
                throw new Error('Either repositoryId or both repositoryId and directoryId must be provided');
            }

            return wasDeleted;
        } catch (error) {
            this.logger.error({
                message: 'Failed to delete pull request messages',
                context: DeleteByRepositoryOrDirectoryPullRequestMessagesUseCase.name,
                error,
                metadata: {
                    organizationId,
                    repositoryId,
                    directoryId,
                },
            });
            throw error;
        }
    }
}
