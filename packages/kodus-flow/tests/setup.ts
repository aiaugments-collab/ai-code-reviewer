/**
 * @fileoverview Setup global para testes
 *
 * Carrega variáveis de ambiente e configurações globais
 * para todos os testes do Kodus Flow
 */

import 'dotenv/config';
import { config } from 'dotenv';

// Carregar .env se existir
config();

// Configurar variáveis de ambiente padrão para testes
if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.warn(
        '⚠️  GEMINI_API_KEY ou GOOGLE_API_KEY não encontradas. Alguns testes podem falhar.',
    );
    console.warn('💡 Crie um arquivo .env baseado em env.example');
}

// Configurar NODE_ENV para testes
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Configurar logging para testes
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

// Configurar telemetry para testes
process.env.TELEMETRY_ENABLED = process.env.TELEMETRY_ENABLED || 'false';

console.log('🧪 Test environment configured:', {
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    TELEMETRY_ENABLED: process.env.TELEMETRY_ENABLED,
    HAS_GEMINI_KEY: !!process.env.GEMINI_API_KEY,
    HAS_GOOGLE_KEY: !!process.env.GOOGLE_API_KEY,
});
