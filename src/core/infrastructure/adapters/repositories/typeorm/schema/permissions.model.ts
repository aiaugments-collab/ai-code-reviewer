import { CoreModel } from '@/shared/infrastructure/repositories/model/typeOrm';
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { UserModel } from './user.model';
import { IPermissions } from '@/core/domain/permissions/types/permissions.types';

@Entity('permissions')
export class PermissionsModel extends CoreModel {
    @OneToOne(() => UserModel, (user) => user.permissions)
    @JoinColumn({ name: 'user_id', referencedColumnName: 'uuid' })
    user: UserModel;

    @Column({ type: 'jsonb' })
    permissions: IPermissions['permissions'];
}
