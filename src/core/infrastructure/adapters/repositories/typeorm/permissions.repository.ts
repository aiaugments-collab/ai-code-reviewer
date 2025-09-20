import { IPermissionsRepository } from '@/core/domain/permissions/contracts/permissions.repository.contract';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PermissionsModel } from './schema/permissions.model';
import { FindOptionsWhere, Repository } from 'typeorm';
import { IPermissions } from '@/core/domain/permissions/types/permissions.types';
import { createNestedConditions } from '@/shared/infrastructure/repositories/filters';
import { PinoLoggerService } from '../../services/logger/pino.service';

@Injectable()
export class PermissionsRepository implements IPermissionsRepository {
    constructor(
        @InjectRepository(PermissionsModel)
        private readonly permissionsRepository: Repository<PermissionsModel>,

        private readonly logger: PinoLoggerService,
    ) {}

    async create(
        permissions: Omit<IPermissions, 'uuid'>,
    ): Promise<IPermissions | null> {
        try {
            const newPermissions =
                this.permissionsRepository.create(permissions);

            const savedPermissions =
                await this.permissionsRepository.save(newPermissions);

            return savedPermissions;
        } catch (error) {
            this.logger.error({
                message: 'Error creating permissions',
                error,
                metadata: { permissions },
                context: PermissionsRepository.name,
            });

            return null;
        }
    }

    async delete(uuid: string): Promise<void> {
        try {
            await this.permissionsRepository.delete({ uuid });
        } catch (error) {
            this.logger.error({
                message: 'Error deleting permissions',
                error,
                metadata: { uuid },
                context: PermissionsRepository.name,
            });

            return;
        }
    }

    async find(filter: Partial<IPermissions>): Promise<IPermissions[]> {
        try {
            const permissions = await this.permissionsRepository.find({
                where: this.getFilterConditions(filter),
            });

            return permissions;
        } catch (error) {
            this.logger.error({
                message: 'Error finding permissions',
                error,
                metadata: { filter },
                context: PermissionsRepository.name,
            });

            return [];
        }
    }

    async findOne(filter: Partial<IPermissions>): Promise<IPermissions | null> {
        try {
            const permissions = await this.permissionsRepository.findOne({
                where: this.getFilterConditions(filter),
            });

            return permissions || null;
        } catch (error) {
            this.logger.error({
                message: 'Error finding one permissions',
                error,
                metadata: { filter },
                context: PermissionsRepository.name,
            });

            return null;
        }
    }

    async update(
        uuid: string,
        permissions: Omit<Partial<IPermissions>, 'uuid'>,
    ): Promise<IPermissions | null> {
        try {
            await this.permissionsRepository.update({ uuid }, permissions);

            const updatedPermissions = await this.permissionsRepository.findOne(
                {
                    where: { uuid },
                },
            );

            if (!updatedPermissions) {
                throw new Error('Permissions not found after update');
            }

            return updatedPermissions;
        } catch (error) {
            this.logger.error({
                message: 'Error updating permissions',
                error,
                metadata: { uuid, permissions },
                context: PermissionsRepository.name,
            });

            return null;
        }
    }

    private getFilterConditions(
        filter: Partial<IPermissions>,
    ): FindOptionsWhere<PermissionsModel> {
        const { user, permissions, ...restFilter } = filter || {};

        const userConditions = createNestedConditions('user', user);

        const assignedRepoConditions = createNestedConditions(
            'permissions',
            permissions,
        );

        return {
            ...restFilter,
            ...userConditions,
            ...assignedRepoConditions,
        };
    }
}
