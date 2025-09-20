/**
 * @file basic-kernel.test.ts
 * @description Testes básicos do Kernel Layer
 */

import { describe, it, expect } from 'vitest';
import {
    createKernel,
    createSnapshot,
    restoreSnapshot,
    validateSnapshot,
    createPersistor,
} from '../../src/kernel/index.js';
import {
    createBaseContext,
    ContextStateService,
} from '../../src/core/context/index.js';
import type { Event } from '../../src/core/types/events.js';
import type {
    WorkflowContext,
    Workflow,
} from '../../src/core/types/workflow-types.js';

// Helper function to create a complete EventStream mock
function createEventStreamMock() {
    const mockStream = {
        [Symbol.asyncIterator]: async function* () {},
        filter: () => mockStream,
        map: () => mockStream,
        until: () => mockStream,
        takeUntil: () => mockStream,
        take: () => mockStream,
        skip: () => mockStream,
        reduce: () => mockStream,
        forEach: () => mockStream,
        toArray: async () => [],
        subscribe: () => ({ unsubscribe: () => {} }),
        withMiddleware: () => mockStream,
        debounce: () => mockStream,
        throttle: () => mockStream,
        batch: () => mockStream,
        retry: () => mockStream,
        timeout: () => mockStream,
        merge: () => mockStream,
        combineLatest: () => mockStream,
    };
    return mockStream;
}

describe('Kernel Layer - Basic Functionality', () => {
    it('should create kernel with proper interface', () => {
        createBaseContext({
            tenantId: 'test-tenant',
        });

        const mockWorkflow = {
            name: 'test-workflow',
            on: () => {},
            emit: () => {},
            pause: async () => 'paused',
            resume: async () => {},
            cleanup: async () => {},
            createContext: (): WorkflowContext =>
                ({
                    executionId: 'test-execution-id',
                    tenantId: 'test-tenant',
                    startTime: Date.now(),
                    status: 'RUNNING' as const,
                    workflowName: 'test-workflow',
                    data: {},
                    currentSteps: [],
                    completedSteps: [],
                    failedSteps: [],
                    isPaused: false,
                    signal: new AbortController().signal,
                    stateManager: new ContextStateService({}),
                    cleanup: async () => {},
                    sendEvent: async () => {},
                    emit: () => {},
                    pause: async () => 'paused',
                    resume: async () => {},
                    stream: createEventStreamMock(),
                    resourceManager: {
                        addTimer: () => {},
                        addInterval: () => {},
                        addCleanupCallback: () => {},
                        removeTimer: () => true,
                        removeInterval: () => true,
                        removeCleanupCallback: () => true,
                    },
                }) as unknown as WorkflowContext,
        };

        const kernel = createKernel({
            tenantId: 'test-tenant',
            workflow: mockWorkflow as unknown as Workflow,
        });

        expect(kernel).toBeDefined();
        expect(typeof kernel.run).toBe('function');
        expect(typeof kernel.sendEvent).toBe('function');
        expect(typeof kernel.getStatus).toBe('function');
        expect(typeof kernel.getContext).toBe('function');
        expect(typeof kernel.setContext).toBe('function');
    });

    it('should create and validate snapshots', () => {
        const baseContext = createBaseContext({
            tenantId: 'test-tenant',
        });

        const testState = {
            counter: 42,
            message: 'Hello World',
            nested: {
                value: 'test',
            },
        };

        const testEvents: Event<string>[] = [];
        const snapshot = createSnapshot(baseContext, testEvents, testState);

        expect(snapshot.xcId).toBe(baseContext.tenantId);
        expect(snapshot.state).toEqual(testState);
        expect(snapshot.events).toEqual(testEvents);
        expect(snapshot.ts).toBeDefined();
        expect(snapshot.hash).toBeDefined();

        // Validate snapshot
        expect(() => validateSnapshot(snapshot)).not.toThrow();
    });

    it('should restore state from snapshot', () => {
        const baseContext = createBaseContext({
            tenantId: 'test-tenant',
        });

        const originalState = {
            counter: 100,
            data: 'original',
        };

        const testEvents: Event<string>[] = [];
        const snapshot = createSnapshot(baseContext, testEvents, originalState);
        const restored = restoreSnapshot(snapshot);

        expect(restored.state).toEqual(originalState);
        expect(restored.events).toEqual(testEvents);
    });

    it('should create memory persistor', () => {
        const persistor = createPersistor('memory');

        expect(persistor).toBeDefined();
        expect(typeof persistor.append).toBe('function');
        expect(typeof persistor.load).toBe('function');
        expect(typeof persistor.has).toBe('function');
    });

    it('should persist and retrieve snapshots', async () => {
        const persistor = createPersistor('memory');
        const baseContext = createBaseContext({
            tenantId: 'test-tenant',
        });

        const testState = { value: 'test' };
        const testEvents: Event<string>[] = [];
        const snapshot = createSnapshot(baseContext, testEvents, testState);

        // Persist snapshot
        await persistor.append(snapshot);

        // Check if exists
        const exists = await persistor.has(snapshot.hash);
        expect(exists).toBe(true);

        // Retrieve snapshot
        const retrieved = await persistor.getByHash?.(snapshot.hash);
        expect(retrieved).toEqual(snapshot);
    });

    it('should list snapshots for execution context', async () => {
        const persistor = createPersistor('memory');

        const baseContext1 = createBaseContext({
            tenantId: 'test-tenant',
        });
        const baseContext2 = createBaseContext({
            tenantId: 'other-tenant',
        });

        const testEvents: Event<string>[] = [];
        const snapshot1 = createSnapshot(baseContext1, testEvents, {
            value: 1,
        });
        const snapshot2 = createSnapshot(baseContext1, testEvents, {
            value: 2,
        });
        const snapshot3 = createSnapshot(baseContext2, testEvents, {
            value: 3,
        });

        await persistor.append(snapshot1);
        await persistor.append(snapshot2);
        await persistor.append(snapshot3);

        const hashes = await persistor.listHashes?.(baseContext1.tenantId);
        expect(hashes).toHaveLength(2);
        expect(hashes).toContain(snapshot1.hash);
        expect(hashes).toContain(snapshot2.hash);
        expect(hashes).not.toContain(snapshot3.hash);
    });

    it('should handle kernel context management', async () => {
        createBaseContext({
            tenantId: 'test-tenant',
        });

        const mockWorkflow = {
            name: 'test-workflow',
            on: () => {},
            emit: () => {},
            pause: async () => 'paused',
            resume: async () => {},
            cleanup: async () => {},
            createContext: (): WorkflowContext =>
                ({
                    executionId: 'test-execution-id',
                    tenantId: 'test-tenant',
                    startTime: Date.now(),
                    status: 'RUNNING' as const,
                    workflowName: 'test-workflow',
                    data: {},
                    currentSteps: [],
                    completedSteps: [],
                    failedSteps: [],
                    isPaused: false,
                    signal: new AbortController().signal,
                    stateManager: new ContextStateService({}),
                    cleanup: async () => {},
                    sendEvent: async () => {},
                    emit: () => {},
                    pause: async () => 'paused',
                    resume: async () => {},
                    stream: createEventStreamMock(),
                    resourceManager: {
                        addTimer: () => {},
                        addInterval: () => {},
                        addCleanupCallback: () => {},
                        removeTimer: () => true,
                        removeInterval: () => true,
                        removeCleanupCallback: () => true,
                    },
                }) as unknown as WorkflowContext,
        };

        const kernel = createKernel({
            tenantId: 'test-tenant',
            workflow: mockWorkflow as unknown as Workflow,
        });

        await kernel.initialize();

        // Set context
        kernel.setContext('test', 'counter', 0);
        kernel.setContext('test', 'message', 'Hello');

        // Get context
        expect(kernel.getContext('test', 'counter')).toBe(0);
        expect(kernel.getContext('test', 'message')).toBe('Hello');

        // Update context
        kernel.setContext('test', 'counter', 42);
        expect(kernel.getContext('test', 'counter')).toBe(42);

        // Get non-existent context
        expect(kernel.getContext('test', 'non-existent')).toBeUndefined();
    });

    it('should isolate context by threadId', async () => {
        createBaseContext({
            tenantId: 'test-tenant',
        });

        const mockWorkflow = {
            name: 'test-workflow',
            on: () => {},
            emit: () => {},
            pause: async () => 'paused',
            resume: async () => {},
            cleanup: async () => {},
            createContext: (): WorkflowContext =>
                ({
                    executionId: 'test-execution-id',
                    tenantId: 'test-tenant',
                    startTime: Date.now(),
                    status: 'RUNNING' as const,
                    workflowName: 'test-workflow',
                    data: {},
                    currentSteps: [],
                    completedSteps: [],
                    failedSteps: [],
                    isPaused: false,
                    signal: new AbortController().signal,
                    stateManager: new ContextStateService({}),
                    cleanup: async () => {},
                    sendEvent: async () => {},
                    emit: () => {},
                    pause: async () => 'paused',
                    resume: async () => {},
                    stream: createEventStreamMock(),
                    resourceManager: {
                        addTimer: () => {},
                        addInterval: () => {},
                        addCleanupCallback: () => {},
                        removeTimer: () => true,
                        removeInterval: () => true,
                        removeCleanupCallback: () => true,
                    },
                }) as unknown as WorkflowContext,
        };

        const kernel = createKernel({
            tenantId: 'test-tenant',
            workflow: mockWorkflow as unknown as Workflow,
            isolation: { enableTenantIsolation: true },
        });

        await kernel.initialize();

        const threadId1 = 'thread-1';
        const threadId2 = 'thread-2';

        // Set context for thread 1
        kernel.setContext('test', 'counter', 10, threadId1);
        kernel.setContext('test', 'message', 'Hello from thread 1', threadId1);

        // Set context for thread 2
        kernel.setContext('test', 'counter', 20, threadId2);
        kernel.setContext('test', 'message', 'Hello from thread 2', threadId2);

        // Verify isolation - thread 1 should only see its own data
        expect(kernel.getContext('test', 'counter', threadId1)).toBe(10);
        expect(kernel.getContext('test', 'message', threadId1)).toBe(
            'Hello from thread 1',
        );

        // Verify isolation - thread 2 should only see its own data
        expect(kernel.getContext('test', 'counter', threadId2)).toBe(20);
        expect(kernel.getContext('test', 'message', threadId2)).toBe(
            'Hello from thread 2',
        );

        // Verify that threads don't see each other's data
        expect(kernel.getContext('test', 'counter', threadId1)).not.toBe(20);
        expect(kernel.getContext('test', 'message', threadId1)).not.toBe(
            'Hello from thread 2',
        );

        // Test increment with thread isolation
        const newValue1 = kernel.incrementContext(
            'test',
            'counter',
            5,
            threadId1,
        );
        expect(newValue1).toBe(15);
        expect(kernel.getContext('test', 'counter', threadId1)).toBe(15);
        expect(kernel.getContext('test', 'counter', threadId2)).toBe(20); // Unchanged
    });
});

export class TestWorkflow {
    a() {
        return 'a';
    }

    b() {
        return 'b';
    }

    c() {
        return this.a() + this.b();
    }

    d() {
        return this.c();
    }
}
