import { Test, TestingModule } from '@nestjs/testing';
import { KodyIssuesManagementService } from '@/ee/kodyIssuesManagement/service/kodyIssuesManagement.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { IssuesService } from '@/core/infrastructure/adapters/services/issues/issues.service';
import {
    IPullRequestsService,
    PULL_REQUESTS_SERVICE_TOKEN,
} from '@/core/domain/pullRequests/contracts/pullRequests.service.contracts';
import {
    KODY_ISSUES_ANALYSIS_SERVICE_TOKEN,
    KodyIssuesAnalysisService,
} from '@/ee/codeBase/kodyIssuesAnalysis.service';
import {
    IPullRequestManagerService,
    PULL_REQUEST_MANAGER_SERVICE_TOKEN,
} from '@/core/domain/codeBase/contracts/PullRequestManagerService.contract';
import { CacheService } from '@/shared/utils/cache/cache.service';
import { IssuesEntity } from '@/core/domain/issues/entities/issues.entity';
import { IssueStatus } from '@/config/types/general/issues.type';
import { LabelType } from '@/shared/utils/codeManagement/labels';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';

import { contextToGenerateIssues } from '@/ee/kodyIssuesManagement/domain/kodyIssuesManagement.interface';
import { ISSUES_SERVICE_TOKEN } from '@/core/domain/issues/contracts/issues.service.contract';

describe('KodyIssuesManagementService - resolveExistingIssues', () => {
    let service: KodyIssuesManagementService;
    let mockIssuesService: jest.Mocked<IssuesService>;
    let mockKodyIssuesAnalysisService: jest.Mocked<KodyIssuesAnalysisService>;
    let mockPullRequestHandlerService: jest.Mocked<IPullRequestManagerService>;
    let mockLogger: jest.Mocked<PinoLoggerService>;

    const mockContext: contextToGenerateIssues = {
        organizationAndTeamData: {
            organizationId: 'org-123',
            teamId: 'team-456',
        },
        repository: {
            id: 'repo-789',
            name: 'test-repository',
            full_name: 'organization/test-repository',
            platform: PlatformType.GITHUB,
            url: 'https://github.com/organization/test-repository',
        },
        pullRequest: {
            number: 101,
            title: 'Fix security issues',
            author: 'developer1',
        },
        prFiles: [
            {
                path: 'src/controllers/UserController.cs',
                suggestions: [
                    {
                        id: 'suggestion-1',
                        language: 'csharp',
                        suggestionContent: 'Add logging for exceptions',
                    },
                ],
            },
        ],
    };

    const mockOpenIssues: IssuesEntity[] = [
        new IssuesEntity({
            uuid: 'issue-1',
            title: 'Missing exception logging in UserController',
            description: 'Exception should be logged for debugging purposes',
            filePath: 'src/controllers/UserController.cs',
            language: 'csharp',
            label: LabelType.MAINTAINABILITY,
            severity: SeverityLevel.MEDIUM,
            contributingSuggestions: [
                {
                    id: 'suggestion-1',
                    prNumber: 101,
                    prAuthor: { id: 'dev-1', name: 'Developer 1' },
                    suggestionContent: 'Add logging for exceptions',
                    oneSentenceSummary: 'Missing exception logging',
                    relevantFile: 'src/controllers/UserController.cs',
                    language: 'csharp',
                    existingCode:
                        'catch (Exception ex) { return BadRequest(); }',
                    improvedCode:
                        'catch (Exception ex) { _logger.LogError(ex, "Error"); return BadRequest(); }',
                    startLine: 25,
                    endLine: 27,
                },
            ],
            repository: mockContext.repository,
            organizationId: 'org-123',
            age: '2 days',
            status: IssueStatus.OPEN,
            createdAt: '2024-01-01T10:00:00Z',
            updatedAt: '2024-01-01T10:00:00Z',
        }),
        new IssuesEntity({
            uuid: 'issue-2',
            title: 'Invalid ID message should be in Portuguese',
            description: 'Error message should be in pt-BR for consistency',
            filePath: 'src/controllers/UserController.cs',
            language: 'csharp',
            label: LabelType.CODE_STYLE,
            severity: SeverityLevel.LOW,
            contributingSuggestions: [
                {
                    id: 'suggestion-2',
                    prNumber: 101,
                    prAuthor: { id: 'dev-1', name: 'Developer 1' },
                    suggestionContent: 'Translate error message to Portuguese',
                    oneSentenceSummary: 'Error message localization',
                    relevantFile: 'src/controllers/UserController.cs',
                    language: 'csharp',
                    existingCode: 'return BadRequest("Invalid ID");',
                    improvedCode: 'return BadRequest("ID inválido");',
                    startLine: 15,
                    endLine: 15,
                },
            ],
            repository: mockContext.repository,
            organizationId: 'org-123',
            age: '1 day',
            status: IssueStatus.OPEN,
            createdAt: '2024-01-02T10:00:00Z',
            updatedAt: '2024-01-02T10:00:00Z',
        }),
    ];

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                KodyIssuesManagementService,
                {
                    provide: PinoLoggerService,
                    useValue: {
                        log: jest.fn(),
                        error: jest.fn(),
                    },
                },
                {
                    provide: ISSUES_SERVICE_TOKEN,
                    useValue: {
                        findByFileAndStatus: jest.fn(),
                        updateStatus: jest.fn(),
                    },
                },
                {
                    provide: PULL_REQUESTS_SERVICE_TOKEN,
                    useValue: {},
                },
                {
                    provide: KODY_ISSUES_ANALYSIS_SERVICE_TOKEN,
                    useValue: {
                        resolveExistingIssues: jest.fn(),
                    },
                },
                {
                    provide: PULL_REQUEST_MANAGER_SERVICE_TOKEN,
                    useValue: {
                        getChangedFiles: jest.fn(),
                    },
                },
                {
                    provide: CacheService,
                    useValue: {},
                },
            ],
        }).compile();

        service = module.get<KodyIssuesManagementService>(
            KodyIssuesManagementService,
        );
        mockIssuesService = module.get(ISSUES_SERVICE_TOKEN);
        mockKodyIssuesAnalysisService = module.get(
            KODY_ISSUES_ANALYSIS_SERVICE_TOKEN,
        );
        mockPullRequestHandlerService = module.get(
            PULL_REQUEST_MANAGER_SERVICE_TOKEN,
        );
        mockLogger =
            module.get<jest.Mocked<PinoLoggerService>>(PinoLoggerService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('resolveExistingIssues', () => {
        describe('when issues are resolved (isIssuePresentInCode: false)', () => {
            it('should update issue status to RESOLVED when LLM indicates issue is not present in code', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\n// Fixed code with proper logging\npublic class UserController { }',
                    },
                ];

                const mockLLMResponse = {
                    issueVerificationResults: [
                        {
                            issueId: 'issue-1',
                            issueTitle:
                                'Missing exception logging in UserController',
                            contributingSuggestionIds: ['suggestion-1'],
                            isIssuePresentInCode: false, // Issue foi resolvida
                            verificationConfidence: 'high',
                            reasoning:
                                'The exception is now properly logged in the catch block.',
                        },
                        {
                            issueId: 'issue-2',
                            issueTitle:
                                'Invalid ID message should be in Portuguese',
                            contributingSuggestionIds: ['suggestion-2'],
                            isIssuePresentInCode: false, // Issue foi resolvida
                            verificationConfidence: 'high',
                            reasoning: 'Error message is now in Portuguese.',
                        },
                    ],
                };

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus.mockResolvedValue(
                    mockOpenIssues,
                );
                mockKodyIssuesAnalysisService.resolveExistingIssues.mockResolvedValue(
                    mockLLMResponse,
                );
                mockIssuesService.updateStatus.mockResolvedValue(
                    mockOpenIssues[0],
                );

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockContext.prFiles,
                );

                // Assert
                expect(
                    mockPullRequestHandlerService.getChangedFiles,
                ).toHaveBeenCalledWith(
                    mockContext.organizationAndTeamData,
                    mockContext.repository,
                    mockContext.pullRequest,
                    [],
                    null,
                );

                expect(
                    mockIssuesService.findByFileAndStatus,
                ).toHaveBeenCalledWith(
                    'org-123',
                    'repo-789',
                    'src/controllers/UserController.cs',
                    IssueStatus.OPEN,
                );

                expect(
                    mockKodyIssuesAnalysisService.resolveExistingIssues,
                ).toHaveBeenCalledWith(
                    mockContext,
                    expect.objectContaining({
                        filePath: 'src/controllers/UserController.cs',
                        language: 'csharp',
                        currentCode:
                            'using System;\n// Fixed code with proper logging\npublic class UserController { }',
                        issues: expect.arrayContaining([
                            expect.objectContaining({
                                issueId: 'issue-1',
                                title: 'Missing exception logging in UserController',
                                contributingSuggestionIds: ['suggestion-1'],
                            }),
                            expect.objectContaining({
                                issueId: 'issue-2',
                                title: 'Invalid ID message should be in Portuguese',
                                contributingSuggestionIds: ['suggestion-2'],
                            }),
                        ]),
                    }),
                );

                // Deve atualizar ambas as issues para RESOLVED
                expect(mockIssuesService.updateStatus).toHaveBeenCalledTimes(2);
                expect(mockIssuesService.updateStatus).toHaveBeenCalledWith(
                    'issue-1',
                    IssueStatus.RESOLVED,
                );
                expect(mockIssuesService.updateStatus).toHaveBeenCalledWith(
                    'issue-2',
                    IssueStatus.RESOLVED,
                );
            });

            it('should update only resolved issues and leave unresolved ones open', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\n// Partially fixed code\npublic class UserController { }',
                    },
                ];

                const mockLLMResponse = {
                    issueVerificationResults: [
                        {
                            issueId: 'issue-1',
                            issueTitle:
                                'Missing exception logging in UserController',
                            contributingSuggestionIds: ['suggestion-1'],
                            isIssuePresentInCode: false, // Esta foi resolvida
                            verificationConfidence: 'high',
                            reasoning: 'The exception is now properly logged.',
                        },
                        {
                            issueId: 'issue-2',
                            issueTitle:
                                'Invalid ID message should be in Portuguese',
                            contributingSuggestionIds: ['suggestion-2'],
                            isIssuePresentInCode: true, // Esta ainda existe
                            verificationConfidence: 'high',
                            reasoning: 'Error message is still in English.',
                        },
                    ],
                };

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus.mockResolvedValue(
                    mockOpenIssues,
                );
                mockKodyIssuesAnalysisService.resolveExistingIssues.mockResolvedValue(
                    mockLLMResponse,
                );
                mockIssuesService.updateStatus.mockResolvedValue(
                    mockOpenIssues[0],
                );

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockContext.prFiles,
                );

                // Assert
                // Deve atualizar apenas a issue-1 para RESOLVED (issue-2 continua aberta)
                expect(mockIssuesService.updateStatus).toHaveBeenCalledTimes(1);
                expect(mockIssuesService.updateStatus).toHaveBeenCalledWith(
                    'issue-1',
                    IssueStatus.RESOLVED,
                );
                expect(mockIssuesService.updateStatus).not.toHaveBeenCalledWith(
                    'issue-2',
                    IssueStatus.RESOLVED,
                );
            });
        });

        describe('when no issues are resolved (isIssuePresentInCode: true)', () => {
            it('should not update any issue status when all issues are still present in code', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\n// Code with issues still present\npublic class UserController { }',
                    },
                ];

                const mockLLMResponse = {
                    issueVerificationResults: [
                        {
                            issueId: 'issue-1',
                            issueTitle:
                                'Missing exception logging in UserController',
                            contributingSuggestionIds: ['suggestion-1'],
                            isIssuePresentInCode: true, // Issue ainda existe
                            verificationConfidence: 'high',
                            reasoning: 'Exception is still not being logged.',
                        },
                        {
                            issueId: 'issue-2',
                            issueTitle:
                                'Invalid ID message should be in Portuguese',
                            contributingSuggestionIds: ['suggestion-2'],
                            isIssuePresentInCode: true, // Issue ainda existe
                            verificationConfidence: 'high',
                            reasoning: 'Error message is still in English.',
                        },
                    ],
                };

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus.mockResolvedValue(
                    mockOpenIssues,
                );
                mockKodyIssuesAnalysisService.resolveExistingIssues.mockResolvedValue(
                    mockLLMResponse,
                );

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockContext.prFiles,
                );

                // Assert
                expect(
                    mockKodyIssuesAnalysisService.resolveExistingIssues,
                ).toHaveBeenCalled();
                // Não deve chamar updateStatus para nenhuma issue
                expect(mockIssuesService.updateStatus).not.toHaveBeenCalled();
            });
        });

        describe('when no open issues exist for file', () => {
            it('should not call LLM when no open issues are found for the file', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\npublic class UserController { }',
                    },
                ];

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus.mockResolvedValue([]); // Nenhuma issue aberta

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockContext.prFiles,
                );

                // Assert
                expect(
                    mockPullRequestHandlerService.getChangedFiles,
                ).toHaveBeenCalledWith(
                    mockContext.organizationAndTeamData,
                    mockContext.repository,
                    mockContext.pullRequest,
                    [],
                    null,
                );

                expect(
                    mockIssuesService.findByFileAndStatus,
                ).toHaveBeenCalledWith(
                    'org-123',
                    'repo-789',
                    'src/controllers/UserController.cs',
                    IssueStatus.OPEN,
                );
                expect(
                    mockKodyIssuesAnalysisService.resolveExistingIssues,
                ).not.toHaveBeenCalled();
                expect(mockIssuesService.updateStatus).not.toHaveBeenCalled();
            });

            it('should not call LLM when findByFileAndStatus returns null', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\npublic class UserController { }',
                    },
                ];

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus.mockResolvedValue(null);

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockContext.prFiles,
                );

                // Assert
                expect(
                    mockKodyIssuesAnalysisService.resolveExistingIssues,
                ).not.toHaveBeenCalled();
                expect(mockIssuesService.updateStatus).not.toHaveBeenCalled();
            });
        });

        describe('when no files are provided', () => {
            it('should not process anything when files array is empty', async () => {
                // Arrange & Act
                await service.resolveExistingIssues(
                    mockContext,
                    [], // Array vazio de arquivos
                );

                // Assert
                expect(
                    mockPullRequestHandlerService.getChangedFiles,
                ).not.toHaveBeenCalled();
                expect(
                    mockIssuesService.findByFileAndStatus,
                ).not.toHaveBeenCalled();
                expect(
                    mockKodyIssuesAnalysisService.resolveExistingIssues,
                ).not.toHaveBeenCalled();
                expect(mockIssuesService.updateStatus).not.toHaveBeenCalled();
            });
        });

        describe('multiple files processing', () => {
            it('should process multiple files and resolve issues in each', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\npublic class UserController { }',
                    },
                    {
                        filename: 'src/services/UserService.cs',
                        fileContent:
                            'using System;\npublic class UserService { }',
                    },
                ];

                // Criamos um contexto com ambos os arquivos no prFiles
                const contextWithMultipleFiles = {
                    ...mockContext,
                    prFiles: [
                        {
                            path: 'src/controllers/UserController.cs',
                            suggestions: [
                                {
                                    id: 'suggestion-1',
                                    language: 'csharp',
                                    suggestionContent: 'Add logging for exceptions',
                                },
                            ],
                        },
                        {
                            path: 'src/services/UserService.cs',
                            suggestions: [
                                {
                                    id: 'suggestion-2',
                                    language: 'csharp',
                                    suggestionContent: 'Translate error message to Portuguese',
                                },
                            ],
                        },
                    ],
                };

                const mockIssuesFile1 = [mockOpenIssues[0]];
                const mockIssuesFile2 = [mockOpenIssues[1]];

                const mockLLMResponseFile1 = {
                    issueVerificationResults: [
                        {
                            issueId: 'issue-1',
                            isIssuePresentInCode: false,
                            verificationConfidence: 'high',
                            reasoning: 'Issue resolved in file 1',
                        },
                    ],
                };

                const mockLLMResponseFile2 = {
                    issueVerificationResults: [
                        {
                            issueId: 'issue-2',
                            isIssuePresentInCode: false,
                            verificationConfidence: 'high',
                            reasoning: 'Issue resolved in file 2',
                        },
                    ],
                };

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus
                    .mockResolvedValueOnce(mockIssuesFile1)
                    .mockResolvedValueOnce(mockIssuesFile2);
                mockKodyIssuesAnalysisService.resolveExistingIssues
                    .mockResolvedValueOnce(mockLLMResponseFile1)
                    .mockResolvedValueOnce(mockLLMResponseFile2);
                mockIssuesService.updateStatus.mockResolvedValue(
                    mockOpenIssues[0],
                );

                // Act
                await service.resolveExistingIssues(
                    contextWithMultipleFiles,
                    contextWithMultipleFiles.prFiles,
                );

                // Assert
                expect(
                    mockIssuesService.findByFileAndStatus,
                ).toHaveBeenCalledTimes(2);
                expect(
                    mockKodyIssuesAnalysisService.resolveExistingIssues,
                ).toHaveBeenCalledTimes(2);
                expect(mockIssuesService.updateStatus).toHaveBeenCalledTimes(2);
                expect(mockIssuesService.updateStatus).toHaveBeenCalledWith(
                    'issue-1',
                    IssueStatus.RESOLVED,
                );
                expect(mockIssuesService.updateStatus).toHaveBeenCalledWith(
                    'issue-2',
                    IssueStatus.RESOLVED,
                );
            });
        });

        describe('error handling', () => {
            it('should log error and continue when LLM service fails', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\npublic class UserController { }',
                    },
                ];

                const llmError = new Error('LLM service unavailable');

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus.mockResolvedValue(
                    mockOpenIssues,
                );
                mockKodyIssuesAnalysisService.resolveExistingIssues.mockRejectedValue(
                    llmError,
                );

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockContext.prFiles,
                );

                // Assert
                expect(mockLogger.error).toHaveBeenCalledWith({
                    message: 'Error resolving existing issues',
                    context: KodyIssuesManagementService.name,
                    error: llmError,
                    metadata: {
                        organizationAndTeamData:
                            mockContext.organizationAndTeamData,
                        repositoryId: mockContext.repository.id,
                        prNumber: mockContext.pullRequest.number,
                    },
                });
                expect(mockIssuesService.updateStatus).not.toHaveBeenCalled();
            });

            it('should log error and continue when issues service fails', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\npublic class UserController { }',
                    },
                ];

                const dbError = new Error('Database connection failed');

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus.mockRejectedValue(
                    dbError,
                );

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockContext.prFiles,
                );

                // Assert
                expect(mockLogger.error).toHaveBeenCalledWith({
                    message: 'Error resolving existing issues',
                    context: KodyIssuesManagementService.name,
                    error: dbError,
                    metadata: expect.objectContaining({
                        organizationAndTeamData:
                            mockContext.organizationAndTeamData,
                        repositoryId: mockContext.repository.id,
                        prNumber: mockContext.pullRequest.number,
                    }),
                });
            });

            it('should handle missing file data gracefully', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\npublic class UserController { }',
                    },
                ];

                const mockPrFilesWithoutMatchingFile = [
                    {
                        path: 'src/different/file.cs', // Arquivo que não está nos changedFiles
                        suggestions: [],
                    },
                ];

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                // O mock deve retornar array vazio para o arquivo que não existe
                mockIssuesService.findByFileAndStatus.mockResolvedValue([]);

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockPrFilesWithoutMatchingFile,
                );

                // Assert
                expect(
                    mockPullRequestHandlerService.getChangedFiles,
                ).toHaveBeenCalledWith(
                    mockContext.organizationAndTeamData,
                    mockContext.repository,
                    mockContext.pullRequest,
                    [],
                    null,
                );

                expect(
                    mockIssuesService.findByFileAndStatus,
                ).toHaveBeenCalledWith(
                    'org-123',
                    'repo-789',
                    'src/different/file.cs', // Deve buscar pelo arquivo correto
                    IssueStatus.OPEN,
                );

                // Deve continuar processando sem chamar o LLM (porque não há issues abertas para o arquivo)
                expect(
                    mockKodyIssuesAnalysisService.resolveExistingIssues,
                ).not.toHaveBeenCalled();
                expect(mockIssuesService.updateStatus).not.toHaveBeenCalled();
            });
        });

        describe('edge cases', () => {
            it('should handle LLM response without issueVerificationResults', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\npublic class UserController { }',
                    },
                ];

                const mockLLMResponse = {}; // Resposta vazia/inválida

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus.mockResolvedValue(
                    mockOpenIssues,
                );
                mockKodyIssuesAnalysisService.resolveExistingIssues.mockResolvedValue(
                    mockLLMResponse,
                );

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockContext.prFiles,
                );

                // Assert
                expect(
                    mockKodyIssuesAnalysisService.resolveExistingIssues,
                ).toHaveBeenCalled();
                expect(mockIssuesService.updateStatus).not.toHaveBeenCalled();
            });

            it('should handle LLM response with null issueVerificationResults', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent:
                            'using System;\npublic class UserController { }',
                    },
                ];

                const mockLLMResponse = {
                    issueVerificationResults: null,
                };

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus.mockResolvedValue(
                    mockOpenIssues,
                );
                mockKodyIssuesAnalysisService.resolveExistingIssues.mockResolvedValue(
                    mockLLMResponse,
                );

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockContext.prFiles,
                );

                // Assert
                expect(mockIssuesService.updateStatus).not.toHaveBeenCalled();
            });

            it('should build correct prompt data with issue details', async () => {
                // Arrange
                const mockChangedFilesData = [
                    {
                        filename: 'src/controllers/UserController.cs',
                        fileContent: 'corrected code content here',
                    },
                ];

                const mockLLMResponse = {
                    issueVerificationResults: [],
                };

                mockPullRequestHandlerService.getChangedFiles.mockResolvedValue(
                    mockChangedFilesData as any,
                );
                mockIssuesService.findByFileAndStatus.mockResolvedValue(
                    mockOpenIssues,
                );
                mockKodyIssuesAnalysisService.resolveExistingIssues.mockResolvedValue(
                    mockLLMResponse,
                );

                // Act
                await service.resolveExistingIssues(
                    mockContext,
                    mockContext.prFiles,
                );

                // Assert
                expect(
                    mockKodyIssuesAnalysisService.resolveExistingIssues,
                ).toHaveBeenCalledWith(
                    mockContext,
                    expect.objectContaining({
                        filePath: 'src/controllers/UserController.cs',
                        language: 'csharp',
                        currentCode: 'corrected code content here',
                        issues: expect.arrayContaining([
                            expect.objectContaining({
                                issueId: 'issue-1',
                                title: 'Missing exception logging in UserController',
                                description:
                                    'Exception should be logged for debugging purposes',
                                contributingSuggestionIds: ['suggestion-1'],
                            }),
                            expect.objectContaining({
                                issueId: 'issue-2',
                                title: 'Invalid ID message should be in Portuguese',
                                description:
                                    'Error message should be in pt-BR for consistency',
                                contributingSuggestionIds: ['suggestion-2'],
                            }),
                        ]),
                    }),
                );
            });
        });
    });
});
