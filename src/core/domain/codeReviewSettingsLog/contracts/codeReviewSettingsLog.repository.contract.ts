import { CodeReviewSettingsLogEntity } from '../entities/codeReviewSettingsLog.entity';
import { ICodeReviewSettingsLog } from '../interfaces/codeReviewSettingsLog.interface';

export const CODE_REVIEW_SETTINGS_LOG_REPOSITORY_TOKEN = Symbol(
    'CodeReviewSettingsLogRepository',
);

export interface ICodeReviewSettingsLogRepository {
    create(
        codeReviewSettingsLog: Omit<ICodeReviewSettingsLog, 'uuid'>,
    ): Promise<CodeReviewSettingsLogEntity>;

    find(
        filter?: Partial<ICodeReviewSettingsLog>,
    ): Promise<CodeReviewSettingsLogEntity[]>;
}
