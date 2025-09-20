import { AutomationExecutionEntity } from '@/core/domain/automation/entities/automation-execution.entity';
import { AutomationStatus } from '@/core/domain/automation/enums/automation-status';
import { IAutomationExecution } from '@/core/domain/automation/interfaces/automation-execution.interface';
import { AutomationExecutionRepository } from '@/core/infrastructure/adapters/repositories/typeorm/automationExecution.repository';
import { AutomationExecutionModel } from '@/core/infrastructure/adapters/repositories/typeorm/schema/automationExecution.model';
import { AutomationExecutionService } from '@/core/infrastructure/adapters/services/automation/automation-execution.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, QueryBuilder, InsertResult } from 'typeorm';
import { AUTOMATION_EXECUTION_REPOSITORY_TOKEN } from '@/core/domain/automation/contracts/automation-execution.repository';

describe('AutomationExecutionService - Data Persistence', () => {
    let service: AutomationExecutionService;
    let repository: AutomationExecutionRepository;
    let mockTypeOrmRepository: jest.Mocked<Repository<AutomationExecutionModel>>;
    let queryBuilder: any;

    const mockTeamAutomationId = 'team-persistence-uuid';
    const pullRequestNumber = 45;
    const repositoryId = 'repo-persistence-uuid';

    beforeEach(async () => {
        const mockInsertResult: InsertResult = {
            identifiers: [{ uuid: 'new-execution-uuid' }],
            generatedMaps: [],
            raw: {},
        };

        queryBuilder = {
            insert: jest.fn().mockReturnThis(),
            values: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue(mockInsertResult),
        };

        mockTypeOrmRepository = {
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
            create: jest.fn(),
            findOne: jest.fn(),
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AutomationExecutionService,
                {
                    provide: AUTOMATION_EXECUTION_REPOSITORY_TOKEN,
                    useClass: AutomationExecutionRepository,
                },
                {
                    provide: getRepositoryToken(AutomationExecutionModel),
                    useValue: mockTypeOrmRepository,
                },
            ],
        }).compile();

        service = module.get<AutomationExecutionService>(AutomationExecutionService);
        repository = module.get<AutomationExecutionRepository>(AUTOMATION_EXECUTION_REPOSITORY_TOKEN);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Cenário 3 - Salvamento correto dos dados novos', () => {
        it('deve salvar execution com dados nas colunas separadas (formato novo)', async () => {
            // Arrange
            const automationExecutionData: Omit<IAutomationExecution, 'uuid'> = {
                status: AutomationStatus.SUCCESS,
                dataExecution: {
                    codeManagementEvent: 'issue_comment',
                    platformType: 'GITHUB',
                    organizationAndTeamData: {
                        teamId: mockTeamAutomationId,
                        organizationId: 'org-uuid'
                    },
                    pullRequestNumber: pullRequestNumber,
                    overallComments: [],
                    lastAnalyzedCommit: {
                        sha: 'f8110470424f7daa2a1e3c3b54528e31bb9704de',
                        author: {
                            id: 17408306,
                            name: 'Junior Sartori',
                            email: 'sartorijr92@gmail.com'
                        }
                    },
                    commentId: 2960318631,
                    repositoryId: repositoryId
                },
                teamAutomation: { uuid: mockTeamAutomationId },
                origin: 'automation',
                // Novos campos nas colunas separadas
                pullRequestNumber: pullRequestNumber,
                repositoryId: repositoryId
            };

            const createdModel: AutomationExecutionModel = {
                uuid: 'new-execution-uuid',
                createdAt: new Date('2025-06-11T10:00:00Z'),
                updatedAt: new Date('2025-06-11T10:00:00Z'),
                status: AutomationStatus.SUCCESS,
                dataExecution: automationExecutionData.dataExecution,
                pullRequestNumber: pullRequestNumber,
                repositoryId: repositoryId,
                teamAutomation: { uuid: mockTeamAutomationId } as any,
                origin: 'automation',
                errorMessage: null,
            };

            mockTypeOrmRepository.create.mockReturnValue(createdModel);
            mockTypeOrmRepository.findOne.mockResolvedValue(createdModel);

            // Act
            const result = await service.register(automationExecutionData);

            // Assert
            expect(result).toBeInstanceOf(AutomationExecutionEntity);
            expect(result.uuid).toBe('new-execution-uuid');
            expect(result.pullRequestNumber).toBe(pullRequestNumber);
            expect(result.repositoryId).toBe(repositoryId);
            expect(result.status).toBe(AutomationStatus.SUCCESS);

            // Verifica que create foi chamado com os dados corretos
            expect(mockTypeOrmRepository.create).toHaveBeenCalledWith({
                ...automationExecutionData,
                uuid: expect.any(String),
            });

            // Verifica que insert foi executado
            expect(queryBuilder.insert).toHaveBeenCalled();
            expect(queryBuilder.values).toHaveBeenCalledWith(createdModel);
            expect(queryBuilder.execute).toHaveBeenCalled();

            // Verifica que buscou o registro criado
            expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
                where: { uuid: 'new-execution-uuid' }
            });
        });

        it('deve manter compatibilidade salvando dados também no jsonB', async () => {
            // Arrange
            const automationExecutionData: Omit<IAutomationExecution, 'uuid'> = {
                status: AutomationStatus.SUCCESS,
                dataExecution: {
                    codeManagementEvent: 'pullrequest:comment_created',
                    platformType: 'BITBUCKET',
                    organizationAndTeamData: {
                        teamId: mockTeamAutomationId,
                        organizationId: 'org-bitbucket-uuid'
                    },
                    pullRequestNumber: 34, // Também no jsonB para compatibilidade
                    overallComments: [],
                    lastAnalyzedCommit: {
                        sha: 'ac475d506ffb8f25ec0bbee32ccd96bf14c7929f',
                        author: {
                            id: '3ea4cafe-5ea0-42ba-ab6c-153f2c1f46ea',
                            name: 'Junior Sartori'
                        }
                    },
                    noteId: null,
                    threadId: null,
                    commentId: 643333331,
                    repositoryId: 'repo-bitbucket-uuid'
                },
                teamAutomation: { uuid: mockTeamAutomationId },
                origin: 'automation',
                pullRequestNumber: 34,
                repositoryId: 'repo-bitbucket-uuid'
            };

            const createdModel: AutomationExecutionModel = {
                uuid: 'bitbucket-execution-uuid',
                createdAt: new Date('2025-06-11T12:00:00Z'),
                updatedAt: new Date('2025-06-11T12:00:00Z'),
                status: AutomationStatus.SUCCESS,
                dataExecution: automationExecutionData.dataExecution,
                pullRequestNumber: 34,
                repositoryId: 'repo-bitbucket-uuid',
                teamAutomation: { uuid: mockTeamAutomationId } as any,
                origin: 'automation',
                errorMessage: null,
            };

            mockTypeOrmRepository.create.mockReturnValue(createdModel);
            mockTypeOrmRepository.findOne.mockResolvedValue(createdModel);

            // Act
            const result = await service.register(automationExecutionData);

            // Assert
            expect(result).toBeInstanceOf(AutomationExecutionEntity);

            // Verifica que os dados estão tanto nas colunas quanto no jsonB
            expect(result.pullRequestNumber).toBe(34);
            expect(result.repositoryId).toBe('repo-bitbucket-uuid');
            expect(result.dataExecution.pullRequestNumber).toBe(34);
            expect(result.dataExecution.repositoryId).toBe('repo-bitbucket-uuid');
            expect(result.dataExecution.platformType).toBe('BITBUCKET');
        });

        it('deve salvar corretamente dados de diferentes plataformas', async () => {
            // Arrange - Azure Repos
            const azureExecutionData: Omit<IAutomationExecution, 'uuid'> = {
                status: AutomationStatus.SUCCESS,
                dataExecution: {
                    codeManagementEvent: 'ms.vss-code.git-pullrequest-comment-event',
                    platformType: 'AZURE_REPOS',
                    organizationAndTeamData: {
                        teamId: mockTeamAutomationId,
                        organizationId: 'org-azure-uuid'
                    },
                    pullRequestNumber: 45,
                    overallComments: [],
                    lastAnalyzedCommit: {
                        sha: 'e81cdabc88f3164c46d580af8554926d0625e742',
                        author: {
                            id: '0e41dfd8-ee65-4e5b-9fa4-dd619a662204',
                            name: 'Junior Sartori'
                        }
                    },
                    threadId: 355,
                    repositoryId: 'repo-azure-uuid'
                },
                teamAutomation: { uuid: mockTeamAutomationId },
                origin: 'automation',
                pullRequestNumber: 45,
                repositoryId: 'repo-azure-uuid'
            };

            const createdModel: AutomationExecutionModel = {
                uuid: 'azure-execution-uuid',
                createdAt: new Date('2025-06-11T14:00:00Z'),
                updatedAt: new Date('2025-06-11T14:00:00Z'),
                status: AutomationStatus.SUCCESS,
                dataExecution: azureExecutionData.dataExecution,
                pullRequestNumber: 45,
                repositoryId: 'repo-azure-uuid',
                teamAutomation: { uuid: mockTeamAutomationId } as any,
                origin: 'automation',
                errorMessage: null,
            };

            mockTypeOrmRepository.create.mockReturnValue(createdModel);
            mockTypeOrmRepository.findOne.mockResolvedValue(createdModel);

            // Act
            const result = await service.register(azureExecutionData);

            // Assert
            expect(result).toBeInstanceOf(AutomationExecutionEntity);
            expect(result.dataExecution.platformType).toBe('AZURE_REPOS');
            expect(result.dataExecution.codeManagementEvent).toBe('ms.vss-code.git-pullrequest-comment-event');
            expect(result.pullRequestNumber).toBe(45);
            expect(result.repositoryId).toBe('repo-azure-uuid');
        });

        it('deve gerar UUID automaticamente no service.register', async () => {
            // Arrange
            const automationExecutionData: Omit<IAutomationExecution, 'uuid'> = {
                status: AutomationStatus.SUCCESS,
                dataExecution: {
                    pullRequestNumber: pullRequestNumber,
                    platformType: 'GITLAB',
                    repositoryId: repositoryId
                },
                teamAutomation: { uuid: mockTeamAutomationId },
                origin: 'automation',
                pullRequestNumber: pullRequestNumber,
                repositoryId: repositoryId
            };

            const createdModel: AutomationExecutionModel = {
                uuid: 'generated-uuid',
                createdAt: new Date(),
                updatedAt: new Date(),
                status: AutomationStatus.SUCCESS,
                dataExecution: automationExecutionData.dataExecution,
                pullRequestNumber: pullRequestNumber,
                repositoryId: repositoryId,
                teamAutomation: { uuid: mockTeamAutomationId } as any,
                origin: 'automation',
                errorMessage: null,
            };

            mockTypeOrmRepository.create.mockReturnValue(createdModel);
            mockTypeOrmRepository.findOne.mockResolvedValue(createdModel);

            // Act
            const result = await service.register(automationExecutionData);

            // Assert
            expect(mockTypeOrmRepository.create).toHaveBeenCalledWith({
                ...automationExecutionData,
                uuid: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
            });
            expect(result.uuid).toBe('generated-uuid');
        });

        it('deve manter os campos obrigatórios ao salvar no formato novo', async () => {
            // Arrange
            const automationExecutionData: Omit<IAutomationExecution, 'uuid'> = {
                status: AutomationStatus.SUCCESS,
                dataExecution: {
                    pullRequestNumber: pullRequestNumber,
                    platformType: 'GITHUB',
                    repositoryId: repositoryId,
                    organizationAndTeamData: {
                        teamId: mockTeamAutomationId,
                        organizationId: 'org-uuid'
                    }
                },
                teamAutomation: { uuid: mockTeamAutomationId },
                origin: 'automation',
                // Campos obrigatórios do formato novo
                pullRequestNumber: pullRequestNumber,
                repositoryId: repositoryId
            };

            const createdModel: AutomationExecutionModel = {
                uuid: 'mandatory-fields-uuid',
                createdAt: new Date(),
                updatedAt: new Date(),
                status: AutomationStatus.SUCCESS,
                dataExecution: automationExecutionData.dataExecution,
                pullRequestNumber: pullRequestNumber,
                repositoryId: repositoryId,
                teamAutomation: { uuid: mockTeamAutomationId } as any,
                origin: 'automation',
                errorMessage: null,
            };

            mockTypeOrmRepository.create.mockReturnValue(createdModel);
            mockTypeOrmRepository.findOne.mockResolvedValue(createdModel);

            // Act
            const result = await service.register(automationExecutionData);

            // Assert - Verifica que os campos obrigatórios estão presentes
            expect(result.pullRequestNumber).toBeDefined();
            expect(result.repositoryId).toBeDefined();
            expect(result.status).toBeDefined();
            expect(result.teamAutomation).toBeDefined();
            expect(result.origin).toBeDefined();

            // Verifica que não são null
            expect(result.pullRequestNumber).not.toBeNull();
            expect(result.repositoryId).not.toBeNull();
            expect(result.status).not.toBeNull();
        });
    });
});