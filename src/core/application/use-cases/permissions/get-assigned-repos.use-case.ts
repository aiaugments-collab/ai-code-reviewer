import {
    IPermissionsService,
    PERMISSIONS_SERVICE_TOKEN,
} from '@/core/domain/permissions/contracts/permissions.service.contract';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetAssignedReposUseCase implements IUseCase {
    constructor(
        @Inject(PERMISSIONS_SERVICE_TOKEN)
        private readonly permissionsService: IPermissionsService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(params: { userId: string }): Promise<string[]> {
        const { userId } = params;

        if (!userId) {
            this.logger.warn({
                message: 'User UUID is missing',
                metadata: { params },
                context: GetAssignedReposUseCase.name,
            });

            return [];
        }

        try {
            const permissions = await this.permissionsService.findOne({
                user: { uuid: userId },
            });

            if (!permissions) {
                this.logger.warn({
                    message: `No permissions found for user with UUID: ${userId}`,
                    context: GetAssignedReposUseCase.name,
                });
                return [];
            }

            return permissions.permissions?.assignedRepositoryIds || [];
        } catch (error) {
            this.logger.error({
                message: 'Error getting assigned repositories',
                error,
                context: GetAssignedReposUseCase.name,
                metadata: { params },
            });

            throw error;
        }
    }
}
