export enum ActionType {
    ADD = 'add',
    CREATE = 'create',
    EDIT = 'edit',
    DELETE = 'delete',
    CLONE = 'clone',
}

export enum ConfigLevel {
    MAIN = 'main',
    GLOBAL = 'global',
    REPOSITORY = 'repository',
    DIRECTORY = 'directory',
}

export type ChangedData = {
    actionDescription?: string;
    previousValue: any;
    currentValue: any;
    description: string;
};

export interface PropertyConfig {
    actionDescription: string;
    templateDescription: string;
    formatter?: (value: any) => string;
    isSpecialCase?: boolean;
}

export interface UserInfo {
    userId: string;
    userEmail: string;
}

// Tipos específicos para Kody Rules
export interface KodyRuleLogData {
    ruleId?: string;
    title: string;
    rule: string;
    scope?: string;
    path?: string;
    severity: string;
    repositoryId: string;
    origin: string;
    status: string;
    examples?: Array<{
        snippet: string;
        isCorrect: boolean;
    }>;
}

export interface KodyRuleChangeMetadata {
    configLevel: ConfigLevel;
    ruleMetadata: {
        ruleId: string;
        title: string;
        repositoryLevel: boolean; // true se repositoryId !== 'global'
    };
    repository?: {
        id: string;
        name: string;
    };
}

export enum KodyRuleActionType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    CLONE = 'clone',
}
