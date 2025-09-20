import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CodeReviewSettingsLogModel } from './schema/codeReviewSettingsLog.model';
import { ICodeReviewSettingsLogRepository } from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.repository.contract';
import { CodeReviewSettingsLogEntity } from '@/core/domain/codeReviewSettingsLog/entities/codeReviewSettingsLog.entity';
import {
    mapSimpleModelsToEntities,
    mapSimpleModelToEntity,
} from '@/shared/infrastructure/repositories/mappers';
import { ICodeReviewSettingsLog } from '@/core/domain/codeReviewSettingsLog/interfaces/codeReviewSettingsLog.interface';

@Injectable()
export class CodeReviewSettingsLogRepository
    implements ICodeReviewSettingsLogRepository
{
    constructor(
        @InjectModel(CodeReviewSettingsLogModel.name)
        private readonly codeReviewSettingsLogModel: Model<CodeReviewSettingsLogModel>,
    ) {}

    async create(
        codeReviewSettingsLog: Omit<ICodeReviewSettingsLog, 'uuid'>,
    ): Promise<CodeReviewSettingsLogEntity> {
        try {
            const saved = await this.codeReviewSettingsLogModel.create(
                codeReviewSettingsLog,
            );
            return mapSimpleModelToEntity(saved, CodeReviewSettingsLogEntity);
        } catch (error) {
            throw error;
        }
    }

    async find(
        filter?: Partial<ICodeReviewSettingsLog>,
    ): Promise<CodeReviewSettingsLogEntity[]> {
        try {
            const query = this.codeReviewSettingsLogModel.find(filter);
            
            // Ordenar por data de criação (mais recente primeiro)
            query.sort({ createdAt: -1 });

            const codeReviewSettingsLog = await query.exec();

            return mapSimpleModelsToEntities(
                codeReviewSettingsLog,
                CodeReviewSettingsLogEntity,
            );
        } catch (error) {
            throw error;
        }
    }
}
