import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    CODE_REVIEW_EXECUTION_REPOSITORY,
    ICodeReviewExecutionRepository,
} from '@/core/domain/codeReviewExecutions/contracts/codeReviewExecution.repository.contract';
import { ICodeReviewExecutionService } from '@/core/domain/codeReviewExecutions/contracts/codeReviewExecution.service.contract';
import { CodeReviewExecutionEntity } from '@/core/domain/codeReviewExecutions/entities/codeReviewExecution.entity';
import { CodeReviewExecution } from '@/core/domain/codeReviewExecutions/interfaces/codeReviewExecution.interface';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLoggerService } from '../logger/pino.service';

@Injectable()
export class CodeReviewExecutionService implements ICodeReviewExecutionService {
    constructor(
        @Inject(CODE_REVIEW_EXECUTION_REPOSITORY)
        private readonly codeReviewExecutionRepository: ICodeReviewExecutionRepository,

        private readonly logger: PinoLoggerService,
    ) {}

    create(
        codeReviewExecution: Omit<
            CodeReviewExecution,
            'uuid' | 'createdAt' | 'updatedAt'
        >,
    ): Promise<CodeReviewExecutionEntity | null> {
        return this.codeReviewExecutionRepository.create(codeReviewExecution);
    }

    update(
        filter: Partial<CodeReviewExecution>,
        codeReviewExecution: Partial<
            Omit<CodeReviewExecution, 'uuid' | 'createdAt' | 'updatedAt'>
        >,
    ): Promise<CodeReviewExecutionEntity | null> {
        return this.codeReviewExecutionRepository.update(
            filter,
            codeReviewExecution,
        );
    }

    find(
        filter?: Partial<CodeReviewExecution>,
    ): Promise<CodeReviewExecutionEntity[]> {
        return this.codeReviewExecutionRepository.find(filter);
    }

    findOne(
        filter?: Partial<CodeReviewExecution>,
    ): Promise<CodeReviewExecutionEntity | null> {
        return this.codeReviewExecutionRepository.findOne(filter);
    }

    delete(uuid: string): Promise<boolean> {
        return this.codeReviewExecutionRepository.delete(uuid);
    }
}
