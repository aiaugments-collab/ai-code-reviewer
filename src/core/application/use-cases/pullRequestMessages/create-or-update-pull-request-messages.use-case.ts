import { Inject, Injectable } from '@nestjs/common';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import {
    IPullRequestMessagesService,
    PULL_REQUEST_MESSAGES_SERVICE_TOKEN,
} from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import { IPullRequestMessages } from '@/core/domain/pullRequestMessages/interfaces/pullRequestMessages.interface';
import { REQUEST } from '@nestjs/core';
import { ConfigLevel } from '@/config/types/general/pullRequestMessages.type';
import { ActionType } from '@/config/types/general/codeReviewSettingsLog.type';
import { PullRequestMessagesLogParams } from '@/core/infrastructure/adapters/services/codeReviewSettingsLog/pullRequestMessageLog.handler';
import {
    CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN,
    ICodeReviewSettingsLogService,
} from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.service.contract';

import { PinoLogger } from 'nestjs-pino';
import { GetAdditionalInfoHelper } from '@/shared/utils/helpers/getAdditionalInfo.helper';

@Injectable()
export class CreateOrUpdatePullRequestMessagesUseCase implements IUseCase {
    constructor(
        @Inject(PULL_REQUEST_MESSAGES_SERVICE_TOKEN)
        private readonly pullRequestMessagesService: IPullRequestMessagesService,

        @Inject(CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN)
        private readonly codeReviewSettingsLogService: ICodeReviewSettingsLogService,

        private readonly getAdditionalInfoHelper: GetAdditionalInfoHelper,

        private readonly logger: PinoLogger,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: {
                id: string;
                email: string;
                organization: { uuid: string };
            };
        },
    ) {}

    async execute(pullRequestMessages: IPullRequestMessages): Promise<void> {
        if (!this.request.user.organization.uuid) {
            throw new Error('Organization ID not found');
        }

        pullRequestMessages.organizationId =
            this.request.user.organization.uuid;

        if (pullRequestMessages?.configLevel === ConfigLevel.GLOBAL) {
            pullRequestMessages.repositoryId = 'global';
        }

        const existingPullRequestMessage = await this.findExistingConfiguration(
            pullRequestMessages.organizationId,
            pullRequestMessages.configLevel,
            pullRequestMessages.repositoryId,
            pullRequestMessages.directoryId,
        );

        const isUpdate = !!existingPullRequestMessage;

        if (isUpdate) {
            await this.pullRequestMessagesService.update(pullRequestMessages);
        } else {
            await this.pullRequestMessagesService.create(pullRequestMessages);
        }

        try {
            const logParams: PullRequestMessagesLogParams = {
                organizationAndTeamData: {
                    organizationId: pullRequestMessages.organizationId,
                },
                userInfo: {
                    userId: this.request.user.id,
                    userEmail: this.request.user.email,
                },
                actionType: ActionType.EDIT,
                configLevel: pullRequestMessages.configLevel,
                repositoryId: pullRequestMessages.repositoryId,
                directoryId: pullRequestMessages.directoryId,
                startReviewMessage: pullRequestMessages.startReviewMessage,
                endReviewMessage: pullRequestMessages.endReviewMessage,
                existingStartMessage:
                    existingPullRequestMessage?.startReviewMessage,
                existingEndMessage:
                    existingPullRequestMessage?.endReviewMessage,
                directoryPath:
                    await this.getAdditionalInfoHelper.getDirectoryPathByOrganizationAndRepository(
                        pullRequestMessages.organizationId,
                        pullRequestMessages.repositoryId,
                        pullRequestMessages.directoryId,
                    ) || '',
                isUpdate,
            };
            await this.codeReviewSettingsLogService.registerPullRequestMessagesLog(
                logParams,
            );

            return;
        } catch (error) {
            this.logger.error('Error registering pull request messages log', {
                error,
                metadata: {
                    organizationId: pullRequestMessages.organizationId,
                    configLevel: pullRequestMessages.configLevel,
                    repositoryId: pullRequestMessages.repositoryId,
                    directoryId: pullRequestMessages.directoryId,
                },
            });
            return;
        }
    }

    private async findExistingConfiguration(
        organizationId: string,
        configLevel: ConfigLevel,
        repositoryId?: string,
        directoryId?: string,
    ): Promise<IPullRequestMessages | null> {
        const searchCriteria: any = {
            organizationId,
            configLevel,
        };

        if (
            repositoryId &&
            (configLevel === ConfigLevel.REPOSITORY ||
                configLevel === ConfigLevel.DIRECTORY)
        ) {
            searchCriteria.repositoryId = repositoryId;
        }

        if (configLevel === ConfigLevel.DIRECTORY && directoryId) {
            searchCriteria.directoryId = directoryId;
        }

        return await this.pullRequestMessagesService.findOne(searchCriteria);
    }
}
