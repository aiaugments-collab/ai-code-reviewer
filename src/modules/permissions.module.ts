import { UseCases } from '@/core/application/use-cases/permissions';
import { PERMISSIONS_REPOSITORY_TOKEN } from '@/core/domain/permissions/contracts/permissions.repository.contract';
import { PERMISSIONS_SERVICE_TOKEN } from '@/core/domain/permissions/contracts/permissions.service.contract';
import { PermissionsRepository } from '@/core/infrastructure/adapters/repositories/typeorm/permissions.repository';
import { PermissionsModel } from '@/core/infrastructure/adapters/repositories/typeorm/schema/permissions.model';
import { PermissionsService } from '@/core/infrastructure/adapters/services/permissions/permissions.service';
import { PermissionsAbilityFactory } from '@/core/infrastructure/adapters/services/permissions/permissionsAbility.factory';
import { PermissionsController } from '@/core/infrastructure/http/controllers/permissions.controller';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './user.module';
import { IntegrationConfigModule } from './integrationConfig.module';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([PermissionsModel]),
        forwardRef(() => UsersModule),
        forwardRef(() => IntegrationConfigModule),
    ],
    providers: [
        ...UseCases,
        PermissionsAbilityFactory,
        {
            provide: PERMISSIONS_SERVICE_TOKEN,
            useClass: PermissionsService,
        },
        {
            provide: PERMISSIONS_REPOSITORY_TOKEN,
            useClass: PermissionsRepository,
        },
        AuthorizationService,
    ],
    controllers: [PermissionsController],
    exports: [
        PermissionsAbilityFactory,
        AuthorizationService,
        PERMISSIONS_SERVICE_TOKEN,
        ...UseCases,
    ],
})
export class PermissionsModule {}
