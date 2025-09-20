export enum PullRequestMessageType {
    START_REVIEW = 'start_review',
    END_REVIEW = 'end_review',
}

export enum PullRequestMessageStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
}

export enum ConfigLevel {
    GLOBAL = 'global',
    REPOSITORY = 'repository',
    DIRECTORY = 'directory',
}
