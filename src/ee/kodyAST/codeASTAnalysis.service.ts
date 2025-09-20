import {
    Repository,
    ReviewModeResponse,
    AnalysisContext,
    AIAnalysisResult,
    CodeSuggestion,
} from '@/config/types/general/codeReview.type';
import { IASTAnalysisService } from '@/core/domain/codeBase/contracts/ASTAnalysisService.contract';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { prompt_detectBreakingChanges } from '@/shared/utils/langchainCommon/prompts/detectBreakingChanges';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { LLMResponseProcessor } from '@/core/infrastructure/adapters/services/codeBase/utils/transforms/llmResponseProcessor.transform';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { ClientGrpc } from '@nestjs/microservices';
import { lastValueFrom, reduce, map, retry } from 'rxjs';
import { concatUint8Arrays } from '@/shared/utils/buffer/arrays';
import {
    ASTAnalyzerServiceClient,
    AST_ANALYZER_SERVICE_NAME,
    GetImpactAnalysisResponse,
    InitializeImpactAnalysisResponse,
    InitializeRepositoryResponse,
} from '@kodus/kodus-proto/ast';
import {
    RepositoryData,
    ProtoAuthMode,
    ProtoPlatformType,
} from '@kodus/kodus-proto/ast/v2';
import { AuthMode } from '@/core/domain/platformIntegrations/enums/codeManagement/authMode.enum';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import {
    GetTaskInfoResponse,
    TASK_MANAGER_SERVICE_NAME,
    TaskManagerServiceClient,
    TaskStatus,
} from '@kodus/kodus-proto/task';
import {
    CircuitBreakerOpenError,
    initCircuitBreaker,
    circuitBreaker,
} from '@/shared/utils/rxjs/circuit-breaker';
import { Metadata } from '@grpc/grpc-js';
import {
    LLMModelProvider,
    PromptRunnerService,
    PromptRole,
    ParserType,
} from '@kodus/kodus-common/llm';
import { status as Status } from '@grpc/grpc-js';

@Injectable()
export class CodeAstAnalysisService
    implements IASTAnalysisService, OnModuleInit
{
    private readonly llmResponseProcessor: LLMResponseProcessor;
    private astMicroservice: ASTAnalyzerServiceClient;
    private taskMicroservice: TaskManagerServiceClient;

    constructor(
        private readonly codeManagementService: CodeManagementService,
        private readonly logger: PinoLoggerService,

        @Inject('AST_MICROSERVICE')
        private readonly astMicroserviceClient: ClientGrpc,

        @Inject('TASK_MICROSERVICE')
        private readonly taskMicroserviceClient: ClientGrpc,

        private readonly promptRunnerService: PromptRunnerService,
    ) {
        this.llmResponseProcessor = new LLMResponseProcessor(logger);
    }

    onModuleInit() {
        this.astMicroservice = this.astMicroserviceClient.getService(
            AST_ANALYZER_SERVICE_NAME,
        );
        this.taskMicroservice = this.taskMicroserviceClient.getService(
            TASK_MANAGER_SERVICE_NAME,
        );

        initCircuitBreaker(AST_ANALYZER_SERVICE_NAME, { logger: this.logger });
        initCircuitBreaker(TASK_MANAGER_SERVICE_NAME, { logger: this.logger });
    }

    async analyzeASTWithAI(
        context: AnalysisContext,
        reviewModeResponse: ReviewModeResponse,
    ): Promise<AIAnalysisResult> {
        try {
            const provider = LLMModelProvider.NOVITA_DEEPSEEK_V3_0324;
            const fallbackProvider = LLMModelProvider.OPENAI_GPT_4O;

            const payload = await this.prepareAnalysisContext(context);

            const analysis = await this.promptRunnerService
                .builder()
                .setProviders({
                    main: provider,
                    fallback: fallbackProvider,
                })
                .setParser(ParserType.STRING)
                .setLLMJsonMode(true)
                .setPayload(payload)
                .addPrompt({
                    role: PromptRole.USER,
                    prompt: prompt_detectBreakingChanges,
                })
                .addMetadata({
                    organizationId:
                        context?.organizationAndTeamData?.organizationId,
                    teamId: context?.organizationAndTeamData?.teamId,
                    pullRequestId: context?.pullRequest?.number,
                })
                .setTemperature(0)
                .setRunName('CodeASTAnalysisAI')
                .execute();

            if (!analysis) {
                const message = `No response from LLM for PR#${context.pullRequest.number}`;
                this.logger.warn({
                    message,
                    context: CodeAstAnalysisService.name,
                    metadata: {
                        organizationAndTeamData:
                            context.organizationAndTeamData,
                        prNumber: context.pullRequest.number,
                    },
                });
                throw new Error(message);
            }

            // Process result and tokens
            const analysisResult = this.llmResponseProcessor.processResponse(
                context.organizationAndTeamData,
                context.pullRequest.number,
                analysis,
            );

            analysisResult.codeReviewModelUsed = {
                generateSuggestions: provider,
            };

            return {
                ...analysisResult,
                codeSuggestions: analysisResult?.codeSuggestions?.map(
                    (codeSuggestion: CodeSuggestion) => ({
                        ...codeSuggestion,
                        severity: SeverityLevel.CRITICAL,
                        label: 'breaking_changes',
                    }),
                ),
            };
        } catch (error) {
            this.logger.error({
                message: `Error during AST code analysis for PR#${context.pullRequest.number}`,
                context: CodeAstAnalysisService.name,
                metadata: {
                    organizationAndTeamData: context?.organizationAndTeamData,
                    prNumber: context?.pullRequest?.number,
                },
                error,
            });
            throw error;
        }
    }

    async initializeASTAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
        filePaths: string[] = [],
    ): Promise<InitializeRepositoryResponse> {
        try {
            const { headRepo: headDirParams, baseRepo: baseDirParams } =
                await this.getRepoParams(
                    repository,
                    pullRequest,
                    organizationAndTeamData,
                    platformType,
                );

            const metadata = new Metadata();
            metadata.add('x-task-key', organizationAndTeamData.organizationId);

            const init = this.astMicroservice
                .initializeRepository(
                    {
                        baseRepo: baseDirParams,
                        headRepo: headDirParams,
                        filePaths,
                    },
                    metadata,
                )
                .pipe(
                    retry({
                        count: 3,
                        delay: 1000,
                        resetOnSuccess: true,
                    }),
                    circuitBreaker(AST_ANALYZER_SERVICE_NAME),
                );

            const task = await lastValueFrom(init);

            return task;
        } catch (error) {
            this.logger.error({
                message: `Error during AST Clone and Generate graph for PR#${pullRequest.number}`,
                context: CodeAstAnalysisService.name,
                metadata: {
                    organizationAndTeamData: organizationAndTeamData,
                    prNumber: pullRequest?.number,
                },
                error,
            });
            throw error;
        }
    }

    private static readonly AuthModeMap: Record<AuthMode, ProtoAuthMode> = {
        [AuthMode.OAUTH]: ProtoAuthMode.PROTO_AUTH_MODE_OAUTH,
        [AuthMode.TOKEN]: ProtoAuthMode.PROTO_AUTH_MODE_TOKEN,
    };

    private static readonly PlatformTypeMap: Partial<
        Record<PlatformType, ProtoPlatformType>
    > = {
        [PlatformType.GITHUB]: ProtoPlatformType.PROTO_PLATFORM_TYPE_GITHUB,
        [PlatformType.GITLAB]: ProtoPlatformType.PROTO_PLATFORM_TYPE_GITLAB,
        [PlatformType.BITBUCKET]:
            ProtoPlatformType.PROTO_PLATFORM_TYPE_BITBUCKET,
        [PlatformType.AZURE_REPOS]:
            ProtoPlatformType.PROTO_PLATFORM_TYPE_AZURE_REPOS,
    };

    private async getCloneParams(
        repository: Repository,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<RepositoryData> {
        const params = await this.codeManagementService.getCloneParams({
            repository,
            organizationAndTeamData,
        });
        return {
            ...params,
            auth: {
                ...params.auth,
                type: CodeAstAnalysisService.AuthModeMap[params.auth.type],
            },
            provider: CodeAstAnalysisService.PlatformTypeMap[params.provider],
        };
    }

    async initializeImpactAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
        codeChunk: string,
        fileName: string,
    ): Promise<InitializeImpactAnalysisResponse> {
        try {
            const { headRepo, baseRepo } = await this.getRepoParams(
                repository,
                pullRequest,
                organizationAndTeamData,
                platformType,
            );

            if (!headRepo) {
                throw new Error('Head repository parameters are missing');
            }

            const metadata = this.createMetadata(organizationAndTeamData);

            const init = this.astMicroservice
                .initializeImpactAnalysis(
                    {
                        baseRepo: baseRepo,
                        headRepo: headRepo,
                        codeChunk,
                        fileName,
                    },
                    metadata,
                )
                .pipe(
                    retry({
                        count: 3,
                        delay: 1000,
                        resetOnSuccess: true,
                    }),
                    circuitBreaker(AST_ANALYZER_SERVICE_NAME),
                );

            const task = await lastValueFrom(init);

            return task;
        } catch (error) {
            this.logger.error({
                message: `Error during AST Impact Analysis initialization for PR#${pullRequest.number}`,
                context: CodeAstAnalysisService.name,
                metadata: {
                    organizationAndTeamData: organizationAndTeamData,
                    prNumber: pullRequest?.number,
                },
                error,
            });
            throw error;
        }
    }

    async getImpactAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<GetImpactAnalysisResponse> {
        try {
            const { headRepo, baseRepo } = await this.getRepoParams(
                repository,
                pullRequest,
                organizationAndTeamData,
                platformType,
            );

            if (!headRepo) {
                throw new Error('Head repository parameters are missing');
            }

            return await this.collectImpactAnalysis(
                baseRepo,
                headRepo,
                pullRequest,
                organizationAndTeamData,
            );
        } catch (error) {
            this.logger.error({
                message: `Error during AST Impact Analysis for PR#${pullRequest.number}`,
                context: CodeAstAnalysisService.name,
                metadata: {
                    organizationAndTeamData: organizationAndTeamData,
                    prNumber: pullRequest?.number,
                },
                error,
            });
            throw error;
        }
    }

    private collectImpactAnalysis(
        baseDirParams: RepositoryData,
        headDirParams: RepositoryData,
        pullRequest: any,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<GetImpactAnalysisResponse> {
        return new Promise<GetImpactAnalysisResponse>((resolve, reject) => {
            const functionsAffect = [];
            const functionSimilarity = [];

            const metadata = this.createMetadata(organizationAndTeamData);

            this.astMicroservice
                .getImpactAnalysis(
                    {
                        baseRepo: baseDirParams,
                        headRepo: headDirParams,
                    },
                    metadata,
                )
                .pipe(
                    retry({
                        count: 3,
                        delay: 1000,
                        resetOnSuccess: true,
                    }),
                    circuitBreaker(AST_ANALYZER_SERVICE_NAME),
                )
                .subscribe({
                    next: (batch) => {
                        if (batch.functionsAffect) {
                            functionsAffect.push(...batch.functionsAffect);
                        }
                        if (batch.functionSimilarity) {
                            functionSimilarity.push(
                                ...batch.functionSimilarity,
                            );
                        }
                    },
                    error: reject,
                    complete: () => {
                        resolve({
                            functionsAffect,
                            functionSimilarity,
                        });
                    },
                });
        });
    }

    private async prepareAnalysisContext(context: AnalysisContext) {
        const baseContext = {
            language: context?.repository?.language,
            languageResultPrompt:
                context?.codeReviewConfig?.languageResultPrompt,
            impactASTAnalysis: context?.impactASTAnalysis?.functionsAffect
                ? Object.values(context?.impactASTAnalysis?.functionsAffect)
                : [],
        };

        return baseContext;
    }

    async getRelatedContentFromDiff(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
        diff: string,
        filePath: string,
    ): Promise<string> {
        const { headRepo, baseRepo } = await this.getRepoParams(
            repository,
            pullRequest,
            organizationAndTeamData,
            platformType,
        );

        const metadata = this.createMetadata(organizationAndTeamData);

        const call = this.astMicroservice
            .getContentFromDiff(
                {
                    baseRepo,
                    headRepo,
                    diff,
                    filePath,
                },
                metadata,
            )
            .pipe(
                retry({
                    count: 3,
                    delay: 1000,
                    resetOnSuccess: true,
                }),
                circuitBreaker(AST_ANALYZER_SERVICE_NAME),
                reduce((acc, chunk) => {
                    return {
                        ...acc,
                        data: concatUint8Arrays(acc.data, chunk.data),
                    };
                }),
                map((data) => {
                    const str = new TextDecoder().decode(data.data);
                    return str;
                }),
            );

        const relatedContent = await lastValueFrom(call);

        // format newlines
        return JSON.parse(relatedContent);
    }

    private async getRepoParams(
        repository: any,
        pullRequest: any,
        organizationAndTeamData: OrganizationAndTeamData,
        platformType: string,
    ): Promise<{
        headRepo: RepositoryData | null;
        baseRepo: RepositoryData | null;
    } | null> {
        const headDirParams = await this.getCloneParams(
            {
                id: repository.id,
                name: repository.name,
                defaultBranch: pullRequest.head.ref,
                fullName:
                    repository.full_name ||
                    `${repository.owner}/${repository.name}`,
                platform: platformType as
                    | 'github'
                    | 'gitlab'
                    | 'bitbucket'
                    | 'azure-devops',
                language: repository.language || 'unknown',
            },
            organizationAndTeamData,
        );

        if (!headDirParams) {
            return null;
        }

        const baseDirParams = await this.getCloneParams(
            {
                id: repository.id,
                name: repository.name,
                defaultBranch: pullRequest.base.ref,
                fullName:
                    repository.full_name ||
                    `${repository.owner}/${repository.name}`,
                platform: platformType as
                    | 'github'
                    | 'gitlab'
                    | 'bitbucket'
                    | 'azure-devops',
                language: repository.language || 'unknown',
            },
            organizationAndTeamData,
        );

        if (!baseDirParams) {
            return {
                headRepo: headDirParams,
                baseRepo: null,
            };
        }

        return {
            headRepo: headDirParams,
            baseRepo: baseDirParams,
        };
    }

    async awaitTask(
        taskId: string,
        organizationAndTeamData: OrganizationAndTeamData,
        options: {
            timeout?: number;
            interval?: number;
        } = {
            timeout: 60000, // Default timeout of 60 seconds
            interval: 5000, // Check every 5 seconds
        },
    ): Promise<GetTaskInfoResponse> {
        if (!taskId) {
            throw new Error('Task ID is required to await task completion');
        }

        const { timeout, interval } = options;

        const startTime = Date.now();

        const endStates = [
            TaskStatus.TASK_STATUS_COMPLETED,
            TaskStatus.TASK_STATUS_FAILED,
            TaskStatus.TASK_STATUS_CANCELLED,
        ];

        const metadata = this.createMetadata(organizationAndTeamData);

        while (true) {
            if (Date.now() - startTime > timeout) {
                throw new Error(`Task ${taskId} timed out after ${timeout}ms`);
            }

            try {
                this.logger.log({
                    message: `Polling task ${taskId} status`,
                    context: CodeAstAnalysisService.name,
                    metadata: { taskId },
                });

                const taskStatus = await lastValueFrom(
                    this.taskMicroservice
                        .getTaskInfo({ taskId }, metadata)
                        .pipe(
                            retry({
                                count: 3,
                                delay: 1000,
                                resetOnSuccess: true,
                            }),
                            circuitBreaker(TASK_MANAGER_SERVICE_NAME),
                        ),
                );

                if (!taskStatus || !taskStatus.task) {
                    throw new Error(`Task ${taskId} not found`);
                }

                if (endStates.includes(taskStatus.task.status)) {
                    return taskStatus;
                }
            } catch (error) {
                if (error instanceof CircuitBreakerOpenError) {
                    this.logger.error({
                        message: `Circuit breaker is open for task ${taskId}`,
                        context: CodeAstAnalysisService.name,
                        metadata: { taskId },
                    });
                    throw error;
                }

                this.logger.error({
                    message: `Full error inspection for task ${taskId}`,
                    context: CodeAstAnalysisService.name,
                    error,
                    metadata: {
                        taskId,
                        errorType: typeof error,
                        errorConstructor: error?.constructor?.name,
                        errorProto:
                            Object.getPrototypeOf(error)?.constructor?.name,
                        errorKeys: error ? Object.keys(error) : null,
                        errorCode: error?.code,
                        errorCodeType: typeof error?.code,
                        statusNotFoundValue: Status.NOT_FOUND,
                        statusNotFoundType: typeof Status.NOT_FOUND,
                        fullErrorString: String(error),
                        fullErrorJSON: JSON.stringify(error),
                    },
                });

                if (error?.code === Status.NOT_FOUND) {
                    this.logger.warn({
                        message: `Task ${taskId} not found`,
                        context: CodeAstAnalysisService.name,
                        error,
                        metadata: { taskId },
                    });

                    return null;
                }

                this.logger.warn({
                    message: `A transient error occurred while polling for task ${taskId}. Retrying...`,
                    error,
                    context: CodeAstAnalysisService.name,
                    metadata: { taskId },
                });
            }

            await new Promise((resolve) => setTimeout(resolve, interval));
        }
    }

    async deleteASTAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<void> {
        try {
            const { headRepo, baseRepo } = await this.getRepoParams(
                repository,
                pullRequest,
                organizationAndTeamData,
                platformType,
            );

            if (!headRepo) {
                throw new Error('Head repository parameters are missing');
            }

            const metadata = this.createMetadata(organizationAndTeamData);

            await lastValueFrom(
                this.astMicroservice
                    .deleteRepository(
                        {
                            baseRepo: baseRepo,
                            headRepo: headRepo,
                        },
                        metadata,
                    )
                    .pipe(
                        retry({
                            count: 3,
                            delay: 1000,
                            resetOnSuccess: true,
                        }),
                        circuitBreaker(AST_ANALYZER_SERVICE_NAME),
                    ),
            );
        } catch (error) {
            this.logger.error({
                message: `Error during AST analysis deletion for PR#${pullRequest.number}`,
                context: CodeAstAnalysisService.name,
                metadata: {
                    organizationAndTeamData: organizationAndTeamData,
                    prNumber: pullRequest?.number,
                },
                error,
            });
            throw error;
        }
    }

    private createMetadata(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Metadata {
        const metadata = new Metadata();
        metadata.add('x-task-key', organizationAndTeamData.organizationId);
        return metadata;
    }
}

export function logOutgoingMeta(taskId: string) {
    return function <Req, Res>(options: any, nextCall: any) {
        return new nextCall(options, (err: any, resp: Res) => {
            /* noop - just proxy */
        }).start((metadata) => {
            console.log('META ENVIADA:', metadata.get('x-task-key'));
            return metadata;
        });
    };
}
