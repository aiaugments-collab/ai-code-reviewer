import { GetOrganizationNameUseCase } from '@/core/application/use-cases/github/GetOrganizationName';
import { CreateOrUpdateOrganizationNameUseCase } from '@/core/application/use-cases/github/createOrUpdateOrganizationName';
import { GetIntegrationGithubUseCase } from '@/core/application/use-cases/github/get-integration-github';
import {
    Body,
    Controller,
    Get,
    HttpStatus,
    Inject,
    Post,
    Query,
    Req,
    Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PinoLoggerService } from '../../adapters/services/logger/pino.service';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { ReceiveWebhookUseCase } from '@/core/application/use-cases/platformIntegration/codeManagement/receiveWebhook.use-case';
import * as jwt from 'jsonwebtoken';
import {
    IWebhookLogService,
    WEBHOOK_LOG_SERVICE,
} from '@/core/domain/webhookLog/contracts/webhook-log.service.contract';

@Controller('github')
export class GithubController {
    constructor(
        private readonly createOrUpdateOrganizationNameUseCase: CreateOrUpdateOrganizationNameUseCase,
        private readonly getOrganizationNameUseCase: GetOrganizationNameUseCase,
        private readonly getIntegrationGithubUseCase: GetIntegrationGithubUseCase,
        private readonly receiveWebhookUseCase: ReceiveWebhookUseCase,

        @Inject(WEBHOOK_LOG_SERVICE)
        private readonly webhookLogService: IWebhookLogService,

        private logger: PinoLoggerService,
    ) {}

    @Get('/organization-name')
    public async getOrganizationName() {
        return this.getOrganizationNameUseCase.execute();
    }

    @Post('/webhook')
    handleWebhook(@Req() req: Request, @Res() res: Response) {
        const event = req.headers['x-github-event'] as string;
        const payload = req.body as any;

        if (event === 'pull_request') {
            if (
                payload?.action !== 'opened' &&
                payload?.action !== 'synchronize' &&
                payload?.action !== 'closed' &&
                payload?.action !== 'reopened' &&
                payload?.action !== 'ready_for_review'
            ) {
                return res.status(HttpStatus.OK).send('Webhook received');
            }
        }

        res.status(HttpStatus.OK).send('Webhook received');

        setImmediate(() => {
            this.logger.log({
                message: `Webhook received, ${event}`,
                context: GithubController.name,
                metadata: {
                    event,
                    installationId: payload?.installation?.id,
                    repository: payload?.repository?.name,
                },
            });

            this.webhookLogService.log(PlatformType.GITHUB, event, payload);

            this.receiveWebhookUseCase.execute({
                payload,
                event,
                platformType: PlatformType.GITHUB,
            });
        });
    }

    @Get('/integration')
    public async getIntegration(@Query('installId') installId: string) {
        return this.getIntegrationGithubUseCase.execute(installId);
    }

    @Post('/organization-name')
    public async createOrUpdateOrganizationName(
        @Body() body: { organizationName: string },
    ) {
        return this.createOrUpdateOrganizationNameUseCase.execute(
            body.organizationName,
        );
    }

    @Get('token')
    getToken(): { token: string } {
        // Retrieve environment variables
        const appId = process.env.API_GITHUB_APP_ID;
        let privateKey = process.env.API_GITHUB_PRIVATE_KEY;

        if (!appId) {
            throw new Error('API_GITHUB_APP_ID is not defined');
        }

        if (!privateKey) {
            throw new Error('GITHUB_APP_PRIVATE_KEY is not defined');
        }

        // If the key has escaped line breaks, convert them to actual line breaks
        privateKey = privateKey.replace(/\\n/g, '\n');

        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iat: now,
            exp: now + 10 * 60, // Expires in 10 minutes
            iss: appId,
        };

        // Generate the token using RS256
        const token = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

        return { token };
    }
}
