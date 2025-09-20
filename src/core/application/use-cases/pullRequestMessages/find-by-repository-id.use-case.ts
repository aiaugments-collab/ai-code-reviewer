import { ConfigLevel } from '@/config/types/general/pullRequestMessages.type';
import {
    IPullRequestMessagesService,
    PULL_REQUEST_MESSAGES_SERVICE_TOKEN,
} from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class FindByRepositoryIdPullRequestMessagesUseCase implements IUseCase {
    constructor(
        @Inject(PULL_REQUEST_MESSAGES_SERVICE_TOKEN)
        private readonly pullRequestMessagesService: IPullRequestMessagesService,
    ) {}

    async execute(repositoryId: string, organizationId: string) {
        if (!repositoryId || !organizationId) {
            throw new Error('Repository ID and organization ID are required');
        }

        let result;
        if (repositoryId === 'global') {
            result = await this.pullRequestMessagesService.findOne({
                organizationId,
                configLevel: ConfigLevel.GLOBAL,
            });
        } else {
            result = await this.pullRequestMessagesService.findOne({
                repositoryId: repositoryId.toLowerCase(),
                organizationId,
                configLevel: ConfigLevel.REPOSITORY,
            });
        }

        if (!result) {
            return;
        }

        return result.toJson();
    }
}
