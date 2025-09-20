// /**
//  * @file enterprise-memory-stress.test.ts
//  * @description Testes enterprise-grade para stress testing, isolamento de tenants, concorrência e edge cases extremos
//  * Sistema deve suportar milhões de requests com isolamento total entre clientes
//  */

// import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// import { SessionService } from '../../src/core/context/services/session-service.js';
// import { ContextStateService } from '../../src/core/context/services/state-service.js';
// import { createLogger } from '../../src/observability/index.js';

// describe('Enterprise Memory Stress Tests', () => {
//     let sessionService: SessionService;
//     let logger: ReturnType<typeof createLogger>;

//     beforeEach(() => {
//         sessionService = new SessionService({
//             maxSessions: 10000, // Suportar 10k sessões simultâneas
//             sessionTimeout: 300000, // 5 minutos
//             enableAutoCleanup: true,
//             cleanupInterval: 60000, // 1 minuto
//         });

//         logger = createLogger('enterprise-stress-test');
//     });

//     afterEach(async () => {
//         // Cleanup agressivo
//         sessionService.cleanupExpiredSessions();
//         await new Promise((resolve) => setTimeout(resolve, 100));
//     });

//     describe('Multi-Tenant Isolation', () => {
//         it('should maintain complete isolation between different tenants', async () => {
//             const tenants = [
//                 'tenant-1',
//                 'tenant-2',
//                 'tenant-3',
//                 'tenant-4',
//                 'tenant-5',
//             ];
//             const sessions = new Map<string, any>();

//             // Criar sessões para múltiplos tenants
//             for (const tenant of tenants) {
//                 const session = sessionService.createSession(
//                     tenant,
//                     `thread-${tenant}`,
//                     { agentName: `agent-${tenant}` },
//                 );
//                 sessions.set(tenant, session);

//                 // Adicionar dados específicos do tenant
//                 const sessionContext = sessionService.getSessionContext(
//                     session.id,
//                 );
//                 if (sessionContext) {
//                     await sessionContext.stateManager.set('tenant', 'data', {
//                         tenantId: tenant,
//                         secret: `secret-${tenant}`,
//                         timestamp: Date.now(),
//                     });
//                 }
//             }

//             // Verificar isolamento - cada tenant só deve ver seus próprios dados
//             for (const [tenant, session] of sessions) {
//                 const retrievedSession = sessionService.getSession(session.id);
//                 expect(retrievedSession).toBeDefined();
//                 expect(retrievedSession?.tenantId).toBe(tenant);

//                 const sessionContext = sessionService.getSessionContext(
//                     session.id,
//                 );
//                 if (sessionContext) {
//                     const tenantData = await sessionContext.stateManager.get(
//                         'tenant',
//                         'data',
//                     );
//                     expect(tenantData).toBeDefined();
//                     expect(tenantData?.tenantId).toBe(tenant);
//                     expect(tenantData?.secret).toBe(`secret-${tenant}`);

//                     // Verificar que NÃO consegue acessar dados de outros tenants
//                     for (const otherTenant of tenants) {
//                         if (otherTenant !== tenant) {
//                             const otherSession = sessions.get(otherTenant);
//                             const otherContext =
//                                 sessionService.getSessionContext(
//                                     otherSession?.id,
//                                 );
//                             if (otherContext) {
//                                 const crossTenantData =
//                                     await otherContext.stateManager.get(
//                                         'tenant',
//                                         'data',
//                                     );
//                                 expect(crossTenantData?.tenantId).toBe(
//                                     otherTenant,
//                                 );
//                                 expect(crossTenantData?.tenantId).not.toBe(
//                                     tenant,
//                                 );
//                             }
//                         }
//                     }
//                 }
//             }
//         });

//         it('should handle tenant data corruption scenarios', async () => {
//             const tenant1 = 'tenant-1';
//             const tenant2 = 'tenant-2';

//             // Criar sessões com dados críticos
//             const session1 = sessionService.createSession(
//                 tenant1,
//                 'thread-1',
//                 {},
//             );
//             const session2 = sessionService.createSession(
//                 tenant2,
//                 'thread-2',
//                 {},
//             );

//             const context1 = sessionService.getSessionContext(session1.id);
//             const context2 = sessionService.getSessionContext(session2.id);

//             if (context1 && context2) {
//                 // Dados críticos do tenant 1
//                 await context1.stateManager.set('critical', 'user-data', {
//                     userId: 'user-1',
//                     balance: 1000000,
//                     transactions: ['tx1', 'tx2', 'tx3'],
//                 });

//                 // Dados críticos do tenant 2
//                 await context2.stateManager.set('critical', 'user-data', {
//                     userId: 'user-2',
//                     balance: 500000,
//                     transactions: ['tx4', 'tx5'],
//                 });

//                 // Verificar isolamento absoluto
//                 const data1 = await context1.stateManager.get(
//                     'critical',
//                     'user-data',
//                 );
//                 const data2 = await context2.stateManager.get(
//                     'critical',
//                     'user-data',
//                 );

//                 expect(data1?.userId).toBe('user-1');
//                 expect(data1?.balance).toBe(1000000);
//                 expect(data2?.userId).toBe('user-2');
//                 expect(data2?.balance).toBe(500000);

//                 // Simular tentativa de cross-contamination (deve falhar)
//                 try {
//                     await context1.stateManager.set('critical', 'user-data', {
//                         userId: 'user-2',
//                         balance: 500000,
//                     });
//                     // Se chegou aqui, houve falha no isolamento
//                     expect(true).toBe(false);
//                 } catch (error) {
//                     // Esperado - isolamento funcionando
//                     expect(error).toBeDefined();
//                 }
//             }
//         });
//     });

//     describe('High Concurrency Stress Tests', () => {
//         it('should handle 1000 concurrent session creations', async () => {
//             const concurrentSessions = 1000;
//             const promises = [];

//             // Criar 1000 sessões simultaneamente
//             for (let i = 0; i < concurrentSessions; i++) {
//                 promises.push(
//                     (async () => {
//                         const session = sessionService.createSession(
//                             `tenant-${i % 10}`,
//                             `thread-${i}`,
//                             { agentName: `agent-${i}` },
//                         );

//                         // Adicionar dados em cada sessão
//                         const context = sessionService.getSessionContext(
//                             session.id,
//                         );
//                         if (context) {
//                             await context.stateManager.set('stress', 'data', {
//                                 sessionId: session.id,
//                                 index: i,
//                                 timestamp: Date.now(),
//                             });
//                         }

//                         return session;
//                     })(),
//                 );
//             }

//             const results = await Promise.all(promises);

//             // Verificar que todas as sessões foram criadas corretamente
//             expect(results.length).toBe(concurrentSessions);
//             for (let i = 0; i < results.length; i++) {
//                 const session = results[i];
//                 expect(session).toBeDefined();
//                 expect(session.id).toBeDefined();
//                 expect(session.tenantId).toBe(`tenant-${i % 10}`);

//                 // Verificar dados
//                 const context = sessionService.getSessionContext(session.id);
//                 if (context) {
//                     const data = await context.stateManager.get(
//                         'stress',
//                         'data',
//                     );
//                     expect(data?.index).toBe(i);
//                     expect(data?.sessionId).toBe(session.id);
//                 }
//             }

//             // Verificar que não houve vazamento de memória
//             const activeSessions = Array.from(
//                 sessionService['sessions'].values(),
//             ).filter((s) => s.status === 'active');
//             expect(activeSessions.length).toBeLessThanOrEqual(10000); // Limite configurado
//         });

//         it('should handle rapid session lifecycle (create/update/delete)', async () => {
//             const lifecycleCount = 500;
//             const promises = [];

//             for (let i = 0; i < lifecycleCount; i++) {
//                 promises.push(
//                     (async () => {
//                         // 1. Criar sessão
//                         const session = sessionService.createSession(
//                             `tenant-${i}`,
//                             `thread-${i}`,
//                             { agentName: `agent-${i}` },
//                         );

//                         // 2. Adicionar dados
//                         const context = sessionService.getSessionContext(
//                             session.id,
//                         );
//                         if (context) {
//                             await context.stateManager.set(
//                                 'lifecycle',
//                                 'step1',
//                                 { step: 1, index: i },
//                             );
//                             await context.stateManager.set(
//                                 'lifecycle',
//                                 'step2',
//                                 { step: 2, index: i },
//                             );
//                             await context.stateManager.set(
//                                 'lifecycle',
//                                 'step3',
//                                 { step: 3, index: i },
//                             );
//                         }

//                         // 3. Simular uso intensivo
//                         for (let j = 0; j < 10; j++) {
//                             if (context) {
//                                 await context.stateManager.set(
//                                     'intensive',
//                                     `key-${j}`,
//                                     {
//                                         value: j,
//                                         sessionIndex: i,
//                                         timestamp: Date.now(),
//                                     },
//                                 );
//                             }
//                         }

//                         // 4. Verificar dados
//                         if (context) {
//                             const step1 = await context.stateManager.get(
//                                 'lifecycle',
//                                 'step1',
//                             );
//                             const step2 = await context.stateManager.get(
//                                 'lifecycle',
//                                 'step2',
//                             );
//                             const step3 = await context.stateManager.get(
//                                 'lifecycle',
//                                 'step3',
//                             );

//                             expect(step1?.index).toBe(i);
//                             expect(step2?.index).toBe(i);
//                             expect(step3?.index).toBe(i);
//                         }

//                         return session;
//                     })(),
//                 );
//             }

//             await Promise.all(promises);

//             // Verificar que todas as sessões estão ativas
//             const activeSessions = Array.from(
//                 sessionService['sessions'].values(),
//             ).filter((s) => s.status === 'active');
//             expect(activeSessions.length).toBe(lifecycleCount);
//         });
//     });

//     describe('Memory Pressure and Cleanup', () => {
//         it('should handle memory pressure with aggressive cleanup', async () => {
//             // Criar muitas sessões para forçar cleanup
//             const sessions = [];
//             for (let i = 0; i < 5000; i++) {
//                 const session = sessionService.createSession(
//                     `tenant-${i % 100}`,
//                     `thread-${i}`,
//                     { agentName: `agent-${i}` },
//                 );

//                 // Adicionar dados pesados
//                 const context = sessionService.getSessionContext(session.id);
//                 if (context) {
//                     await context.stateManager.set('heavy', 'data', {
//                         largeArray: new Array(1000).fill(`data-${i}`),
//                         metadata: {
//                             sessionId: session.id,
//                             index: i,
//                             timestamp: Date.now(),
//                         },
//                     });
//                 }

//                 sessions.push(session);
//             }

//             // Forçar cleanup
//             sessionService.cleanupExpiredSessions();

//             // Verificar que o sistema ainda funciona
//             const activeSessions = Array.from(
//                 sessionService['sessions'].values(),
//             ).filter((s) => s.status === 'active');
//             expect(activeSessions.length).toBeLessThanOrEqual(10000);

//             // Verificar que algumas sessões ainda estão funcionando
//             const testSession =
//                 sessions[Math.floor(Math.random() * sessions.length)];
//             const retrievedSession = sessionService.getSession(testSession.id);
//             expect(retrievedSession).toBeDefined();
//         });

//         it('should handle session expiration under load', async () => {
//             // Criar sessões com timeout curto
//             const shortTimeoutService = new SessionService({
//                 maxSessions: 1000,
//                 sessionTimeout: 100, // 100ms para teste rápido
//                 enableAutoCleanup: true,
//                 cleanupInterval: 50, // 50ms
//             });

//             const sessions = [];
//             for (let i = 0; i < 100; i++) {
//                 const session = shortTimeoutService.createSession(
//                     `tenant-${i}`,
//                     `thread-${i}`,
//                     { agentName: `agent-${i}` },
//                 );
//                 sessions.push(session);
//             }

//             // Aguardar expiração
//             await new Promise((resolve) => setTimeout(resolve, 200));

//             // Forçar cleanup
//             shortTimeoutService.cleanupExpiredSessions();

//             // Verificar que sessões foram limpas
//             let activeCount = 0;
//             for (const session of sessions) {
//                 const retrieved = shortTimeoutService.getSession(session.id);
//                 if (retrieved) activeCount++;
//             }

//             // Deve ter poucas ou nenhuma sessão ativa
//             expect(activeCount).toBeLessThan(100);
//         });
//     });

//     describe('Edge Cases and Error Scenarios', () => {
//         it('should handle malformed tenant IDs and session data', async () => {
//             const malformedTenants = [
//                 '', // Empty
//                 'a'.repeat(1000), // Very long
//                 'tenant@#$%^&*()', // Special chars
//                 'tenant with spaces',
//                 'tenant\nwith\nnewlines',
//                 'tenant\twith\ttabs',
//             ];

//             for (const tenant of malformedTenants) {
//                 try {
//                     const session = sessionService.createSession(
//                         tenant,
//                         `thread-${tenant}`,
//                         { agentName: `agent-${tenant}` },
//                     );

//                     expect(session).toBeDefined();
//                     expect(session.tenantId).toBe(tenant);

//                     // Testar com dados malformados
//                     const context = sessionService.getSessionContext(
//                         session.id,
//                     );
//                     if (context) {
//                         await context.stateManager.set('malformed', 'data', {
//                             nullValue: null,
//                             undefinedValue: undefined,
//                             circularRef: {} as any,
//                             largeString: 'x'.repeat(10000),
//                         });

//                         const data = await context.stateManager.get(
//                             'malformed',
//                             'data',
//                         );
//                         expect(data).toBeDefined();
//                     }
//                 } catch (error) {
//                     // Alguns casos malformados podem falhar, mas não devem quebrar o sistema
//                     logger.warn('Malformed tenant handled', {
//                         tenant,
//                         error: error.message,
//                     });
//                 }
//             }
//         });

//         it('should handle concurrent access to same session', async () => {
//             const session = sessionService.createSession(
//                 'tenant-1',
//                 'thread-1',
//                 {},
//             );
//             const context = sessionService.getSessionContext(session.id);

//             if (context) {
//                 const concurrentWrites = 100;
//                 const promises = [];

//                 for (let i = 0; i < concurrentWrites; i++) {
//                     promises.push(
//                         context.stateManager.set('concurrent', `key-${i}`, {
//                             value: i,
//                             timestamp: Date.now(),
//                         }),
//                     );
//                 }

//                 await Promise.all(promises);

//                 // Verificar que todos os dados foram salvos
//                 for (let i = 0; i < concurrentWrites; i++) {
//                     const data = await context.stateManager.get(
//                         'concurrent',
//                         `key-${i}`,
//                     );
//                     expect(data?.value).toBe(i);
//                 }
//             }
//         });

//         it('should handle rapid session context switching', async () => {
//             const sessions = [];
//             for (let i = 0; i < 100; i++) {
//                 const session = sessionService.createSession(
//                     `tenant-${i}`,
//                     `thread-${i}`,
//                     { agentName: `agent-${i}` },
//                 );
//                 sessions.push(session);
//             }

//             // Alternar rapidamente entre contextos
//             const promises = [];
//             for (let i = 0; i < 1000; i++) {
//                 const sessionIndex = i % sessions.length;
//                 const session = sessions[sessionIndex];
//                 const context = sessionService.getSessionContext(session.id);

//                 if (context) {
//                     promises.push(
//                         context.stateManager.set('switching', `key-${i}`, {
//                             sessionIndex,
//                             iteration: i,
//                             timestamp: Date.now(),
//                         }),
//                     );
//                 }
//             }

//             await Promise.all(promises);

//             // Verificar que todos os dados foram salvos corretamente
//             for (let i = 0; i < 1000; i++) {
//                 const sessionIndex = i % sessions.length;
//                 const session = sessions[sessionIndex];
//                 const context = sessionService.getSessionContext(session.id);

//                 if (context) {
//                     const data = await context.stateManager.get(
//                         'switching',
//                         `key-${i}`,
//                     );
//                     expect(data?.sessionIndex).toBe(sessionIndex);
//                     expect(data?.iteration).toBe(i);
//                 }
//             }
//         });
//     });

//     describe('Performance and Scalability', () => {
//         it('should maintain performance under sustained load', async () => {
//             const startTime = Date.now();
//             const operations = 10000;
//             const promises = [];

//             for (let i = 0; i < operations; i++) {
//                 promises.push(
//                     (async () => {
//                         const session = sessionService.createSession(
//                             `tenant-${i % 100}`,
//                             `thread-${i}`,
//                             { agentName: `agent-${i}` },
//                         );

//                         const context = sessionService.getSessionContext(
//                             session.id,
//                         );
//                         if (context) {
//                             await context.stateManager.set('perf', 'data', {
//                                 index: i,
//                                 timestamp: Date.now(),
//                             });

//                             const data = await context.stateManager.get(
//                                 'perf',
//                                 'data',
//                             );
//                             expect(data?.index).toBe(i);
//                         }

//                         return session;
//                     })(),
//                 );
//             }

//             await Promise.all(promises);
//             const endTime = Date.now();
//             const duration = endTime - startTime;

//             // Performance deve ser aceitável (menos de 10 segundos para 10k operações)
//             expect(duration).toBeLessThan(10000);

//             logger.info('Performance test completed', {
//                 operations,
//                 duration,
//                 opsPerSecond: Math.round(operations / (duration / 1000)),
//             });
//         });

//         it('should handle memory growth and cleanup cycles', async () => {
//             const cycles = 10;
//             const sessionsPerCycle = 1000;

//             for (let cycle = 0; cycle < cycles; cycle++) {
//                 logger.info('Starting cycle', { cycle });

//                 // Criar sessões
//                 const sessions = [];
//                 for (let i = 0; i < sessionsPerCycle; i++) {
//                     const session = sessionService.createSession(
//                         `tenant-${cycle}-${i}`,
//                         `thread-${cycle}-${i}`,
//                         { agentName: `agent-${cycle}-${i}` },
//                     );

//                     const context = sessionService.getSessionContext(
//                         session.id,
//                     );
//                     if (context) {
//                         await context.stateManager.set('cycle', 'data', {
//                             cycle,
//                             index: i,
//                             timestamp: Date.now(),
//                         });
//                     }

//                     sessions.push(session);
//                 }

//                 // Verificar dados
//                 for (let i = 0; i < sessionsPerCycle; i++) {
//                     const session = sessions[i];
//                     const context = sessionService.getSessionContext(
//                         session.id,
//                     );
//                     if (context) {
//                         const data = await context.stateManager.get(
//                             'cycle',
//                             'data',
//                         );
//                         expect(data?.cycle).toBe(cycle);
//                         expect(data?.index).toBe(i);
//                     }
//                 }

//                 // Forçar cleanup
//                 sessionService.cleanupExpiredSessions();

//                 // Verificar que sistema ainda funciona
//                 const activeSessions = Array.from(
//                     sessionService['sessions'].values(),
//                 ).filter((s) => s.status === 'active');
//                 expect(activeSessions.length).toBeLessThanOrEqual(10000);

//                 logger.info('Cycle completed', {
//                     cycle,
//                     activeSessions: activeSessions.length,
//                 });
//             }
//         });
//     });
// });
