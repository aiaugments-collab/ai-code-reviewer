import { IsEnum, IsOptional } from 'class-validator';
import { Role } from '@/core/domain/permissions/enums/permissions.enum';
import { STATUS } from '@/config/types/database/status.type';

export class UpdateAnotherUserDto {
    @IsOptional()
    @IsEnum(STATUS)
    status?: STATUS;

    @IsOptional()
    @IsEnum(Role)
    role?: Role;
}
