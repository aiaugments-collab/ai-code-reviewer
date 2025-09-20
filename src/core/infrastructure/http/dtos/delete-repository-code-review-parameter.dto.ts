import { IsOptional, IsString } from 'class-validator';

export class DeleteRepositoryCodeReviewParameterDto {
    @IsString()
    teamId: string;

    @IsString()
    repositoryId: string;

    @IsOptional()
    @IsString()
    directoryId: string;
}
