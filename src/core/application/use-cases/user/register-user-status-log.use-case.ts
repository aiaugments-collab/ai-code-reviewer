import { Inject, Injectable } from '@nestjs/common';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { UserStatusDto } from '@/core/infrastructure/http/dtos/user-status-change.dto';
import {
    CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN,
    ICodeReviewSettingsLogService,
} from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.service.contract';
import { ActionType } from '@/config/types/general/codeReviewSettingsLog.type';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';

@Injectable()
export class RegisterUserStatusLogUseCase implements IUseCase {
    constructor(
        @Inject(CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN)
        private readonly codeReviewSettingsLogService: ICodeReviewSettingsLogService,
        private readonly logger: PinoLoggerService,
    ) {}

    public async execute(userStatusDto: UserStatusDto): Promise<void> {
        try {
            const organizationId = userStatusDto.organizationId;

            await this.codeReviewSettingsLogService.registerUserStatusLog({
                organizationAndTeamData: {
                    organizationId,
                    teamId: userStatusDto.teamId || null,
                },
                userInfo: {
                    userId: userStatusDto.editedBy.userId || '',
                    userEmail: userStatusDto.editedBy.email || '',
                },
                userStatusChanges: [
                    {
                        gitId: userStatusDto.gitId,
                        gitTool: userStatusDto.gitTool,
                        userName: userStatusDto.userName,
                        licenseStatus: userStatusDto.licenseStatus === 'active',
                    },
                ],
                actionType: ActionType.EDIT,
            });
        } catch (error) {
            this.logger.error({
                message: 'Error registering user status log',
                context: RegisterUserStatusLogUseCase.name,
                error: error,
                metadata: {
                    ...userStatusDto,
                },
            });
        }
    }
}
