import { IsOptional, IsString, IsEnum, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ActionType, ConfigLevel } from '@/config/types/general/codeReviewSettingsLog.type';
import { PaginationDto } from './pagination.dto';

export class CodeReviewSettingsLogFiltersDto extends PaginationDto {
    @IsOptional()
    @IsUUID()
    teamId?: string;

    @IsOptional()
    @IsEnum(ActionType)
    action?: ActionType;

    @IsOptional()
    @IsEnum(ConfigLevel)
    configLevel?: ConfigLevel;

    @IsOptional()
    @IsString()
    userId?: string;

    @IsOptional()
    @IsString()
    userEmail?: string;

    @IsOptional()
    @IsString()
    repositoryId?: string;

    @IsOptional()
    @Transform(({ value }) => new Date(value))
    startDate?: Date;

    @IsOptional()
    @Transform(({ value }) => new Date(value))
    endDate?: Date;
} 