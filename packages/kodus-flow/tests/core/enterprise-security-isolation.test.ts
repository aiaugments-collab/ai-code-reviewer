// /**
//  * @file enterprise-security-isolation.test.ts
//  * @description Testes enterprise-grade para segurança, isolamento de dados e proteção contra vazamentos
//  * Garantir que dados de um tenant NUNCA vazem para outro tenant
//  */

// import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// import { SessionService } from '../../src/core/context/services/session-service.js';
// import { ContextStateService } from '../../src/core/context/services/state-service.js';
// import { createLogger } from '../../src/observability/index.js';

// describe('Enterprise Security & Isolation Tests', () => {
//     let sessionService: SessionService;
//     let logger: ReturnType<typeof createLogger>;

//     beforeEach(() => {
//         sessionService = new SessionService({
//             maxSessions: 5000,
//             sessionTimeout: 300000,
//             enableAutoCleanup: true,
//             cleanupInterval: 60000,
//         });

//         logger = createLogger('enterprise-security-test');
//     });

//     afterEach(async () => {
//         sessionService.cleanupExpiredSessions();
//         await new Promise((resolve) => setTimeout(resolve, 100));
//     });

//     describe('Data Isolation & Security', () => {
//         it('should prevent cross-tenant data access at session level', async () => {
//             const tenant1 = 'bank-1';
//             const tenant2 = 'bank-2';

//             // Dados sensíveis do banco 1
//             const session1 = sessionService.createSession(tenant1, 'user-123', {
//                 agentName: 'financial-agent',
//                 securityLevel: 'high',
//             });

//             // Dados sensíveis do banco 2
//             const session2 = sessionService.createSession(tenant2, 'user-456', {
//                 agentName: 'financial-agent',
//                 securityLevel: 'high',
//             });

//             const context1 = sessionService.getSessionContext(session1.id);
//             const context2 = sessionService.getSessionContext(session2.id);

//             if (context1 && context2) {
//                 // Dados financeiros críticos
//                 await context1.stateManager.set('financial', 'account', {
//                     accountNumber: '1234567890',
//                     balance: 1000000,
//                     transactions: [
//                         { id: 'tx1', amount: 50000, type: 'deposit' },
//                         { id: 'tx2', amount: 25000, type: 'withdrawal' },
//                     ],
//                     securityLevel: 'confidential',
//                 });

//                 await context2.stateManager.set('financial', 'account', {
//                     accountNumber: '0987654321',
//                     balance: 2500000,
//                     transactions: [
//                         { id: 'tx3', amount: 100000, type: 'deposit' },
//                         { id: 'tx4', amount: 75000, type: 'transfer' },
//                     ],
//                     securityLevel: 'confidential',
//                 });

//                 // Verificar isolamento absoluto
//                 const data1 = await context1.stateManager.get(
//                     'financial',
//                     'account',
//                 );
//                 const data2 = await context2.stateManager.get(
//                     'financial',
//                     'account',
//                 );

//                 expect(data1?.accountNumber).toBe('1234567890');
//                 expect(data1?.balance).toBe(1000000);
//                 expect(data2?.accountNumber).toBe('0987654321');
//                 expect(data2?.balance).toBe(2500000);

//                 // Verificar que dados NÃO são intercambiáveis
//                 expect(data1?.accountNumber).not.toBe(data2?.accountNumber);
//                 expect(data1?.balance).not.toBe(data2?.balance);
//                 expect(data1?.transactions).not.toEqual(data2?.transactions);
//             }
//         });

//         it('should prevent session hijacking between tenants', async () => {
//             const tenants = ['hospital-1', 'hospital-2', 'hospital-3'];
//             const sessions = new Map<string, any>();

//             // Criar sessões com dados médicos sensíveis
//             for (const tenant of tenants) {
//                 const session = sessionService.createSession(
//                     tenant,
//                     `patient-${tenant}`,
//                     {
//                         agentName: 'medical-agent',
//                         dataType: 'PHI', // Protected Health Information
//                     },
//                 );

//                 const context = sessionService.getSessionContext(session.id);
//                 if (context) {
//                     await context.stateManager.set('medical', 'patient', {
//                         patientId: `patient-${tenant}`,
//                         diagnosis: `diagnosis-${tenant}`,
//                         medications: [`med-${tenant}-1`, `med-${tenant}-2`],
//                         insurance: `insurance-${tenant}`,
//                         securityLevel: 'HIPAA',
//                     });
//                 }

//                 sessions.set(tenant, session);
//             }

//             // Tentar acessar dados de outros tenants (deve falhar)
//             for (const [tenant, session] of sessions) {
//                 const context = sessionService.getSessionContext(session.id);
//                 if (context) {
//                     const patientData = await context.stateManager.get(
//                         'medical',
//                         'patient',
//                     );

//                     // Verificar que só acessa dados do próprio tenant
//                     expect(patientData?.patientId).toBe(`patient-${tenant}`);
//                     expect(patientData?.diagnosis).toBe(`diagnosis-${tenant}`);

//                     // Verificar que NÃO consegue acessar dados de outros tenants
//                     for (const otherTenant of tenants) {
//                         if (otherTenant !== tenant) {
//                             const otherSession = sessions.get(otherTenant);
//                             const otherContext =
//                                 sessionService.getSessionContext(
//                                     otherSession?.id,
//                                 );

//                             if (otherContext) {
//                                 const otherPatientData =
//                                     await otherContext.stateManager.get(
//                                         'medical',
//                                         'patient',
//                                     );
//                                 expect(otherPatientData?.patientId).toBe(
//                                     `patient-${otherTenant}`,
//                                 );
//                                 expect(otherPatientData?.patientId).not.toBe(
//                                     `patient-${tenant}`,
//                                 );
//                             }
//                         }
//                     }
//                 }
//             }
//         });

//         it('should handle sensitive data encryption scenarios', async () => {
//             const tenant1 = 'government-1';
//             const tenant2 = 'government-2';

//             const session1 = sessionService.createSession(
//                 tenant1,
//                 'agent-001',
//                 {
//                     agentName: 'security-agent',
//                     clearanceLevel: 'top-secret',
//                 },
//             );

//             const session2 = sessionService.createSession(
//                 tenant2,
//                 'agent-002',
//                 {
//                     agentName: 'security-agent',
//                     clearanceLevel: 'top-secret',
//                 },
//             );

//             const context1 = sessionService.getSessionContext(session1.id);
//             const context2 = sessionService.getSessionContext(session2.id);

//             if (context1 && context2) {
//                 // Dados classificados
//                 await context1.stateManager.set('classified', 'mission', {
//                     missionId: 'MISSION-ALPHA',
//                     coordinates: { lat: 40.7128, lng: -74.006 },
//                     agents: ['agent-001', 'agent-003'],
//                     clearanceLevel: 'top-secret',
//                     encryptionKey: 'key-alpha-123',
//                 });

//                 await context2.stateManager.set('classified', 'mission', {
//                     missionId: 'MISSION-BETA',
//                     coordinates: { lat: 34.0522, lng: -118.2437 },
//                     agents: ['agent-002', 'agent-004'],
//                     clearanceLevel: 'top-secret',
//                     encryptionKey: 'key-beta-456',
//                 });

//                 // Verificar isolamento de dados classificados
//                 const mission1 = await context1.stateManager.get(
//                     'classified',
//                     'mission',
//                 );
//                 const mission2 = await context2.stateManager.get(
//                     'classified',
//                     'mission',
//                 );

//                 expect(mission1?.missionId).toBe('MISSION-ALPHA');
//                 expect(mission1?.encryptionKey).toBe('key-alpha-123');
//                 expect(mission2?.missionId).toBe('MISSION-BETA');
//                 expect(mission2?.encryptionKey).toBe('key-beta-456');

//                 // Verificar que chaves de criptografia são diferentes
//                 expect(mission1?.encryptionKey).not.toBe(
//                     mission2?.encryptionKey,
//                 );
//             }
//         });
//     });

//     describe('Concurrent Security Tests', () => {
//         it('should maintain isolation under concurrent access', async () => {
//             const tenants = [
//                 'company-1',
//                 'company-2',
//                 'company-3',
//                 'company-4',
//                 'company-5',
//             ];
//             const sessions = new Map<string, any>();

//             // Criar sessões para todos os tenants
//             for (const tenant of tenants) {
//                 const session = sessionService.createSession(
//                     tenant,
//                     `user-${tenant}`,
//                     {
//                         agentName: 'business-agent',
//                     },
//                 );
//                 sessions.set(tenant, session);
//             }

//             // Acesso concorrente intensivo
//             const concurrentOperations = 1000;
//             const promises = [];

//             for (let i = 0; i < concurrentOperations; i++) {
//                 const tenantIndex = i % tenants.length;
//                 const tenant = tenants[tenantIndex];
//                 const session = sessions.get(tenant);
//                 const context = sessionService.getSessionContext(session?.id);

//                 if (context) {
//                     promises.push(
//                         (async () => {
//                             // Operação de escrita
//                             await context.stateManager.set(
//                                 'concurrent',
//                                 `key-${i}`,
//                                 {
//                                     tenantId: tenant,
//                                     operationId: i,
//                                     timestamp: Date.now(),
//                                     data: `data-${tenant}-${i}`,
//                                 },
//                             );

//                             // Operação de leitura
//                             const data = await context.stateManager.get(
//                                 'concurrent',
//                                 `key-${i}`,
//                             );

//                             // Verificar que dados pertencem ao tenant correto
//                             expect(data?.tenantId).toBe(tenant);
//                             expect(data?.operationId).toBe(i);
//                             expect(data?.data).toBe(`data-${tenant}-${i}`);

//                             return data;
//                         })(),
//                     );
//                 }
//             }

//             await Promise.all(promises);

//             // Verificar isolamento após operações concorrentes
//             for (const [tenant, session] of sessions) {
//                 const context = sessionService.getSessionContext(session.id);
//                 if (context) {
//                     // Verificar que só consegue acessar dados do próprio tenant
//                     for (let i = 0; i < 10; i++) {
//                         const data = await context.stateManager.get(
//                             'concurrent',
//                             `key-${i}`,
//                         );
//                         if (data) {
//                             expect(data.tenantId).toBe(tenant);
//                         }
//                     }
//                 }
//             }
//         });

//         it('should prevent data race conditions between tenants', async () => {
//             const tenant1 = 'trading-1';
//             const tenant2 = 'trading-2';

//             const session1 = sessionService.createSession(
//                 tenant1,
//                 'trader-1',
//                 {},
//             );
//             const session2 = sessionService.createSession(
//                 tenant2,
//                 'trader-2',
//                 {},
//             );

//             const context1 = sessionService.getSessionContext(session1.id);
//             const context2 = sessionService.getSessionContext(session2.id);

//             if (context1 && context2) {
//                 // Simular operações de trading concorrentes
//                 const operations = 500;
//                 const promises1 = [];
//                 const promises2 = [];

//                 for (let i = 0; i < operations; i++) {
//                     // Operações do trader 1
//                     promises1.push(
//                         context1.stateManager.set('trading', `position-${i}`, {
//                             traderId: 'trader-1',
//                             symbol: 'AAPL',
//                             quantity: 100 + i,
//                             price: 150.0 + i * 0.01,
//                             timestamp: Date.now(),
//                         }),
//                     );

//                     // Operações do trader 2
//                     promises2.push(
//                         context2.stateManager.set('trading', `position-${i}`, {
//                             traderId: 'trader-2',
//                             symbol: 'GOOGL',
//                             quantity: 50 + i,
//                             price: 2800.0 + i * 0.1,
//                             timestamp: Date.now(),
//                         }),
//                     );
//                 }

//                 // Executar operações concorrentemente
//                 await Promise.all([...promises1, ...promises2]);

//                 // Verificar que não houve cross-contamination
//                 for (let i = 0; i < 10; i++) {
//                     const pos1 = await context1.stateManager.get(
//                         'trading',
//                         `position-${i}`,
//                     );
//                     const pos2 = await context2.stateManager.get(
//                         'trading',
//                         `position-${i}`,
//                     );

//                     expect(pos1?.traderId).toBe('trader-1');
//                     expect(pos1?.symbol).toBe('AAPL');
//                     expect(pos2?.traderId).toBe('trader-2');
//                     expect(pos2?.symbol).toBe('GOOGL');

//                     // Verificar que dados são completamente diferentes
//                     expect(pos1?.traderId).not.toBe(pos2?.traderId);
//                     expect(pos1?.symbol).not.toBe(pos2?.symbol);
//                 }
//             }
//         });
//     });

//     describe('Data Integrity & Validation', () => {
//         it('should maintain data integrity across session boundaries', async () => {
//             const tenant = 'audit-company';
//             const sessions = [];

//             // Criar múltiplas sessões para o mesmo tenant
//             for (let i = 0; i < 10; i++) {
//                 const session = sessionService.createSession(
//                     tenant,
//                     `audit-${i}`,
//                     {
//                         agentName: 'audit-agent',
//                     },
//                 );
//                 sessions.push(session);
//             }

//             // Adicionar dados de auditoria em cada sessão
//             for (let i = 0; i < sessions.length; i++) {
//                 const session = sessions[i];
//                 const context = sessionService.getSessionContext(session.id);

//                 if (context) {
//                     await context.stateManager.set('audit', 'records', {
//                         sessionId: session.id,
//                         auditId: `AUDIT-${i}`,
//                         records: [
//                             {
//                                 id: `record-${i}-1`,
//                                 action: 'login',
//                                 timestamp: Date.now(),
//                             },
//                             {
//                                 id: `record-${i}-2`,
//                                 action: 'data-access',
//                                 timestamp: Date.now(),
//                             },
//                             {
//                                 id: `record-${i}-3`,
//                                 action: 'logout',
//                                 timestamp: Date.now(),
//                             },
//                         ],
//                         integrityHash: `hash-${i}`,
//                     });
//                 }
//             }

//             // Verificar integridade dos dados
//             for (let i = 0; i < sessions.length; i++) {
//                 const session = sessions[i];
//                 const context = sessionService.getSessionContext(session.id);

//                 if (context) {
//                     const auditData = await context.stateManager.get(
//                         'audit',
//                         'records',
//                     );

//                     expect(auditData?.sessionId).toBe(session.id);
//                     expect(auditData?.auditId).toBe(`AUDIT-${i}`);
//                     expect(auditData?.integrityHash).toBe(`hash-${i}`);
//                     expect(auditData?.records).toHaveLength(3);
//                 }
//             }
//         });

//         it('should handle malicious data injection attempts', async () => {
//             const tenant1 = 'secure-1';
//             const tenant2 = 'secure-2';

//             const session1 = sessionService.createSession(
//                 tenant1,
//                 'user-1',
//                 {},
//             );
//             const session2 = sessionService.createSession(
//                 tenant2,
//                 'user-2',
//                 {},
//             );

//             const context1 = sessionService.getSessionContext(session1.id);
//             const context2 = sessionService.getSessionContext(session2.id);

//             if (context1 && context2) {
//                 // Dados legítimos
//                 await context1.stateManager.set('secure', 'data', {
//                     userId: 'user-1',
//                     permissions: ['read', 'write'],
//                     sessionId: session1.id,
//                 });

//                 await context2.stateManager.set('secure', 'data', {
//                     userId: 'user-2',
//                     permissions: ['read'],
//                     sessionId: session2.id,
//                 });

//                 // Tentar injetar dados maliciosos (deve ser isolado)
//                 const maliciousData = {
//                     userId: 'user-2', // Tentativa de cross-contamination
//                     permissions: ['admin'], // Elevação de privilégios
//                     sessionId: session1.id, // Session hijacking
//                     malicious: true,
//                 };

//                 try {
//                     await context1.stateManager.set(
//                         'secure',
//                         'data',
//                         maliciousData,
//                     );

//                     // Verificar que dados originais não foram corrompidos
//                     const data1 = await context1.stateManager.get(
//                         'secure',
//                         'data',
//                     );
//                     const data2 = await context2.stateManager.get(
//                         'secure',
//                         'data',
//                     );

//                     expect(data1?.userId).toBe('user-1');
//                     expect(data1?.permissions).toEqual(['read', 'write']);
//                     expect(data2?.userId).toBe('user-2');
//                     expect(data2?.permissions).toEqual(['read']);

//                     // Verificar que dados maliciosos não vazaram
//                     expect(data1?.malicious).toBeUndefined();
//                     expect(data2?.malicious).toBeUndefined();
//                 } catch (error) {
//                     // Esperado - sistema deve rejeitar dados maliciosos
//                     expect(error).toBeDefined();
//                 }
//             }
//         });
//     });

//     describe('Session Security & Cleanup', () => {
//         it('should ensure complete data cleanup on session expiration', async () => {
//             const tenant = 'temporary-tenant';

//             // Criar sessão com dados sensíveis
//             const session = sessionService.createSession(tenant, 'temp-user', {
//                 agentName: 'temp-agent',
//             });

//             const context = sessionService.getSessionContext(session.id);
//             if (context) {
//                 // Adicionar dados sensíveis
//                 await context.stateManager.set('sensitive', 'credentials', {
//                     username: 'admin',
//                     password: 'secret123',
//                     apiKey: 'sk-1234567890abcdef',
//                     sessionToken: 'token-123',
//                 });

//                 await context.stateManager.set('sensitive', 'personal', {
//                     ssn: '123-45-6789',
//                     creditCard: '4111-1111-1111-1111',
//                     address: '123 Main St',
//                 });

//                 // Verificar que dados estão salvos
//                 const credentials = await context.stateManager.get(
//                     'sensitive',
//                     'credentials',
//                 );
//                 const personal = await context.stateManager.get(
//                     'sensitive',
//                     'personal',
//                 );

//                 expect(credentials?.username).toBe('admin');
//                 expect(personal?.ssn).toBe('123-45-6789');
//             }

//             // Forçar expiração da sessão
//             session.status = 'expired';
//             sessionService.cleanupExpiredSessions();

//             // Verificar que dados foram completamente removidos
//             const expiredSession = sessionService.getSession(session.id);
//             expect(expiredSession).toBeUndefined();

//             const expiredContext = sessionService.getSessionContext(session.id);
//             expect(expiredContext).toBeUndefined();
//         });

//         it('should prevent session resurrection after cleanup', async () => {
//             const tenant = 'test-tenant';
//             const sessions = [];

//             // Criar múltiplas sessões
//             for (let i = 0; i < 100; i++) {
//                 const session = sessionService.createSession(
//                     tenant,
//                     `user-${i}`,
//                     {},
//                 );
//                 sessions.push(session);
//             }

//             // Forçar cleanup
//             sessionService.cleanupExpiredSessions();

//             // Tentar acessar sessões após cleanup
//             for (const session of sessions) {
//                 const retrievedSession = sessionService.getSession(session.id);
//                 const retrievedContext = sessionService.getSessionContext(
//                     session.id,
//                 );

//                 // Verificar que sessões não podem ser "ressuscitadas"
//                 if (retrievedSession) {
//                     expect(retrievedSession.status).not.toBe('expired');
//                 }

//                 if (retrievedContext) {
//                     // Tentar acessar dados de contexto limpo
//                     const data = await retrievedContext.stateManager.get(
//                         'test',
//                         'data',
//                     );
//                     expect(data).toBeUndefined();
//                 }
//             }
//         });
//     });
// });
