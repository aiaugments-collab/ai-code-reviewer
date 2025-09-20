import { CoreModel } from '@/shared/infrastructure/repositories/model/typeOrm';
import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    OneToOne,
} from 'typeorm';
import { OrganizationModel } from './organization.model';
import { ProfileModel } from './profile.model';
import { AuthModel } from './auth.model';
import { TeamMemberModel } from './teamMember.model';
import { STATUS } from '@/config/types/database/status.type';
import { Role } from '@/core/domain/permissions/enums/permissions.enum';
import { PermissionsModel } from './permissions.model';

@Entity('users')
export class UserModel extends CoreModel {
    @Column({ unique: true, nullable: false })
    email: string;

    @Column({ name: 'password', nullable: false })
    password: string;

    @Column({ type: 'enum', enum: Role, default: Role.OWNER })
    role: Role;

    @Column({ type: 'enum', enum: STATUS, default: STATUS.PENDING })
    status: STATUS;

    @OneToOne(() => ProfileModel, (profile) => profile.user)
    profile: ProfileModel[];

    @ManyToOne(() => OrganizationModel, (organization) => organization.users)
    @JoinColumn({ name: 'organization_id', referencedColumnName: 'uuid' })
    organization: OrganizationModel;

    @OneToMany(() => AuthModel, (auth) => auth.user)
    auth: AuthModel[];

    @OneToMany(() => TeamMemberModel, (teamMember) => teamMember.user)
    teamMember: TeamMemberModel[];

    @OneToOne(() => PermissionsModel, (permissions) => permissions.user)
    permissions: PermissionsModel;
}
