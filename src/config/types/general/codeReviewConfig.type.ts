import { CodeReviewConfigWithoutLLMProvider } from './codeReview.type';
import { OrganizationAndTeamData } from './organizationAndTeamData';

export interface ICodeRepository {
    avatar_url?: string;
    default_branch: string;
    http_url: string;
    id: string;
    language: string;
    name: string;
    organizationName: string;
    selected: string;
    visibility: 'private' | 'public';
    directories: Array<any>;
}

export interface IFilteredCodeRepository {
    id: string;
    name: string;
    isSelected: boolean;
    directories: Array<any>;
    directoryId?: string;
}

export interface IRepositoryCodeReviewConfig
    extends CodeReviewConfigWithoutLLMProvider {
    id: string;
    name: string;
    directories: Array<any>;
}

export interface ICodeReviewParameter {
    global: CodeReviewConfigWithoutLLMProvider;
    repositories: Array<IRepositoryCodeReviewConfig | IFilteredCodeRepository>;
}