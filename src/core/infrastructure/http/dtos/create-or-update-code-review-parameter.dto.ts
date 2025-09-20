import {
    IsObject,
    IsString,
    IsOptional,
    IsArray,
    IsBoolean,
    ValidateNested,
    IsNumber,
    IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrganizationAndTeamDataDto } from './organizationAndTeamData.dto';
import {
    BehaviourForExistingDescription,
    BehaviourForNewCommits,
    CodeReviewVersion,
    GroupingModeSuggestions,
    LimitationType,
    ReviewCadenceType,
} from '@/config/types/general/codeReview.type';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';

class ReviewOptionsDto {
    @IsBoolean()
    security: boolean;

    @IsBoolean()
    code_style: boolean;

    @IsBoolean()
    refactoring: boolean;

    @IsBoolean()
    error_handling: boolean;

    @IsBoolean()
    maintainability: boolean;

    @IsBoolean()
    potential_issues: boolean;

    @IsBoolean()
    documentation_and_comments: boolean;

    @IsBoolean()
    performance_and_optimization: boolean;

    @IsBoolean()
    kody_rules: boolean;

    @IsBoolean()
    breaking_changes: boolean;

    @IsOptional()
    @IsBoolean()
    bug: boolean;

    @IsOptional()
    @IsBoolean()
    performance: boolean;

    @IsOptional()
    @IsBoolean()
    cross_file: boolean;
}

class SummaryConfigDto {
    @IsOptional()
    @IsBoolean()
    generatePRSummary?: boolean;

    @IsOptional()
    @IsString()
    customInstructions?: string;

    @IsOptional()
    behaviourForExistingDescription?: BehaviourForExistingDescription;

    @IsOptional()
    @IsEnum(BehaviourForNewCommits)
    behaviourForNewCommits?: BehaviourForNewCommits;
}

class SeverityLimitsDto {
    @IsNumber()
    @IsOptional()
    low?: number;

    @IsNumber()
    @IsOptional()
    medium?: number;

    @IsNumber()
    @IsOptional()
    high?: number;

    @IsNumber()
    @IsOptional()
    critical?: number;
}

class SuggestionControlConfigDto {
    @IsOptional()
    @IsEnum(GroupingModeSuggestions)
    groupingMode?: GroupingModeSuggestions;

    @IsOptional()
    @IsEnum(LimitationType)
    limitationType?: LimitationType;

    @IsOptional()
    @IsNumber()
    maxSuggestions?: number;

    @IsOptional()
    @IsEnum(SeverityLevel)
    severityLevelFilter?: SeverityLevel;

    // ✨ NOVA CONFIGURAÇÃO SIMPLIFICADA para controle de filtros nas Kody Rules
    @IsOptional()
    @IsBoolean()
    applyFiltersToKodyRules?: boolean;

    @IsOptional()
    @ValidateNested()
    @Type(() => SeverityLimitsDto)
    severityLimits?: SeverityLimitsDto;
}

class ReviewCadenceDto {
    @IsEnum(ReviewCadenceType)
    type: ReviewCadenceType;

    @IsOptional()
    @IsNumber()
    timeWindow?: number;

    @IsOptional()
    @IsNumber()
    pushesToTrigger?: number;
}

class PathInstructionDto {
    @IsOptional()
    @IsString()
    path?: string;

    @IsOptional()
    @IsString()
    instructions?: string;
}

class CodeReviewConfigWithoutLLMProviderDto {
    @IsOptional()
    @IsString()
    id?: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    path?: string;

    @IsOptional()
    @IsBoolean()
    isSelected?: boolean;

    @IsOptional()
    @IsArray()
    ignorePaths?: string[] = [];

    @IsOptional()
    @ValidateNested()
    @Type(() => ReviewOptionsDto)
    reviewOptions?: ReviewOptionsDto;

    @IsOptional()
    @IsArray()
    ignoredTitleKeywords?: string[] = [];

    @IsOptional()
    @IsArray()
    baseBranches?: string[] = [];

    @IsOptional()
    @IsBoolean()
    automatedReviewActive?: boolean;

    @IsOptional()
    @ValidateNested()
    @Type(() => SummaryConfigDto)
    summary?: SummaryConfigDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => SuggestionControlConfigDto)
    suggestionControl?: SuggestionControlConfigDto;

    @IsOptional()
    @IsBoolean()
    pullRequestApprovalActive?: boolean;

    @IsOptional()
    @IsBoolean()
    kodusConfigFileOverridesWebPreferences?: boolean;

    @IsOptional()
    @IsBoolean()
    isRequestChangesActive?: boolean;

    @IsOptional()
    @IsBoolean()
    ideRulesSyncEnabled?: boolean;

    @IsOptional()
    @IsBoolean()
    kodyRulesGeneratorEnabled?: boolean;

    @IsOptional()
    @ValidateNested()
    @Type(() => ReviewCadenceDto)
    reviewCadence?: ReviewCadenceDto;

    @IsOptional()
    @IsBoolean()
    runOnDraft?: boolean;

    @IsOptional()
    @IsEnum(CodeReviewVersion)
    codeReviewVersion?: CodeReviewVersion = CodeReviewVersion.v2;
}

export class CreateOrUpdateCodeReviewParameterDto {
    @IsObject()
    organizationAndTeamData: OrganizationAndTeamDataDto;

    @ValidateNested()
    @Type(() => CodeReviewConfigWithoutLLMProviderDto)
    configValue: CodeReviewConfigWithoutLLMProviderDto;

    @IsString()
    @IsOptional()
    repositoryId?: string;

    @IsString()
    @IsOptional()
    directoryId?: string;
}
