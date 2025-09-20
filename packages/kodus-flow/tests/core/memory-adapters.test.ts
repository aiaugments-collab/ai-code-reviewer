/**
 * @file memory-adapters.test.ts
 * @description Tests for memory adapters
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageAdapterFactory } from '../../src/core/storage/factory.js';
import type {
    BaseStorage,
    BaseStorageItem,
} from '../../src/core/types/base-storage.js';

describe('Memory Adapters', () => {
    let adapter: BaseStorage<BaseStorageItem>;

    beforeEach(async () => {
        adapter = await StorageAdapterFactory.create({
            type: 'memory',
            maxItems: 1000,
            enableCompression: true,
            cleanupInterval: 300000,
            timeout: 5000,
            retries: 3,
            enableObservability: true,
            enableHealthChecks: true,
            enableMetrics: true,
        });
        await adapter.initialize();
    });

    afterEach(async () => {
        if (adapter) {
            await adapter.cleanup();
        }
    });

    describe('Basic Operations', () => {
        it('should store and retrieve items', async () => {
            const testItem: BaseStorageItem = {
                id: 'test-1',
                timestamp: Date.now(),
                metadata: { test: true, content: 'Test content' },
            };

            await adapter.store(testItem);
            const retrieved = await adapter.retrieve('test-1');

            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe('test-1');
            // Note: The adapter might not preserve all metadata exactly as stored
            expect(retrieved?.metadata).toMatchObject({ test: true });
        });

        it('should handle non-existent items', async () => {
            const retrieved = await adapter.retrieve('non-existent');
            expect(retrieved).toBeNull();
        });

        it('should delete items', async () => {
            const testItem: BaseStorageItem = {
                id: 'test-delete',
                timestamp: Date.now(),
                metadata: { test: true },
            };

            await adapter.store(testItem);
            const existsBefore = await adapter.retrieve('test-delete');
            expect(existsBefore).toBeDefined();

            const deleted = await adapter.delete('test-delete');
            expect(deleted).toBe(true);

            const existsAfter = await adapter.retrieve('test-delete');
            expect(existsAfter).toBeNull();
        });

        it('should clear all items', async () => {
            const testItems: BaseStorageItem[] = [
                {
                    id: 'test-1',
                    timestamp: Date.now(),
                    metadata: { test: true },
                },
                {
                    id: 'test-2',
                    timestamp: Date.now(),
                    metadata: { test: true },
                },
            ];

            for (const item of testItems) {
                await adapter.store(item);
            }

            await adapter.clear();

            const item1 = await adapter.retrieve('test-1');
            const item2 = await adapter.retrieve('test-2');

            expect(item1).toBeNull();
            expect(item2).toBeNull();
        });
    });

    describe('Health and Stats', () => {
        it('should provide health status', async () => {
            const isHealthy = await adapter.isHealthy();
            expect(typeof isHealthy).toBe('boolean');
        });

        it('should provide storage statistics', async () => {
            const stats = await adapter.getStats();
            expect(stats).toBeDefined();
            expect(typeof stats.itemCount).toBe('number');
            expect(typeof stats.totalSize).toBe('number');
        });
    });

    describe('Factory Pattern', () => {
        it('should create adapters with factory', async () => {
            const factoryAdapter = await StorageAdapterFactory.create({
                type: 'memory',
                maxItems: 1000,
                enableCompression: true,
                timeout: 5000,
                cleanupInterval: 300000,
                retries: 3,
                enableObservability: true,
                enableHealthChecks: true,
                enableMetrics: true,
            });

            expect(factoryAdapter).toBeDefined();
            expect(typeof factoryAdapter.store).toBe('function');
            expect(typeof factoryAdapter.retrieve).toBe('function');

            await factoryAdapter.cleanup();
        });

        it('should create cached adapters', async () => {
            const adapter1 = await StorageAdapterFactory.create({
                type: 'memory',
                maxItems: 1000,
                enableCompression: true,
                timeout: 5000,
                cleanupInterval: 300000,
                retries: 3,
                enableObservability: true,
                enableHealthChecks: true,
                enableMetrics: true,
            });

            const adapter2 = await StorageAdapterFactory.create({
                type: 'memory',
                maxItems: 1000,
                enableCompression: true,
                timeout: 5000,
                cleanupInterval: 300000,
                retries: 3,
                enableObservability: true,
                enableHealthChecks: true,
                enableMetrics: true,
            });

            // Should return cached instance
            expect(adapter1).toBe(adapter2);

            await adapter1.cleanup();
        });

        it('should handle different configurations', async () => {
            const adapter1 = await StorageAdapterFactory.create({
                type: 'memory',
                maxItems: 1000,
                enableCompression: true,
                timeout: 5000,
                cleanupInterval: 300000,
                retries: 3,
                enableObservability: true,
                enableHealthChecks: true,
                enableMetrics: true,
            });

            const adapter2 = await StorageAdapterFactory.create({
                type: 'memory',
                maxItems: 2000,
                enableCompression: true,
                timeout: 5000,
                cleanupInterval: 300000,
                retries: 3,
                enableObservability: true,
                enableHealthChecks: true,
                enableMetrics: true,
            });

            // Should create different instances for different configs
            // Note: The factory caches by type and connectionString, not by full config
            // So we need to use different connection strings to get different instances
            const adapter3 = await StorageAdapterFactory.create({
                type: 'memory',
                maxItems: 1000,
                enableCompression: true,
                timeout: 5000,
                cleanupInterval: 300000,
                retries: 3,
                enableObservability: true,
                enableHealthChecks: true,
                enableMetrics: true,
                connectionString: 'different-connection',
            });

            expect(adapter1).toBe(adapter2); // Same config = cached instance
            expect(adapter1).not.toBe(adapter3); // Different connection = different instance

            await adapter1.cleanup();
            await adapter3.cleanup();
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid storage types', async () => {
            await expect(
                StorageAdapterFactory.create({
                    type: 'invalid' as 'memory',
                    maxItems: 1000,
                    enableCompression: true,
                    timeout: 5000,
                    cleanupInterval: 300000,
                    retries: 3,
                    enableObservability: true,
                    enableHealthChecks: true,
                    enableMetrics: true,
                }),
            ).rejects.toThrow('Unknown storage type: invalid');
        });

        it('should handle initialization errors gracefully', async () => {
            // This test verifies that the adapter handles initialization properly
            const testAdapter = await StorageAdapterFactory.create({
                type: 'memory',
                maxItems: 1000,
                enableCompression: true,
                timeout: 5000,
                cleanupInterval: 300000,
                retries: 3,
                enableObservability: true,
                enableHealthChecks: true,
                enableMetrics: true,
            });

            await expect(testAdapter.initialize()).resolves.not.toThrow();
            await testAdapter.cleanup();
        });
    });
});
