import {
    AUTOMATION_EXECUTION_SERVICE_TOKEN,
    IAutomationExecutionService,
} from '@/core/domain/automation/contracts/automation-execution.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { TeamQueryDto } from '@/core/infrastructure/http/dtos/teamId-query-dto';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';

@Injectable()
export class getAllAutomationExecutionsUseCase implements IUseCase {
    constructor(
        private readonly logger: PinoLoggerService,

        @Inject(AUTOMATION_EXECUTION_SERVICE_TOKEN)
        private readonly automationExecutionService: IAutomationExecutionService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string } };
        },
    ) {}

    async execute(data: TeamQueryDto) {
        if (!this.request.user?.organization?.uuid) {
            this.logger.warn({
                message: 'No organization found in request',
                context: getAllAutomationExecutionsUseCase.name,
            });
            throw new Error('No organization found in request');
        }

        const { teamId } = data;

        if (!teamId) {
            this.logger.warn({
                message: 'No teamId provided',
                context: getAllAutomationExecutionsUseCase.name,
            });
            throw new Error('No teamId provided');
        }

        try {
            const executions = await this.automationExecutionService.find({
                teamAutomation: {
                    team: {
                        uuid: teamId,
                        organization: {
                            uuid: this.request.user.organization.uuid,
                        },
                    },
                },
            });

            if (!executions || executions.length === 0) {
                this.logger.warn({
                    message: 'No automation executions found',
                    context: getAllAutomationExecutionsUseCase.name,
                    metadata: { teamId },
                });
                return [];
            }

            return executions.map((e) => e.toObject(e));
        } catch (error) {
            this.logger.error({
                message: 'Error getting all automation executions',
                context: getAllAutomationExecutionsUseCase.name,
                metadata: { teamId },
                error,
            });
            throw error;
        }
    }
}
