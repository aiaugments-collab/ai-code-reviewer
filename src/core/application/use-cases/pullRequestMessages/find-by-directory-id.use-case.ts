import { ConfigLevel } from '@/config/types/general/pullRequestMessages.type';
import {
    IPullRequestMessagesService,
    PULL_REQUEST_MESSAGES_SERVICE_TOKEN,
} from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class FindByDirectoryIdPullRequestMessagesUseCase implements IUseCase {
    constructor(
        @Inject(PULL_REQUEST_MESSAGES_SERVICE_TOKEN)
        private readonly pullRequestMessagesService: IPullRequestMessagesService,
    ) {}

    async execute(directoryId: string, repositoryId: string, organizationId: string) {
        if (!directoryId || !repositoryId || !organizationId) {
            throw new Error('Directory ID and organization ID are required');
        }

        const result = await this.pullRequestMessagesService.findOne({
            organizationId,
            repositoryId,
            directoryId,
            configLevel: ConfigLevel.DIRECTORY,
        });

        if (!result) {
            return;
        }

        return result.toJson();
    }
}


