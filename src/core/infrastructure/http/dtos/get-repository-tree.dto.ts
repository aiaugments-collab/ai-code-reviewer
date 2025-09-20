import { RepositoryTreeType } from '@/shared/utils/enums/repositoryTree.enum';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class GetRepositoryTreeDto {
    @IsString()
    organizationId: string;

    @IsString()
    teamId: string;

    @IsString()
    repositoryId: string;

    @IsEnum(RepositoryTreeType)
    @IsOptional()
    treeType?: RepositoryTreeType;

    @IsBoolean()
    @IsOptional()
    useCache?: boolean;
}
