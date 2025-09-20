import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationExecutionRepository } from '@/core/infrastructure/adapters/repositories/typeorm/automationExecution.repository';
import { AutomationExecutionModel } from '@/core/infrastructure/adapters/repositories/typeorm/schema/automationExecution.model';
import { TeamAutomationModel } from '@/core/infrastructure/adapters/repositories/typeorm/schema/teamAutomation.model';
import { TeamModel } from '@/core/infrastructure/adapters/repositories/typeorm/schema/team.model';
import { OrganizationModel } from '@/core/infrastructure/adapters/repositories/typeorm/schema/organization.model';
import { AutomationModel } from '@/core/infrastructure/adapters/repositories/typeorm/schema/automation.model';
import { AutomationStatus } from '@/core/domain/automation/enums/automation-status';
import { IAutomationExecution } from '@/core/domain/automation/interfaces/automation-execution.interface';

describe('AutomationExecutionRepository - Organization Filtering Integration', () => {
    let module: TestingModule;
    let automationExecutionRepository: AutomationExecutionRepository;
    let typeormAutomationExecutionRepo: Repository<AutomationExecutionModel>;
    let typeormTeamAutomationRepo: Repository<TeamAutomationModel>;
    let typeormTeamRepo: Repository<TeamModel>;
    let typeormOrganizationRepo: Repository<OrganizationModel>;
    let typeormAutomationRepo: Repository<AutomationModel>;

    // Test data
    let org1: OrganizationModel;
    let org2: OrganizationModel;
    let team1: TeamModel;
    let team2: TeamModel;
    let automation: AutomationModel;
    let teamAutomation1: TeamAutomationModel;
    let teamAutomation2: TeamAutomationModel;

    beforeAll(async () => {
        module = await Test.createTestingModule({
            imports: [
                TypeOrmModule.forRoot({
                    type: 'sqlite',
                    database: ':memory:',
                    entities: [
                        AutomationExecutionModel,
                        TeamAutomationModel,
                        TeamModel,
                        OrganizationModel,
                        AutomationModel,
                    ],
                    synchronize: true,
                    dropSchema: true,
                }),
                TypeOrmModule.forFeature([
                    AutomationExecutionModel,
                    TeamAutomationModel,
                    TeamModel,
                    OrganizationModel,
                    AutomationModel,
                ]),
            ],
            providers: [AutomationExecutionRepository],
        }).compile();

        automationExecutionRepository = module.get<AutomationExecutionRepository>(AutomationExecutionRepository);
        typeormAutomationExecutionRepo = module.get<Repository<AutomationExecutionModel>>('AutomationExecutionModelRepository');
        typeormTeamAutomationRepo = module.get<Repository<TeamAutomationModel>>('TeamAutomationModelRepository');
        typeormTeamRepo = module.get<Repository<TeamModel>>('TeamModelRepository');
        typeormOrganizationRepo = module.get<Repository<OrganizationModel>>('OrganizationModelRepository');
        typeormAutomationRepo = module.get<Repository<AutomationModel>>('AutomationModelRepository');

        await setupTestData();
    });

    afterAll(async () => {
        await module.close();
    });

    async function setupTestData() {
        // Create organizations
        org1 = await typeormOrganizationRepo.save({
            uuid: 'org-1-id',
            name: 'Organization 1',
            status: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        org2 = await typeormOrganizationRepo.save({
            uuid: 'org-2-id',
            name: 'Organization 2',
            status: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Create teams
        team1 = await typeormTeamRepo.save({
            uuid: 'team-1-id',
            name: 'Team 1',
            status: 'ACTIVE' as any,
            organization: org1,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        team2 = await typeormTeamRepo.save({
            uuid: 'team-2-id',
            name: 'Team 2',
            status: 'ACTIVE' as any,
            organization: org2,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Create automation
        automation = await typeormAutomationRepo.save({
            uuid: 'automation-id',
            name: 'Test Automation',
            type: 'CODE_REVIEW',
            status: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Create team automations
        teamAutomation1 = await typeormTeamAutomationRepo.save({
            uuid: 'team-automation-1-id',
            team: team1,
            automation: automation,
            status: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        teamAutomation2 = await typeormTeamAutomationRepo.save({
            uuid: 'team-automation-2-id',
            team: team2,
            automation: automation,
            status: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Create automation executions for both organizations
        await typeormAutomationExecutionRepo.save({
            uuid: 'execution-org1-1',
            status: AutomationStatus.SUCCESS,
            pullRequestNumber: 123,
            repositoryId: 'repo-org1',
            teamAutomation: teamAutomation1,
            origin: 'test',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await typeormAutomationExecutionRepo.save({
            uuid: 'execution-org1-2',
            status: AutomationStatus.SUCCESS,
            pullRequestNumber: 456,
            repositoryId: 'repo-org1',
            teamAutomation: teamAutomation1,
            origin: 'test',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await typeormAutomationExecutionRepo.save({
            uuid: 'execution-org2-1',
            status: AutomationStatus.SUCCESS,
            pullRequestNumber: 789,
            repositoryId: 'repo-org2',
            teamAutomation: teamAutomation2,
            origin: 'test',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    }

    describe('Organization Filtering', () => {
        it('should only return automation executions for specific organization', async () => {
            // Arrange
            const filter: Partial<IAutomationExecution> = {
                teamAutomation: {
                    team: {
                        organization: {
                            uuid: 'org-1-id',
                        },
                    },
                },
            };

            // Act
            const results = await automationExecutionRepository.find(filter);

            // Assert
            expect(results).toHaveLength(2);
            expect(results.every(r => r.uuid.startsWith('execution-org1'))).toBe(true);
            expect(results.map(r => r.uuid)).toContain('execution-org1-1');
            expect(results.map(r => r.uuid)).toContain('execution-org1-2');
            expect(results.map(r => r.uuid)).not.toContain('execution-org2-1');
        });

        it('should return automation executions for different organization', async () => {
            // Arrange
            const filter: Partial<IAutomationExecution> = {
                teamAutomation: {
                    team: {
                        organization: {
                            uuid: 'org-2-id',
                        },
                    },
                },
            };

            // Act
            const results = await automationExecutionRepository.find(filter);

            // Assert
            expect(results).toHaveLength(1);
            expect(results[0].uuid).toBe('execution-org2-1');
        });

        it('should return no results for non-existent organization', async () => {
            // Arrange
            const filter: Partial<IAutomationExecution> = {
                teamAutomation: {
                    team: {
                        organization: {
                            uuid: 'non-existent-org',
                        },
                    },
                },
            };

            // Act
            const results = await automationExecutionRepository.find(filter);

            // Assert
            expect(results).toHaveLength(0);
        });

        it('should combine organization filter with other filters', async () => {
            // Arrange
            const filter: Partial<IAutomationExecution> = {
                pullRequestNumber: 123,
                teamAutomation: {
                    team: {
                        organization: {
                            uuid: 'org-1-id',
                        },
                    },
                },
            };

            // Act
            const results = await automationExecutionRepository.find(filter);

            // Assert
            expect(results).toHaveLength(1);
            expect(results[0].uuid).toBe('execution-org1-1');
            expect(results[0].pullRequestNumber).toBe(123);
        });

        it('should include team and organization data in relations', async () => {
            // Arrange
            const filter: Partial<IAutomationExecution> = {
                teamAutomation: {
                    team: {
                        organization: {
                            uuid: 'org-1-id',
                        },
                    },
                },
            };

            // Act
            const results = await automationExecutionRepository.find(filter);

            // Assert
            expect(results).toHaveLength(2);
            
            const execution = results[0];
            expect(execution.teamAutomation).toBeDefined();
            expect(execution.teamAutomation.team).toBeDefined();
            expect(execution.teamAutomation.team.organization).toBeDefined();
            expect(execution.teamAutomation.team.organization.uuid).toBe('org-1-id');
            expect(execution.teamAutomation.team.organization.name).toBe('Organization 1');
        });

        it('should return all executions when no organization filter is provided', async () => {
            // Arrange
            const filter: Partial<IAutomationExecution> = {
                status: AutomationStatus.SUCCESS,
            };

            // Act
            const results = await automationExecutionRepository.find(filter);

            // Assert
            expect(results).toHaveLength(3); // All executions from both organizations
        });
    });
});
