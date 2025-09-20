import { Test, TestingModule } from '@nestjs/testing';
import { SendRulesNotificationUseCase } from '@/core/application/use-cases/kodyRules/send-rules-notification.use-case';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { sendKodyRulesNotification } from '@/shared/utils/email/sendMail';
import {
    IUsersService,
    USER_SERVICE_TOKEN,
} from '@/core/domain/user/contracts/user.service.contract';
import {
    IOrganizationService,
    ORGANIZATION_SERVICE_TOKEN,
} from '@/core/domain/organization/contracts/organization.service.contract';
import { STATUS } from '@/config/types/database/status.type';
import { Role } from '@/core/domain/permissions/enums/permissions.enum';
import { v4 as uuidv4 } from 'uuid';

describe('SendKodyRulesNotification - Integration Test', () => {
    let useCase: SendRulesNotificationUseCase;
    let logger: PinoLoggerService;

    const mockOrganizationId = uuidv4();

    // Dados reais para teste
    const testUser = {
        uuid: uuidv4(),
        email: 'gabrielmalinosqui@gmail.com',
        status: STATUS.ACTIVE,
        teamMember: [
            {
                name: 'Gabriel Malinosqui',
                team: {
                    name: 'Kodus Test Team',
                },
            },
        ],
    };

    const testOrganization = {
        uuid: mockOrganizationId,
        name: 'Kodus Test Organization',
    };

    const testRules = [
        'Todos os métodos públicos devem ter testes unitários',
        'Endpoints devem ter documentação Swagger',
        'Usar try-catch em operações async',
    ];

    beforeEach(async () => {
        // Mock dos serviços mas permitindo execução real do email
        const mockUsersService = {
            find: jest.fn().mockResolvedValue([testUser]),
        };

        const mockOrganizationService = {
            findOne: jest.fn().mockResolvedValue(testOrganization),
        };

        const mockLogger = {
            log: jest.fn(),
            error: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SendRulesNotificationUseCase,
                {
                    provide: USER_SERVICE_TOKEN,
                    useValue: mockUsersService,
                },
                {
                    provide: ORGANIZATION_SERVICE_TOKEN,
                    useValue: mockOrganizationService,
                },
                {
                    provide: PinoLoggerService,
                    useValue: mockLogger,
                },
            ],
        }).compile();

        useCase = module.get<SendRulesNotificationUseCase>(
            SendRulesNotificationUseCase,
        );
        logger = module.get<PinoLoggerService>(PinoLoggerService);
    });

    it('deve enviar email real para gabrielmalinosqui@gmail.com', async () => {
        // Verificar se as variáveis de ambiente estão configuradas
        if (!process.env.API_MAILSEND_API_TOKEN) {
            console.warn(
                '⚠️  API_MAILSEND_API_TOKEN não configurado. Pulando teste de integração.',
            );
            return;
        }

        console.log('📧 Enviando email de teste para:', testUser.email);
        console.log('🏢 Organização:', testOrganization.name);
        console.log('📋 Regras a serem enviadas:', testRules.length);

        // Act - Executar o caso de uso real
        await expect(
            useCase.execute(mockOrganizationId, testRules),
        ).resolves.not.toThrow();

        // Assert - Verificar logs
        expect(logger.log).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Starting Kody Rules notification process',
                context: 'SendRulesNotificationUseCase',
            }),
        );

        expect(logger.log).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Sending email notifications',
                context: 'SendRulesNotificationUseCase',
            }),
        );

        expect(logger.log).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Email notifications completed',
                context: 'SendRulesNotificationUseCase',
            }),
        );

        console.log(
            '✅ Email enviado com sucesso! Verifique a caixa de entrada de gabrielmalinosqui@gmail.com',
        );
    }, 30000); // 30 seconds timeout para envio de email

    it('deve testar função sendKodyRulesNotification diretamente', async () => {
        // Verificar se as variáveis de ambiente estão configuradas
        if (!process.env.API_MAILSEND_API_TOKEN) {
            console.warn(
                '⚠️  API_MAILSEND_API_TOKEN não configurado. Pulando teste de integração.',
            );
            return;
        }

        const users = [
            {
                email: 'gabrielmalinosqui@gmail.com',
                name: 'Gabriel Malinosqui',
            },
        ];

        console.log(
            '📧 Testando função sendKodyRulesNotification diretamente...',
        );

        // Act - Testar a função diretamente
        const results = await sendKodyRulesNotification(
            users,
            testRules,
            testOrganization.name,
            logger,
        );

        // Assert
        expect(results).toBeDefined();
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(1);

        const result = results[0];
        expect(result.status).toBe('fulfilled');

        console.log(
            '✅ Função sendKodyRulesNotification executada com sucesso!',
        );
        console.log('📊 Resultado:', result);
    }, 30000);
});

// Teste para execução manual rápida
describe('Quick Email Test', () => {
    it.skip('enviar email de teste manual', async () => {
        // Descomente este teste e execute apenas ele para teste rápido
        // npm test -- --testNamePattern="enviar email de teste manual"

        if (!process.env.API_MAILSEND_API_TOKEN) {
            console.log(
                '❌ Configure API_MAILSEND_API_TOKEN nas variáveis de ambiente',
            );
            return;
        }

        const result = await sendKodyRulesNotification(
            [
                {
                    email: 'gabrielmalinosqui@gmail.com',
                    name: 'Gabriel Malinosqui',
                },
            ],
            ['Teste Manual', 'Esta é uma regra de teste enviada manualmente'],
            'Kodus Test Organization',
        );

        console.log('📧 Email de teste enviado:', result);
    });
});
