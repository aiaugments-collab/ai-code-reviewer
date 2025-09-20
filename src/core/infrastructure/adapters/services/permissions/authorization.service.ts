import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PermissionsAbilityFactory } from './permissionsAbility.factory';
import { subject as caslSubject } from '@casl/ability';
import { GetAssignedReposUseCase } from '@/core/application/use-cases/permissions/get-assigned-repos.use-case';
import { extractReposFromAbility } from './policy.handlers';

@Injectable()
export class AuthorizationService {
    constructor(
        private readonly permissionsAbilityFactory: PermissionsAbilityFactory,
        private readonly getAssignedReposUseCase: GetAssignedReposUseCase,
    ) {}

    async check(params: {
        user: Partial<IUser>;
        action: Action;
        resource: ResourceType;
        repoIds?: string[];
    }): Promise<boolean> {
        const { user, action, resource, repoIds = [undefined] } = params;

        if (!user || !user.uuid || !user.organization?.uuid) {
            return false;
        }

        const ability = await this.permissionsAbilityFactory.createForUser(
            user as IUser,
        );

        for (const repoId of repoIds) {
            const subject = caslSubject(resource, {
                organizationId: user.organization.uuid,
                ...(repoId ? { repoId } : {}),
            });

            if (!ability.can(action, subject as any)) {
                return false;
            }
        }

        return true;
    }

    async ensure(params: {
        user: Partial<IUser>;
        action: Action;
        resource: ResourceType;
        repoIds?: string[];
    }): Promise<void> {
        const { user, action, resource, repoIds } = params;

        const isAllowed = await this.check({
            user,
            action,
            resource,
            repoIds,
        });

        if (!isAllowed) {
            throw new ForbiddenException(
                `User does not have permission to ${action} on ${resource}${repoIds ? ` for repos: ${repoIds.join(', ')}` : ''}`,
            );
        }
    }

    async getRepositoryScope(
        user: Partial<IUser>,
        action: Action,
        resource: ResourceType,
    ): Promise<string[] | null> {
        if (!user || !user.organization?.uuid) {
            return [];
        }

        const ability = await this.permissionsAbilityFactory.createForUser(
            user as IUser,
        );

        const orgLevelSubject = caslSubject(resource, {
            organizationId: user.organization.uuid,
        });

        if (ability.can(action, orgLevelSubject as any)) {
            // User has org-wide access.
            return null;
        }

        // If the org-level check fails, the permission MUST be repo-scoped.
        return extractReposFromAbility(ability, action, resource);
    }
}
