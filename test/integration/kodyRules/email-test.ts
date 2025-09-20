import { sendKodyRulesNotification } from '@/shared/utils/email/sendMail';

// Teste simples para envio real de email
export async function testEmailSend() {
    // Verificar se as variáveis de ambiente estão configuradas
    if (!process.env.API_MAILSEND_API_TOKEN) {
        console.log(
            '❌ Configure API_MAILSEND_API_TOKEN nas variáveis de ambiente',
        );
        return;
    }

    console.log('📧 Enviando email de teste...');

    const users = [
        {
            email: 'gabrielmalinosqui@gmail.com',
            name: 'Gabriel Malinosqui',
        },
    ];

    const testRules = [
        'Todos os métodos públicos devem ter testes unitários',
        'Endpoints devem ter documentação Swagger',
        'Usar try-catch em operações async',
    ];

    try {
        const results = await sendKodyRulesNotification(
            users,
            testRules,
            'Kodus Test Organization',
        );

        console.log('✅ Email enviado com sucesso!');
        console.log('📊 Resultado:', results);
        console.log(
            '📧 Verifique a caixa de entrada de gabrielmalinosqui@gmail.com',
        );

        return results;
    } catch (error) {
        console.error('❌ Erro ao enviar email:', error);
        throw error;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    testEmailSend()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}
