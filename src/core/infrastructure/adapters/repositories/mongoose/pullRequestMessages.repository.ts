import { Injectable } from '@nestjs/common';
import { IPullRequestMessagesRepository } from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.repository.contract';
import { IPullRequestMessages } from '@/core/domain/pullRequestMessages/interfaces/pullRequestMessages.interface';
import { PullRequestMessagesEntity } from '@/core/domain/pullRequestMessages/entities/pullRequestMessages.entity';
import { PullRequestMessagesModel } from './schema/pullRequestMessages.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    mapSimpleModelsToEntities,
    mapSimpleModelToEntity,
} from '@/shared/infrastructure/repositories/mappers';

@Injectable()
export class PullRequestMessagesRepository
    implements IPullRequestMessagesRepository
{
    constructor(
        @InjectModel(PullRequestMessagesModel.name)
        private readonly pullRequestMessagesModel: Model<PullRequestMessagesModel>,
    ) {}

    async create(
        pullRequestMessages: Omit<IPullRequestMessages, 'uuid'>,
    ): Promise<PullRequestMessagesEntity> {
        const saved =
            await this.pullRequestMessagesModel.create(pullRequestMessages);
        return mapSimpleModelToEntity(saved, PullRequestMessagesEntity);
    }

    async update(
        pullRequestMessages: IPullRequestMessages,
    ): Promise<PullRequestMessagesEntity> {
        const updated = await this.pullRequestMessagesModel.findByIdAndUpdate(
            pullRequestMessages.uuid,
            pullRequestMessages,
            { new: true },
        );
        return mapSimpleModelToEntity(updated, PullRequestMessagesEntity);
    }

    async delete(uuid: string): Promise<void> {
        await this.pullRequestMessagesModel.findByIdAndDelete(uuid);
    }

    async deleteByFilter(filter: Partial<IPullRequestMessages>): Promise<boolean> {
        if (!filter || Object.keys(filter).length === 0) {
            return false;
        }

        if (!filter.organizationId && !filter.repositoryId && !filter.configLevel) {
            throw new Error('OrganizationId, repositoryId and configLevel are required');
        }

        const result = await this.pullRequestMessagesModel.findOneAndDelete(filter).select({ _id: 1 });
        return result !== null;
    }

    async find(
        filter?: Partial<IPullRequestMessages>,
    ): Promise<PullRequestMessagesEntity[]> {
        try {
            const docs = await this.pullRequestMessagesModel
                .find(filter)
                .exec();
            return mapSimpleModelsToEntities(docs, PullRequestMessagesEntity);
        } catch (error) {
            throw error;
        }
    }

    async findOne(
        filter?: Partial<IPullRequestMessages>,
    ): Promise<PullRequestMessagesEntity | null> {
        try {
            const doc = await this.pullRequestMessagesModel
                .findOne(filter)
                .exec();
            return doc
                ? mapSimpleModelToEntity(doc, PullRequestMessagesEntity)
                : null;
        } catch (error) {
            throw error;
        }
    }

    async findById(uuid: string): Promise<PullRequestMessagesEntity | null> {
        try {
            const doc = await this.pullRequestMessagesModel
                .findById(uuid)
                .exec();
            return doc
                ? mapSimpleModelToEntity(doc, PullRequestMessagesEntity)
                : null;
        } catch (error) {
            throw error;
        }
    }
}
