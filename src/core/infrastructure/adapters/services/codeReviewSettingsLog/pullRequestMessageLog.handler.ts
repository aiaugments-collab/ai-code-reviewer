import { Injectable } from '@nestjs/common';
import {
    UnifiedLogHandler,
    BaseLogParams,
    ChangedDataToExport,
} from './unifiedLog.handler';
import {
    ActionType,
    ConfigLevel,
} from '@/config/types/general/codeReviewSettingsLog.type';

// Default messages constants - to be filled with actual content
const DEFAULT_START_MESSAGE = '';
const DEFAULT_END_MESSAGE = '';

export interface PullRequestMessage {
    content: string;
    status: 'active' | 'inactive';
}

export interface PullRequestMessagesLogParams extends BaseLogParams {
    repositoryId?: string;
    directoryId?: string;
    startReviewMessage?: PullRequestMessage;
    endReviewMessage?: PullRequestMessage;
    existingStartMessage?: PullRequestMessage;
    existingEndMessage?: PullRequestMessage;
    directoryPath?: string;
    isUpdate: boolean; // true for update, false for create
}

@Injectable()
export class PullRequestMessagesLogHandler {
    constructor(private readonly unifiedLogHandler: UnifiedLogHandler) {}

    public async logPullRequestMessagesAction(
        params: PullRequestMessagesLogParams,
    ): Promise<void> {
        const changedData = this.generateChangedData(params);

        if (changedData.length === 0) {
            return;
        }

        await this.unifiedLogHandler.saveLogEntry({
            organizationAndTeamData: params.organizationAndTeamData,
            userInfo: params.userInfo,
            actionType: ActionType.EDIT,
            configLevel: params.configLevel,
            repository:
                params.repositoryId && params.repositoryId !== 'global'
                    ? { id: params.repositoryId }
                    : undefined,
            changedData,
            directory: {
                id: params.directoryId,
                path: params.directoryPath,
            },
        });
    }

    private generateChangedData(
        params: PullRequestMessagesLogParams,
    ): ChangedDataToExport[] {
        const changedData: ChangedDataToExport[] = [];

        // Check start message changes
        if (params.startReviewMessage) {
            const startChange = this.analyzeMessageChange(
                'Start',
                params.startReviewMessage,
                params.existingStartMessage,
                DEFAULT_START_MESSAGE,
                params.isUpdate,
                params.configLevel,
                params.repositoryId,
                params.directoryPath,
                params.userInfo.userEmail,
            );

            if (startChange) {
                changedData.push(startChange);
            }
        }

        // Check end message changes
        if (params.endReviewMessage) {
            const endChange = this.analyzeMessageChange(
                'End',
                params.endReviewMessage,
                params.existingEndMessage,
                DEFAULT_END_MESSAGE,
                params.isUpdate,
                params.configLevel,
                params.repositoryId,
                params.directoryPath,
                params.userInfo.userEmail,
            );

            if (endChange) {
                changedData.push(endChange);
            }
        }

        return changedData;
    }

    private analyzeMessageChange(
        messageType: 'Start' | 'End',
        newMessage: PullRequestMessage,
        existingMessage: PullRequestMessage | undefined,
        defaultMessage: string,
        isUpdate: boolean,
        configLevel: ConfigLevel,
        repositoryId?: string,
        directoryPath?: string,
        userEmail?: string,
    ): ChangedDataToExport | null {
        let previousValue: any;
        let currentValue: any;
        let description: string;

        if (!isUpdate) {
            // Create case - changing from default to custom
            previousValue = {
                content: defaultMessage,
                status: 'active',
                isDefault: true,
            };
            currentValue = {
                content: newMessage.content,
                status: newMessage.status,
                isDefault: false,
            };

            if (this.hasContentChanged(defaultMessage, newMessage.content)) {
                description = `User ${userEmail} changed default ${messageType.toLowerCase()} review message ${this.getConfigLevelDescription(configLevel, repositoryId, directoryPath)}`;
            } else if (newMessage.status === 'inactive') {
                description = `User ${userEmail} deactivated ${messageType.toLowerCase()} review message ${this.getConfigLevelDescription(configLevel, repositoryId, directoryPath)}`;
            } else {
                return null; // No significant change
            }
        } else {
            // Update case - changing from existing custom to new custom
            if (!existingMessage) {
                return null;
            }

            const contentChanged = this.hasContentChanged(
                existingMessage.content,
                newMessage.content,
            );
            const statusChanged = existingMessage.status !== newMessage.status;

            if (!contentChanged && !statusChanged) {
                return null;
            }

            previousValue = {
                content: existingMessage.content,
                status: existingMessage.status,
                isDefault: false,
            };
            currentValue = {
                content: newMessage.content,
                status: newMessage.status,
                isDefault: false,
            };

            if (contentChanged && statusChanged) {
                const statusAction =
                    newMessage.status === 'active'
                        ? 'activated'
                        : 'deactivated';
                description = `User ${userEmail} updated content and ${statusAction} ${messageType.toLowerCase()} review message ${this.getConfigLevelDescription(configLevel, repositoryId, directoryPath)}`;
            } else if (contentChanged) {
                description = `User ${userEmail} updated ${messageType.toLowerCase()} review message content ${this.getConfigLevelDescription(configLevel, repositoryId, directoryPath)}`;
            } else {
                const statusAction =
                    newMessage.status === 'active'
                        ? 'activated'
                        : 'deactivated';
                description = `User ${userEmail} ${statusAction} ${messageType.toLowerCase()} review message ${this.getConfigLevelDescription(configLevel, repositoryId, directoryPath)}`;
            }
        }

        return {
            actionDescription: `${messageType} Review Message Updated`,
            previousValue,
            currentValue,
            description,
        };
    }

    private hasContentChanged(oldContent: string, newContent: string): boolean {
        return oldContent.trim() !== newContent.trim();
    }

    private getConfigLevelDescription(
        configLevel: ConfigLevel,
        repositoryId?: string,
        directoryPath?: string,
    ): string {
        switch (configLevel) {
            case ConfigLevel.GLOBAL:
                return 'at global level';
            case ConfigLevel.REPOSITORY:
                return `for repository ${repositoryId}`;
            case ConfigLevel.DIRECTORY:
                return `for directory ${directoryPath}`;
            default:
                return '';
        }
    }
}
