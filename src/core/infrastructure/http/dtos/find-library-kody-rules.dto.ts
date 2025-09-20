import { IsString, IsOptional, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { KodyRuleFilters } from '@/config/types/kodyRules.type';
import { ProgrammingLanguage } from '@/shared/domain/enums/programming-language.enum';
import { PaginationDto } from './pagination.dto';

const transformToArray = ({ value }: { value: unknown }): string[] => {
    if (typeof value === 'string') {
        return value.split(',').map(item => item.trim()).filter(Boolean);
    }
    return Array.isArray(value) ? value : [];
};

export class FindLibraryKodyRulesDto extends PaginationDto implements KodyRuleFilters {
    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsString()
    severity?: string;

    @IsOptional()
    @Transform(transformToArray)
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @IsOptional()
    language?: ProgrammingLanguage;

    @IsOptional()
    @Transform(transformToArray)
    @IsArray()
    @IsString({ each: true })
    buckets?: string[];
}
