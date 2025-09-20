import {
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsPhoneNumber,
    IsString,
    IsStrongPassword,
    IsUUID,
} from 'class-validator';

export class SignUpDTO {
    @IsString()
    public name: string;

    @IsString()
    @IsEmail()
    public email: string;

    @IsString()
    @IsStrongPassword({
        minLength: 8,
        minLowercase: 1,
        minUppercase: 1,
        minNumbers: 1,
        minSymbols: 1,
    })
    public password: string;

    @IsString()
    @IsOptional()
    public organizationId?: string;
}
