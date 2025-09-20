// Mock Sentry and OpenTelemetry to avoid initialization issues in tests (pattern used in other tests)
jest.mock('@sentry/node', () => ({
    init: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    configureScope: jest.fn(),
    withScope: jest.fn(),
    getCurrentHub: jest.fn(),
    addBreadcrumb: jest.fn(),
}));

jest.mock('@opentelemetry/api', () => ({
    trace: {
        getTracer: jest.fn(() => ({
            startSpan: jest.fn(() => ({
                setAttributes: jest.fn(),
                setStatus: jest.fn(),
                recordException: jest.fn(),
                end: jest.fn(),
            })),
        })),
    },
    context: { active: jest.fn(), with: jest.fn() },
}));

// Mock @kodus/flow (ESM) to avoid Jest ESM parsing issues in tests
jest.mock('@kodus/flow', () => {
    return {
        createDirectLLMAdapter: (x: any) => x,
        createMCPAdapter: jest.fn(() => ({})),
        createOrchestration: jest.fn(() => ({
            connectMCP: jest.fn(),
            registerMCPTools: jest.fn(),
            createAgent: jest.fn(),
            callAgent: jest.fn().mockResolvedValue({ result: '', context: {} }),
            getExecutionTimeline: jest.fn(),
        })),
    } as any;
});

import { Test, TestingModule } from '@nestjs/testing';
import { GitHubPullRequestHandler } from '../../../src/core/infrastructure/adapters/webhooks/github/githubPullRequest.handler';
import { PinoLoggerService } from '../../../src/core/infrastructure/adapters/services/logger/pino.service';
import { SavePullRequestUseCase } from '../../../src/core/application/use-cases/pullRequests/save.use-case';
import { RunCodeReviewAutomationUseCase } from '../../../src/ee/automation/runCodeReview.use-case';
import { ChatWithKodyFromGitUseCase } from '../../../src/core/application/use-cases/platformIntegration/codeManagement/chatWithKodyFromGit.use-case';
import { CodeManagementService } from '../../../src/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { GenerateIssuesFromPrClosedUseCase } from '../../../src/core/application/use-cases/issues/generate-issues-from-pr-closed.use-case';
import { KodyRulesSyncService } from '../../../src/core/infrastructure/adapters/services/kodyRules/kody-rules-sync.service';
import { CreateOrUpdateKodyRulesUseCase } from '../../../src/core/application/use-cases/kodyRules/create-or-update.use-case';
import { LLMModule, PromptRunnerService } from '@kodus/kodus-common/llm';
import { PlatformType } from '../../../src/shared/domain/enums/platform-type.enum';

describe('GitHubPullRequestHandler - KodyRules sync on PR merged', () => {
    let handler: GitHubPullRequestHandler;
    let logger: jest.Mocked<PinoLoggerService>;
    let savePullRequestUseCase: { execute: jest.Mock };
    let runCodeReviewAutomationUseCase: {
        execute: jest.Mock;
        findTeamWithActiveCodeReview: jest.Mock;
    };
    let chatWithKodyFromGitUseCase: { execute: jest.Mock };
    let generateIssuesFromPrClosedUseCase: { execute: jest.Mock };
    let codeManagementService: {
        getDefaultBranch: jest.Mock;
        getFilesByPullRequestId: jest.Mock;
        getRepositoryContentFile: jest.Mock;
        getPullRequestByNumber: jest.Mock;
    };
    let upsertRuleUseCase: { execute: jest.Mock };

    const organizationAndTeamData = {
        organizationId: 'org-1',
        teamId: 'team-1',
    } as any;
    const repository = {
        id: '1034598462',
        name: 'bug-game-running',
        fullName: 'kodustech/bug-game-running',
    } as any;
    const prNumber = 7;

    let testingModule: TestingModule;

    beforeEach(async () => {
        logger = {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            info: jest.fn(),
        } as any;
        savePullRequestUseCase = { execute: jest.fn().mockResolvedValue({}) };
        runCodeReviewAutomationUseCase = {
            execute: jest.fn(),
            findTeamWithActiveCodeReview: jest
                .fn()
                .mockResolvedValue({ organizationAndTeamData }),
        };
        chatWithKodyFromGitUseCase = { execute: jest.fn() };
        generateIssuesFromPrClosedUseCase = { execute: jest.fn() };

        const changedFiles = [
            { filename: '.cursor/rules/debugging.mdc', status: 'added' },
            { filename: '.cursor/rules/game-state.mdc', status: 'added' },
            { filename: '.cursor/rules/rng.mdc', status: 'added' },
        ];

        codeManagementService = {
            getDefaultBranch: jest.fn().mockResolvedValue('main'),
            getFilesByPullRequestId: jest.fn().mockResolvedValue(changedFiles),
            getPullRequestByNumber: jest
                .fn()
                .mockResolvedValue({
                    head: { ref: 'feat/new_rules_4' },
                    base: { ref: 'main' },
                }),
            getRepositoryContentFile: jest
                .fn()
                .mockImplementation(async ({ file }: any) => {
                    const map: Record<string, string> = {
                        '.cursor/rules/debugging.mdc': `---\ndescription: Debugging and developer toggles\nglobs:\nalwaysApply: false\n---\n\n- Enable debug via query flags (e.g., \`?debug=1&nofx=1\`); only in \`import.meta.env.DEV\`.\n- Provide lightweight FPS counter and hitbox render toggles; avoid heavy per-pixel debug.\n- Guard debug logs with \`if (import.meta.env.DEV)\` and prefer \`console.debug\`.\n- Keep debug-only code behind flags to ensure it tree-shakes in production.\n- Never persist debug settings to users by default; use sessionStorage if needed.\n\n@debug-template.ts`,
                        '.cursor/rules/game-state.mdc': `---\ndescription: Game state machine and transitions\nglobs:\nalwaysApply: false\n---\n\n- States: \`menu\` → \`running\` → \`gameover\`; transitions only through a central handler.\n- On \`reset\`, reinitialize score, timers, speed, obstacles, and player physics; do not leak state.\n- Gate inputs on edges (justPressed) when entering states to avoid accidental double actions.\n- UI overlays (title/game over) must not block rendering; keep input checks active.\n- Consider optional \`paused\` state if adding menus; freeze update but allow render.\n\n@state-machine-template.ts`,
                        '.cursor/rules/rng.mdc': `---\ndescription: Randomness and RNG determinism\nglobs:\nalwaysApply: false\n---\n\n- Use the shared \`RNG\` helper from \`utils.ts\`; avoid using \`Math.random()\` directly.\n- Expose \`range(min,max)\` and \`int(min,maxInclusive)\` for clarity; avoid modulo bias.\n- Seed RNG once per run (default: time-based); allow debug seed via query (e.g., \`?seed=1234\`).\n- Keep obstacle spawning and any procedural effects driven by this RNG to enable reproducible runs.\n- Optionally persist last seed in sessionStorage for bug reports.\n\n@rng-template.ts`,
                    };
                    const content = map[file.filename] || '';
                    return {
                        data: {
                            content: Buffer.from(content, 'utf-8').toString(
                                'base64',
                            ),
                            encoding: 'base64',
                        },
                    };
                }),
        } as any;

        upsertRuleUseCase = {
            execute: jest.fn().mockResolvedValue({}),
        };

        const module: TestingModule = await Test.createTestingModule({
            imports: [LLMModule.forRoot({ logger: PinoLoggerService })],
            providers: [
                GitHubPullRequestHandler,
                KodyRulesSyncService,
                { provide: PinoLoggerService, useValue: logger },
                {
                    provide: SavePullRequestUseCase,
                    useValue: savePullRequestUseCase,
                },
                {
                    provide: RunCodeReviewAutomationUseCase,
                    useValue: runCodeReviewAutomationUseCase,
                },
                {
                    provide: ChatWithKodyFromGitUseCase,
                    useValue: chatWithKodyFromGitUseCase,
                },
                {
                    provide: CodeManagementService,
                    useValue: codeManagementService,
                },
                {
                    provide: GenerateIssuesFromPrClosedUseCase,
                    useValue: generateIssuesFromPrClosedUseCase,
                },
                {
                    provide: CreateOrUpdateKodyRulesUseCase,
                    useValue: upsertRuleUseCase,
                },
            ],
        }).compile();

        testingModule = module;
        handler = module.get(GitHubPullRequestHandler);
    });

    afterAll(async () => {
        try {
            await (testingModule as any)?.close?.();
        } catch {}
    });

    it('deve crgetNovitaAIiar Kody Rules a partir de arquivos de rules ao mergear PR no default branch, preenchendo sourcePath e path', async () => {
        const params = {
            platformType: PlatformType.GITHUB,
            event: 'pull_request',
            payload: {
                action: 'closed',
                pull_request: {
                    number: prNumber,
                    merged: true,
                    base: { ref: 'main' },
                    html_url:
                        'https://github.com/kodustech/bug-game-running/pull/7',
                },
                repository: {
                    id: repository.id,
                    name: repository.name,
                    full_name: repository.fullName,
                },
            },
        } as any;

        const promptRunner = testingModule.get(PromptRunnerService);
        const runSpy = jest.spyOn(promptRunner, 'runPrompt');

        await handler.execute(params);

        // valida que houve tentativa de chamada real ao LLM
        expect(runSpy).toHaveBeenCalled();

        // valida que buscamos conteúdo via PR refs
        expect(
            codeManagementService.getPullRequestByNumber,
        ).toHaveBeenCalledWith(expect.objectContaining({ prNumber }));
        expect(
            codeManagementService.getRepositoryContentFile,
        ).toHaveBeenCalled();
    });
});
