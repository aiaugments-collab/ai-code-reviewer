import { Controller, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { Response, Request } from 'express';
import { PinoLoggerService } from '../../adapters/services/logger/pino.service';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { ReceiveWebhookUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/receiveWebhook.use-case';
import { validateWebhookToken } from '@/shared/utils/webhooks/webhookTokenCrypto';
import {
    WEBHOOK_LOG_SERVICE,
    IWebhookLogService,
} from '@/core/domain/webhookLog/contracts/webhook-log.service.contract';

@Controller('azure-repos')
export class AzureReposController {
    constructor(
        private readonly receiveWebhookUseCase: ReceiveWebhookUseCase,
        private logger: PinoLoggerService,
        @Inject(WEBHOOK_LOG_SERVICE)
        private readonly webhookLogService: IWebhookLogService,
    ) {}

    @Post('/webhook')
    async handleWebhook(@Req() req: Request, @Res() res: Response) {
        try {
            const encrypted = req.query.token as string;

            if (!validateWebhookToken(encrypted)) {
                this.logger.error({
                    message: 'Webhook Azure DevOps Not Token Valid',
                    context: AzureReposController.name,
                });
                return res.status(403).send('Unauthorized');
            }

            const payload = req.body as any;
            const eventType = payload?.eventType as string;

            if (!eventType) {
                this.logger.log({
                    message: 'Webhook Azure DevOps recebido sem eventType',
                    context: AzureReposController.name,
                    metadata: { payload },
                });
                return res
                    .status(HttpStatus.BAD_REQUEST)
                    .send('Evento não reconhecido');
            }

            res.status(HttpStatus.OK).send('Webhook received');

            setImmediate(() => {
                this.logger.log({
                    message: `Webhook received, ${eventType}`,
                    context: AzureReposController.name,
                    metadata: {
                        event: eventType,
                        repositoryName: payload?.resource?.repository?.name,
                        pullRequestId: payload?.resource?.pullRequestId,
                        projectId: payload?.resourceContainers?.project?.id,
                    },
                });

                this.webhookLogService.log(
                    PlatformType.AZURE_REPOS,
                    eventType,
                    payload,
                );

                this.receiveWebhookUseCase.execute({
                    payload,
                    event: eventType,
                    platformType: PlatformType.AZURE_REPOS,
                });
            });
        } catch (error) {
            this.logger.error({
                message: 'Error processing webhook',
                context: AzureReposController.name,
                error: error,
            });
        }
    }
}
