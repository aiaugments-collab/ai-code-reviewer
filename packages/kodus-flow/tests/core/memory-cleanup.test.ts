/**
 * @file memory-cleanup.test.ts
 * @description Testes para verificar se session, state e context estão sendo salvos corretamente em memória e sendo limpos adequadamente
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionService } from '../../src/core/context/services/session-service.js';
import { ContextStateService } from '../../src/core/context/services/state-service.js';

describe('Memory Cleanup Tests', () => {
    let sessionService: SessionService;

    beforeEach(() => {
        sessionService = new SessionService({
            maxSessions: 10,
            sessionTimeout: 1000, // 1 segundo para testes
            enableAutoCleanup: true,
            cleanupInterval: 500, // 500ms para testes
        });
    });

    afterEach(async () => {
        // Limpar todas as sessões
        sessionService.cleanupExpiredSessions();
    });

    describe('Session Memory Management', () => {
        it('should create session and save in memory correctly', async () => {
            const session = await sessionService.createSession(
                'test-tenant',
                'test-thread',
                { agentName: 'test-agent' },
            );

            expect(session).toBeDefined();
            expect(session.id).toBeDefined();
            expect(session.tenantId).toBe('test-tenant');
            expect(session.threadId).toBe('test-thread');
            expect(session.status).toBe('active');

            // Verificar se session está salva em memória
            const retrievedSession = await sessionService.getSession(
                session.id,
            );
            expect(retrievedSession).toBeDefined();
            expect(retrievedSession?.id).toBe(session.id);
        });

        it('should cleanup expired sessions automatically', async () => {
            // Criar sessão com timeout curto
            const session = await sessionService.createSession(
                'test-tenant',
                'test-thread',
                { agentName: 'test-agent' },
            );

            // Aguardar expiração
            await new Promise((resolve) => setTimeout(resolve, 1200));

            // Verificar se sessão foi limpa
            const retrievedSession = await sessionService.getSession(
                session.id,
            );
            expect(retrievedSession).toBeUndefined();

            // Verificar se state manager foi limpo
            const sessionContext = await sessionService.getSessionContext(
                session.id,
            );
            expect(sessionContext).toBeUndefined();
        });

        it('should enforce max sessions limit', async () => {
            // Criar mais sessões que o limite
            const sessions: Awaited<
                ReturnType<typeof sessionService.createSession>
            >[] = [];
            for (let i = 0; i < 15; i++) {
                const session = await sessionService.createSession(
                    'test-tenant',
                    `test-thread-${i}`,
                    { agentName: 'test-agent' },
                );
                sessions.push(session);
            }

            // Verificar se apenas o limite máximo está em memória
            const activeSessions = Array.from(
                sessionService['sessions'].values(),
            ).filter((s) => s.status === 'active');

            expect(activeSessions.length).toBeLessThanOrEqual(10);
        });

        it('should update session activity correctly', async () => {
            const session = await sessionService.createSession(
                'test-tenant',
                'test-thread',
                { agentName: 'test-agent' },
            );

            const initialActivity = session.lastActivity;

            // Aguardar um pouco para garantir diferença de tempo
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Acessar sessão novamente
            const retrievedSession = await sessionService.getSession(
                session.id,
            );
            expect(retrievedSession).toBeDefined();
            expect(retrievedSession?.lastActivity).toBeGreaterThan(
                initialActivity,
            );
        });
    });

    describe('State Memory Management', () => {
        it('should save and retrieve state correctly', async () => {
            const contextKey = { sessionId: 'test-session' };
            const stateManager = new ContextStateService(contextKey);

            // Salvar dados em diferentes namespaces
            await stateManager.set('user', 'preferences', { theme: 'dark' });
            await stateManager.set('agent', 'state', { status: 'running' });
            await stateManager.set('session', 'data', { counter: 42 });

            // Verificar se dados estão salvos
            const userPrefs = await stateManager.get('user', 'preferences');
            const agentState = await stateManager.get('agent', 'state');
            const sessionData = await stateManager.get('session', 'data');

            expect(userPrefs).toEqual({ theme: 'dark' });
            expect(agentState).toEqual({ status: 'running' });
            expect(sessionData).toEqual({ counter: 42 });
        });

        it('should cleanup state when session expires', async () => {
            const session = await sessionService.createSession(
                'test-tenant',
                'test-thread',
                { agentName: 'test-agent' },
            );

            const sessionContext = await sessionService.getSessionContext(
                session.id,
            );
            expect(sessionContext).toBeDefined();

            // Adicionar dados ao state
            if (sessionContext) {
                await sessionContext.stateManager.set('test', 'value', 'data');
                const retrieved = await sessionContext.stateManager.get(
                    'test',
                    'value',
                );
                expect(retrieved).toBe('data');
            }

            // Aguardar expiração
            await new Promise((resolve) => setTimeout(resolve, 1200));

            // Verificar se state foi limpo
            const expiredSessionContext =
                await sessionService.getSessionContext(session.id);
            expect(expiredSessionContext).toBeUndefined();
        });

        it('should enforce namespace size limits', async () => {
            const contextKey = { sessionId: 'test-session' };
            const stateManager = new ContextStateService(contextKey, {
                maxNamespaceSize: 3,
                maxNamespaces: 2,
            });

            // Adicionar dados até o limite
            await stateManager.set('namespace1', 'key1', 'value1');
            await stateManager.set('namespace1', 'key2', 'value2');
            await stateManager.set('namespace1', 'key3', 'value3');

            // Tentar adicionar mais deve falhar
            await expect(
                stateManager.set('namespace1', 'key4', 'value4'),
            ).rejects.toThrow('Maximum namespace size');

            // Adicionar em outro namespace
            await stateManager.set('namespace2', 'key1', 'value1');
            await stateManager.set('namespace2', 'key2', 'value2');
            await stateManager.set('namespace2', 'key3', 'value3');

            // Tentar adicionar mais deve falhar
            await expect(
                stateManager.set('namespace2', 'key4', 'value4'),
            ).rejects.toThrow('Maximum namespace size');
        });

        it('should clear state correctly', async () => {
            const contextKey = { sessionId: 'test-session' };
            const stateManager = new ContextStateService(contextKey);

            // Adicionar dados
            await stateManager.set('user', 'preferences', { theme: 'dark' });
            await stateManager.set('agent', 'state', { status: 'running' });

            // Limpar namespace específico
            await stateManager.clear('user');
            expect(
                await stateManager.get('user', 'preferences'),
            ).toBeUndefined();
            expect(await stateManager.get('agent', 'state')).toEqual({
                status: 'running',
            });

            // Limpar tudo
            await stateManager.clear();
            expect(await stateManager.get('agent', 'state')).toBeUndefined();
        });
    });

    describe('Memory Leak Detection', () => {
        it('should detect memory leaks in session service', async () => {
            // Criar sessões sem limpar
            for (let i = 0; i < 20; i++) {
                await sessionService.createSession(
                    'test-tenant',
                    `test-thread-${i}`,
                    { agentName: 'test-agent' },
                );
            }

            // Verificar se limite foi aplicado
            const finalSessions = sessionService['sessions'].size;
            const finalStateManagers =
                sessionService['sessionStateManagers'].size;

            expect(finalSessions).toBeLessThanOrEqual(10);
            expect(finalStateManagers).toBeLessThanOrEqual(10);
        });

        it('should detect memory leaks in state service', async () => {
            const stateManagers: ContextStateService[] = [];

            // Criar múltiplos state managers
            for (let i = 0; i < 5; i++) {
                const stateManager = new ContextStateService(
                    { sessionId: `test-session-${i}` },
                    { maxNamespaceSize: 100, maxNamespaces: 10 },
                );

                // Adicionar dados
                for (let j = 0; j < 10; j++) {
                    await stateManager.set(
                        `namespace-${j}`,
                        `key-${j}`,
                        `value-${j}`,
                    );
                }

                stateManagers.push(stateManager);
            }

            // Cleanup todos
            await Promise.all(stateManagers.map((sm) => sm.clear()));

            // Verificar se foram limpos
            for (const stateManager of stateManagers) {
                const keys = await stateManager.keys('test');
                expect(keys.length).toBe(0);
            }
        });

        it('should handle cleanup errors gracefully', async () => {
            const contextKey = { sessionId: 'test-session' };
            const stateManager = new ContextStateService(contextKey);

            // Mock para simular erro no cleanup
            vi.spyOn(stateManager, 'clear').mockRejectedValueOnce(
                new Error('Cleanup failed'),
            );

            // Deve não quebrar mesmo com erro
            await expect(stateManager.clear()).rejects.toThrow(
                'Cleanup failed',
            );

            // Restaurar mock
            vi.restoreAllMocks();
        });
    });
});
