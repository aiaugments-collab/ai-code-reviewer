import { Injectable } from '@nestjs/common';
import {
    UnifiedLogHandler,
    BaseLogParams
} from './unifiedLog.handler';
import {
    ActionType,
    ConfigLevel,
} from '@/config/types/general/codeReviewSettingsLog.type';
import { IKodyRule } from '@/core/domain/kodyRules/interfaces/kodyRules.interface';

export interface KodyRuleLogParams extends BaseLogParams {
    oldRule?: Partial<IKodyRule>;
    newRule?: Partial<IKodyRule>;
    ruleTitle?: string;
}

@Injectable()
export class KodyRulesLogHandler {
    constructor(
        private readonly unifiedLogHandler: UnifiedLogHandler,
    ) {}

    public async logKodyRuleAction(params: KodyRuleLogParams): Promise<void> {
        const {
            organizationAndTeamData,
            userInfo,
            actionType,
            repository,
            directory,
            oldRule,
            newRule,
            ruleTitle,
        } = params;

        const entityName = this.getRuleName(newRule, oldRule, ruleTitle);
        const { oldData, newData } = this.prepareRuleData(oldRule, newRule, actionType);

        const configLevel = this.determineConfigLevel(repository?.id, directory?.id);

        await this.unifiedLogHandler.logAction({
            organizationAndTeamData,
            userInfo,
            actionType,
            configLevel,
            repository,
            directory,
            entityType: 'kodyRule',
            entityName,
            oldData,
            newData,
        });
    }

    private getRuleName(
        newRule?: Partial<IKodyRule>,
        oldRule?: Partial<IKodyRule>,
        ruleTitle?: string
    ): string {
        return newRule?.title || oldRule?.title || ruleTitle || 'Unnamed Rule';
    }

    private prepareRuleData(
        oldRule?: Partial<IKodyRule>,
        newRule?: Partial<IKodyRule>,
        actionType?: ActionType
    ): { oldData: any; newData: any } {
        switch (actionType) {
            case ActionType.CREATE:
                return {
                    oldData: null,
                    newData: newRule,
                };

            case ActionType.DELETE:
                return {
                    oldData: oldRule,
                    newData: null,
                };

            case ActionType.EDIT:
                return {
                    oldData: oldRule,
                    newData: newRule,
                };

            case ActionType.ADD:
                return {
                    oldData: null,
                    newData: newRule,
                };

            default:
                return {
                    oldData: oldRule,
                    newData: newRule,
                };
        }
    }

    private determineConfigLevel(
        repositoryId?: string,
        directoryId?: string,
    ): ConfigLevel {
        if (directoryId) {
            return ConfigLevel.DIRECTORY;
        }

        if (!repositoryId || repositoryId === 'global') {
            return ConfigLevel.GLOBAL;
        }

        return ConfigLevel.REPOSITORY;
    }
}
