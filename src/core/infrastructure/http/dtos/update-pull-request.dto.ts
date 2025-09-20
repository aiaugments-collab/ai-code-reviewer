import { IsOptional, IsString } from 'class-validator';

export class updatePullRequestDto {
    @IsString()
    @IsOptional()
    public teamId?: string;

    @IsString()
    public organizationId: string;
}
