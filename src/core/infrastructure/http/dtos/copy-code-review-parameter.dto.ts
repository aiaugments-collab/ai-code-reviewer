import { IsOptional, IsString } from 'class-validator';

export class CopyCodeReviewParameterDTO {
    @IsString()
    sourceRepositoryId: string;

    @IsString()
    targetRepositoryId: string;

    @IsString()
    @IsOptional()
    targetDirectoryPath: string;

    @IsString()
    teamId: string;
}
