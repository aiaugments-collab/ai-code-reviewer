import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '@/core/domain/permissions/enums/permissions.enum';
import { STATUS } from '@/config/types/database/status.type';

export class UpdateUserDto {
    @IsString()
    @IsOptional()
    @IsEmail()
    email?: string;

    @IsString()
    @IsOptional()
    password?: string;

    @IsOptional()
    @IsEnum(STATUS)
    status?: STATUS;

    @IsOptional()
    @IsEnum(Role)
    role?: Role;
}
