import { IsObject, IsString } from 'class-validator';

export class UserStatusDto {
    @IsString()
    public gitId: string;

    @IsString()
    public gitTool: string;

    @IsString()
    public licenseStatus: "active" | "inactive";

    @IsString()
    public teamId: string;

    @IsString()
    public organizationId: string;

    @IsObject()
    public editedBy: {
        userId: string;
        email: string;
    };

    @IsString()
    public userName: string;
}
