import { Inject, Injectable } from '@nestjs/common';
import { IPullRequestMessagesService } from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { IPullRequestMessagesRepository, PULL_REQUEST_MESSAGES_REPOSITORY_TOKEN } from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.repository.contract';
import { IPullRequestMessages } from '@/core/domain/pullRequestMessages/interfaces/pullRequestMessages.interface';
import { PullRequestMessagesEntity } from '@/core/domain/pullRequestMessages/entities/pullRequestMessages.entity';

@Injectable()
export class PullRequestMessagesService implements IPullRequestMessagesService {
    constructor(
        @Inject(PULL_REQUEST_MESSAGES_REPOSITORY_TOKEN)
        private readonly pullRequestMessagesRepository: IPullRequestMessagesRepository,
    ) {}

    async create(
        pullRequestMessages: IPullRequestMessages,
    ): Promise<PullRequestMessagesEntity> {
        return this.pullRequestMessagesRepository.create(pullRequestMessages);
    }

    async update(
        pullRequestMessages: IPullRequestMessages,
    ): Promise<PullRequestMessagesEntity> {
        return this.pullRequestMessagesRepository.update(pullRequestMessages);
    }

    async delete(uuid: string): Promise<void> {
        return this.pullRequestMessagesRepository.delete(uuid);
    }

    async find(
        filter?: Partial<IPullRequestMessages>,
    ): Promise<PullRequestMessagesEntity[]> {
        return this.pullRequestMessagesRepository.find(filter);
    }

    async findOne(
        filter?: Partial<IPullRequestMessages>,
    ): Promise<PullRequestMessagesEntity | null> {
        return this.pullRequestMessagesRepository.findOne(filter);
    }

    async findById(uuid: string): Promise<PullRequestMessagesEntity | null> {
        return this.pullRequestMessagesRepository.findById(uuid);
    }

    async deleteByFilter(filter: Partial<IPullRequestMessages>): Promise<boolean> {
        return this.pullRequestMessagesRepository.deleteByFilter(filter);
    }
}
