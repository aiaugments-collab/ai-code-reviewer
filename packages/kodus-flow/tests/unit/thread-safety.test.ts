import { describe, it, expect } from 'vitest';
import { createThreadSafeMap } from '../../src/utils/thread-safe-map.js';
import { ConcurrentStateManager } from '../../src/utils/thread-safe-state.js';
import {
    createAgentContext,
    createBaseContext,
} from '../../src/core/context/index.js';

describe('Thread Safety Fixes', () => {
    describe('ThreadSafeMap', () => {
        it('should handle concurrent reads and writes safely', async () => {
            const map = createThreadSafeMap<string, number>();

            // Simulate concurrent operations
            const operations = Array.from({ length: 100 }, (_, i) => [
                () => map.set(`key${i}`, i),
                () => map.get(`key${i}`),
                () => map.has(`key${i}`),
            ]).flat();

            // Execute all operations concurrently
            await Promise.all(operations.map((op) => op()));

            // Verify final state
            const size = await map.size();
            expect(size).toBe(100);

            // Verify data integrity
            for (let i = 0; i < 100; i++) {
                const value = await map.get(`key${i}`);
                expect(value).toBe(i);
            }
        });

        it('should maintain compatibility with sync methods', () => {
            const map = createThreadSafeMap<string, string>();

            // Test sync methods (unsafe but compatible)
            map.setSyncUnsafe('test', 'value');
            expect(map.getSyncUnsafe('test')).toBe('value');
            expect(map.hasSyncUnsafe('test')).toBe(true);
            expect(map.sizeUnsafe).toBe(1);
        });
    });

    describe('ConcurrentStateManager', () => {
        it('should provide thread-safe state management', async () => {
            const state = new ConcurrentStateManager();

            // Test async methods (thread-safe)
            await state.set('test-namespace', 'key1', 'value1');
            const value = await state.get('test-namespace', 'key1');
            expect(value).toBe('value1');

            const exists = await state.has('test-namespace', 'key1');
            expect(exists).toBe(true);

            await state.delete('test-namespace', 'key1');
            const existsAfter = await state.has('test-namespace', 'key1');
            expect(existsAfter).toBe(false);
        });

        it('should handle concurrent operations safely', async () => {
            const state = new ConcurrentStateManager();

            // Simulate concurrent operations
            const operations = Array.from({ length: 50 }, (_, i) => [
                () => state.set('test-namespace', `key${i}`, `value${i}`),
                () => state.get('test-namespace', `key${i}`),
                () => state.has('test-namespace', `key${i}`),
            ]).flat();

            // Execute all operations concurrently
            await Promise.all(operations.map((op) => op()));

            // Verify final state
            const size = await state.size('test-namespace');
            expect(size).toBe(50);

            // Verify data integrity
            for (let i = 0; i < 50; i++) {
                const value = await state.get('test-namespace', `key${i}`);
                expect(value).toBe(`value${i}`);
            }
        });
    });

    describe('Context Thread Safety', () => {
        it('should create base context with proper configuration', () => {
            const context = createBaseContext({
                tenantId: 'test-tenant',
                executionId: 'test-execution',
                correlationId: 'test-correlation',
            });

            expect(context.tenantId).toBe('test-tenant');
            expect(context).toBeDefined();
            expect(context.environment).toBeDefined();
        });

        it('should create agent context with thread-safe state', () => {
            const context = createAgentContext({
                agentName: 'test-agent',
                tenantId: 'test-tenant',
            });

            expect(context.agentName).toBe('test-agent');
            expect(context.tenantId).toBe('test-tenant');
            expect(context.state).toBeDefined();

            // Test basic state operations
            context.state.set('test', 'value');
            expect(context.state.get('test')).toBe('value');
            expect(context.state.has('test')).toBe(true);
        });

        it('should handle basic concurrent operations', async () => {
            const context = createAgentContext({
                agentName: 'concurrent-agent',
                tenantId: 'test-tenant',
            });

            // Simulate concurrent operations on agent state
            const operations = Array.from({ length: 50 }, (_, i) => [
                () => context.state.set(`key${i}`, `value${i}`),
                () => context.state.get(`key${i}`),
                () => context.state.has(`key${i}`),
            ]).flat();

            // Execute concurrently
            await Promise.all(operations.map((op) => op()));

            // Verify integrity
            for (let i = 0; i < 50; i++) {
                expect(context.state.get(`key${i}`)).toBe(`value${i}`);
                expect(context.state.has(`key${i}`)).toBe(true);
            }
        });
    });

    describe('Integration Tests', () => {
        it('should handle mixed operations across different components', async () => {
            const map = createThreadSafeMap<string, number>();
            const state = new ConcurrentStateManager();
            const context = createAgentContext({
                agentName: 'integration-agent',
                tenantId: 'test-tenant',
            });

            // Mixed operations
            const operations = [
                () => map.set('map-key', 1),
                () => state.set('state-namespace', 'state-key', 'state-value'),
                () => context.state.set('context-key', 'context-value'),
                () => map.get('map-key'),
                () => state.get('state-namespace', 'state-key'),
                () => context.state.get('context-key'),
            ];

            // Execute all operations concurrently
            await Promise.all(operations.map((op) => op()));

            // Verify all components work correctly
            expect(await map.get('map-key')).toBe(1);
            expect(await state.get('state-namespace', 'state-key')).toBe(
                'state-value',
            );
            expect(context.state.get('context-key')).toBe('context-value');
        });
    });
});
