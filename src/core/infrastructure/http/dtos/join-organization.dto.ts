import { IsUUID } from 'class-validator';

export class JoinOrganizationDto {
    @IsUUID()
    userId: string;

    @IsUUID()
    organizationId: string;
}
