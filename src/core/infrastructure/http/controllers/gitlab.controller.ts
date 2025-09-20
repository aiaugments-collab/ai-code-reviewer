import { Controller, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { PinoLoggerService } from '../../adapters/services/logger/pino.service';
import { Response } from 'express';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { ReceiveWebhookUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/receiveWebhook.use-case';
import {
    WEBHOOK_LOG_SERVICE,
    IWebhookLogService,
} from '@/core/domain/webhookLog/contracts/webhook-log.service.contract';

@Controller('gitlab')
export class GitlabController {
    constructor(
        private logger: PinoLoggerService,
        private readonly receiveWebhookUseCase: ReceiveWebhookUseCase,
        @Inject(WEBHOOK_LOG_SERVICE)
        private readonly webhookLogService: IWebhookLogService,
    ) {}

    @Post('/webhook')
    handleWebhook(@Req() req: Request, @Res() res: Response) {
        const event = req.headers['x-gitlab-event'] as string;
        const payload = req.body as any;

        res.status(HttpStatus.OK).send('Webhook received');

        setImmediate(() => {
            this.logger.log({
                message: `Webhook received, ${event}`,
                context: GitlabController.name,
                metadata: {
                    event,
                    installationId: payload?.installation?.id,
                    repository: payload?.repository?.name,
                },
            });

            this.webhookLogService.log(PlatformType.GITLAB, event, payload);

            this.receiveWebhookUseCase.execute({
                payload,
                event,
                platformType: PlatformType.GITLAB,
            });
        });
    }
}
