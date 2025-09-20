import { IOrganization } from '@/core/domain/organization/interfaces/organization.interface';
import { ITeam } from '@/core/domain/team/interfaces/team.interface';
import { IUser } from '@/core/domain/user/interfaces/user.interface';

jest.mock('posthog-node');

const getClient = async (key: string) => {
    process.env.API_POSTHOG_KEY = key;

    /*
     * We need to import the posthogClient here because it is a singleton and we need to reset the modules
     * to avoid the client being initialized with the wrong key
     */
    const { default: posthogClient } = await import('@/shared/utils/posthog');
    return posthogClient;
};

describe('PostHogClient', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize PostHog client when API key is present', async () => {
            const posthogClient = await getClient('test-key');
            expect(posthogClient['posthog']).toBeDefined();
        });

        it('should not initialize PostHog client when API key is missing', async () => {
            const posthogClient = await getClient('');
            expect(posthogClient['posthog']).toBeNull();
        });
    });

    describe('userIdentify', () => {
        it('should call identify when PostHog is initialized', async () => {
            const posthogClient = await getClient('test-key');
            posthogClient.userIdentify({
                uuid: '123',
                email: 'test@test.com',
                organization: { uuid: '123', name: 'test' },
            } as IUser);
            expect(posthogClient['posthog'].identify).toHaveBeenCalledWith({
                distinctId: '123',
                properties: {
                    email: 'test@test.com',
                    id: '123',
                    organizationId: '123',
                    organizationName: 'test',
                },
            });
        });

        it('should not call identify when PostHog is not initialized', async () => {
            const posthogClient = await getClient('');
            posthogClient.userIdentify({
                uuid: '123',
                email: 'test@test.com',
            } as IUser);
            expect(posthogClient['posthog']).toBeNull();
        });
    });

    describe('organizationIdentify', () => {
        it('should call identify when PostHog is initialized', async () => {
            const posthogClient = await getClient('test-key');
            posthogClient.organizationIdentify({
                uuid: '123',
                name: 'test',
                tenantName: 'test',
            } as IOrganization);
            expect(posthogClient['posthog'].groupIdentify).toHaveBeenCalledWith(
                {
                    groupType: 'organization',
                    groupKey: '123',
                    properties: {
                        name: 'test',
                        tenantName: 'test',
                        id: '123',
                    },
                },
            );
        });

        it('should not call identify when PostHog is not initialized', async () => {
            const posthogClient = await getClient('');
            posthogClient.organizationIdentify({
                uuid: '123',
                name: 'test',
                tenantName: 'test',
            } as IOrganization);
            expect(posthogClient['posthog']).toBeNull();
        });
    });

    describe('teamIdentify', () => {
        it('should call identify when PostHog is initialized', async () => {
            const posthogClient = await getClient('test-key');
            posthogClient.teamIdentify({
                uuid: '123',
                name: 'test',
                organization: { uuid: '123', name: 'test' },
            } as ITeam);
            expect(posthogClient['posthog'].groupIdentify).toHaveBeenCalledWith(
                {
                    groupType: 'team',
                    groupKey: '123',
                    properties: {
                        name: 'test',
                        id: '123',
                        organizationId: '123',
                        organizationName: 'test',
                    },
                },
            );
        });

        it('should not call identify when PostHog is not initialized', async () => {
            const posthogClient = await getClient('');
            posthogClient.teamIdentify({
                uuid: '123',
                name: 'test',
                organization: { uuid: '123', name: 'test' },
            } as ITeam);
            expect(posthogClient['posthog']).toBeNull();
        });
    });

    describe('isFeatureEnabled', () => {
        it('should call isFeatureEnabled when PostHog is initialized', async () => {
            const posthogClient = await getClient('test-key');
            posthogClient.isFeatureEnabled('test-feature', {
                uuid: '123',
                organization: { uuid: '456' },
            } as IUser);
            expect(
                posthogClient['posthog'].isFeatureEnabled,
            ).toHaveBeenCalledWith('test-feature', '123', {
                groups: { organization: '456' },
            });
        });

        it('should not call isFeatureEnabled when PostHog is not initialized', async () => {
            const posthogClient = await getClient('');
            const isFeatureEnabled = await posthogClient.isFeatureEnabled('test-feature', {
                uuid: '123',
                organization: { uuid: '456' },
            } as IUser);
            expect(posthogClient['posthog']).toBeNull();
            expect(isFeatureEnabled).toBe(true);
        });
    });
});
