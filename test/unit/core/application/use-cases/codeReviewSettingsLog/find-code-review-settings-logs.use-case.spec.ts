import { Test, TestingModule } from '@nestjs/testing';
import { FindCodeReviewSettingsLogsUseCase } from '@/core/application/use-cases/codeReviewSettingsLog/find-code-review-settings-logs.use-case';
import { ICodeReviewSettingsLogService, CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN } from '@/core/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.service.contract';
import { CodeReviewSettingsLogEntity } from '@/core/domain/codeReviewSettingsLog/entities/codeReviewSettingsLog.entity';
import { CodeReviewSettingsLogFiltersDto } from '@/core/infrastructure/http/dtos/code-review-settings-log-filters.dto';
import { ActionType, ConfigLevel } from '@/config/types/general/codeReviewSettingsLog.type';

describe('FindCodeReviewSettingsLogsUseCase', () => {
    let useCase: FindCodeReviewSettingsLogsUseCase;
    let mockService: jest.Mocked<ICodeReviewSettingsLogService>;

    const mockLogEntity = {
        uuid: 'test-uuid',
        organizationId: 'org-123',
        teamId: 'team-123',
        action: ActionType.CREATE,
        userInfo: {
            userId: 'user-123',
            userEmail: 'test@example.com',
        },
        configLevel: ConfigLevel.MAIN,
        repository: {
            id: 'repo-123',
            name: 'test-repo',
        },
        changedData: [],
        toObject: jest.fn().mockReturnValue({
            uuid: 'test-uuid',
            organizationId: 'org-123',
            teamId: 'team-123',
            action: ActionType.CREATE,
            userInfo: {
                userId: 'user-123',
                userEmail: 'test@example.com',
            },
            configLevel: ConfigLevel.MAIN,
            repository: {
                id: 'repo-123',
                name: 'test-repo',
            },
            changedData: [],
            createdAt: new Date(),
        }),
    } as any;

    beforeEach(async () => {
        const mockServiceProvider = {
            provide: CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN,
            useValue: {
                find: jest.fn(),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FindCodeReviewSettingsLogsUseCase,
                mockServiceProvider,
            ],
        }).compile();

        useCase = module.get<FindCodeReviewSettingsLogsUseCase>(FindCodeReviewSettingsLogsUseCase);
        mockService = module.get(CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN);
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    it('should return logs with pagination', async () => {
        const filters: CodeReviewSettingsLogFiltersDto = {
            page: 1,
            limit: 10,
            organizationId: 'org-123',
        };

        const mockLogs = [mockLogEntity, mockLogEntity];
        mockService.find.mockResolvedValue(mockLogs);

        const result = await useCase.execute(filters);

        expect(mockService.find).toHaveBeenCalledWith({
            organizationId: 'org-123',
        });
        expect(result.logs).toHaveLength(2);
        expect(result.total).toBe(2);
        expect(result.page).toBe(1);
        expect(result.limit).toBe(10);
        expect(result.totalPages).toBe(1);
    });

    it('should apply filters correctly', async () => {
        const filters: CodeReviewSettingsLogFiltersDto = {
            organizationId: 'org-123',
            teamId: 'team-123',
            action: ActionType.CREATE,
            configLevel: ConfigLevel.MAIN,
            userId: 'user-123',
            userEmail: 'test@example.com',
            repositoryId: 'repo-123',
        };

        mockService.find.mockResolvedValue([]);

        await useCase.execute(filters);

        expect(mockService.find).toHaveBeenCalledWith({
            organizationId: 'org-123',
            teamId: 'team-123',
            action: ActionType.CREATE,
            configLevel: ConfigLevel.MAIN,
            'userInfo.userId': 'user-123',
            'userInfo.userEmail': 'test@example.com',
            'repository.id': 'repo-123',
        });
    });

    it('should apply date filters correctly', async () => {
        const startDate = new Date('2024-01-01');
        const endDate = new Date('2024-12-31');
        
        const filters: CodeReviewSettingsLogFiltersDto = {
            startDate,
            endDate,
        };

        mockService.find.mockResolvedValue([]);

        await useCase.execute(filters);

        expect(mockService.find).toHaveBeenCalledWith({
            createdAt: {
                $gte: startDate,
                $lte: endDate,
            },
        });
    });
}); 