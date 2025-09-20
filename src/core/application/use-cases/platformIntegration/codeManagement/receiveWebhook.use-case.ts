import { Inject, Injectable } from '@nestjs/common';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';

import {
    IWebhookEventHandler,
    IWebhookEventParams,
} from '@/core/domain/platformIntegrations/interfaces/webhook-event-handler.interface';

@Injectable()
export class ReceiveWebhookUseCase implements IUseCase {
    private readonly webhookHandlersMap: Map<
        PlatformType,
        IWebhookEventHandler
    >;

    constructor(
        @Inject('GITHUB_WEBHOOK_HANDLER')
        private readonly githubPullRequestHandler: IWebhookEventHandler,

        @Inject('GITLAB_WEBHOOK_HANDLER')
        private readonly gitlabMergeRequestHandler: IWebhookEventHandler,

        @Inject('BITBUCKET_WEBHOOK_HANDLER')
        private readonly bitbucketPullRequestHandler: IWebhookEventHandler,

        @Inject('AZURE_REPOS_WEBHOOK_HANDLER')
        private readonly azureReposPullRequestHandler: IWebhookEventHandler,

        private readonly logger: PinoLoggerService,
    ) {
        // Inicializar o mapa de handlers por tipo de plataforma
        this.webhookHandlersMap = new Map<PlatformType, IWebhookEventHandler>([
            [PlatformType.GITHUB, githubPullRequestHandler],
            [PlatformType.GITLAB, gitlabMergeRequestHandler],
            [PlatformType.BITBUCKET, bitbucketPullRequestHandler],
            [PlatformType.AZURE_REPOS, azureReposPullRequestHandler],
        ]);
    }

    public async execute(params: IWebhookEventParams): Promise<void> {
        try {
            const handler = this.webhookHandlersMap.get(params.platformType);

            if (handler && handler.canHandle(params)) {
                this.logger.debug({
                    message: `Processing ${params.event} with handler ${handler.constructor.name}`,
                    serviceName: ReceiveWebhookUseCase.name,
                    metadata: {
                        eventName: params.event,
                        platformType: params.platformType,
                    },
                    context: ReceiveWebhookUseCase.name,
                });

                handler.execute(params);
            } else {
                this.logger.debug({
                    message: `No handler found for event ${params.event}`,
                    serviceName: ReceiveWebhookUseCase.name,
                    metadata: {
                        eventName: params.event,
                        platformType: params.platformType,
                    },
                    context: ReceiveWebhookUseCase.name,
                });
            }
        } catch (error) {
            this.logger.error({
                message: 'Error processing webhook',
                context: ReceiveWebhookUseCase.name,
                error: error,
                metadata: {
                    eventName: params.event,
                    platformType: params.platformType,
                },
            });
        }
    }
}
