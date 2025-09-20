import { IsOptional, IsString, IsNumberString, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class EnrichedPullRequestsQueryDto {
    @IsOptional()
    @IsString()
    repositoryId?: string;

    @IsOptional()
    @IsString()
    repositoryName?: string;

    @IsOptional()
    @Transform(({ value }) => parseInt(value))
    @Min(1)
    @Max(100)
    limit?: number = 30;

    @IsOptional()
    @Transform(({ value }) => parseInt(value))
    @Min(1)
    page?: number = 1;
}

