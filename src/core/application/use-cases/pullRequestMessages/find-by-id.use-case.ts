import {
    IPullRequestMessagesService,
    PULL_REQUEST_MESSAGES_SERVICE_TOKEN,
} from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { PullRequestMessagesEntity } from '@/core/domain/pullRequestMessages/entities/pullRequestMessages.entity';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class FindByIdPullRequestMessagesUseCase implements IUseCase {
    constructor(
        @Inject(PULL_REQUEST_MESSAGES_SERVICE_TOKEN)
        private readonly pullRequestMessagesService: IPullRequestMessagesService,
    ) {}

    async execute(uuid: string): Promise<PullRequestMessagesEntity> {
        if (!uuid) {
            throw new Error('UUID is required');
        }

        const pullRequestMessages = await this.pullRequestMessagesService.findById(uuid);

        if (!pullRequestMessages) {
            throw new NotFoundException(`Pull Request Messages with ID ${uuid} not found`);
        }

        return pullRequestMessages;
    }
}
