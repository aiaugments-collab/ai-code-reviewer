import { Controller, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { PinoLoggerService } from '../../adapters/services/logger/pino.service';
import { ReceiveWebhookUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/receiveWebhook.use-case';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import {
    WEBHOOK_LOG_SERVICE,
    IWebhookLogService,
} from '@/core/domain/webhookLog/contracts/webhook-log.service.contract';

@Controller('bitbucket')
export class BitbucketController {
    constructor(
        private readonly receiveWebhookUseCase: ReceiveWebhookUseCase,
        private readonly logger: PinoLoggerService,
        @Inject(WEBHOOK_LOG_SERVICE)
        private readonly webhookLogService: IWebhookLogService,
    ) {}

    @Post('/webhook')
    handleWebhook(@Req() req: Request, @Res() res: Response) {
        const event = req.headers['x-event-key'] as string;
        const payload = req.body as any;

        res.status(HttpStatus.OK).send('Webhook received');

        setImmediate(() => {
            this.logger.log({
                message: `Webhook received, ${event}`,
                context: BitbucketController.name,
                metadata: {
                    event,
                    installationId: payload?.installation?.id,
                    repository: payload?.repository?.name,
                },
            });

            this.webhookLogService.log(PlatformType.BITBUCKET, event, payload);

            this.receiveWebhookUseCase.execute({
                payload,
                event,
                platformType: PlatformType.BITBUCKET,
            });
        });
    }
}
