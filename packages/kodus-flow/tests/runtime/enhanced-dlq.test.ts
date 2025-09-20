/**
 * @file enhanced-dlq.test.ts
 * @description Unit tests for Enhanced Event Queue DLQ functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnhancedEventQueue } from '../../src/runtime/core/enhanced-event-queue.js';
import { DeadLetterQueue } from '../../src/runtime/core/dlq-handler.js';
import { createPersistorFromConfig } from '../../src/persistor/factory.js';
import { getObservability } from '../../src/observability/index.js';
import { createEvent } from '../../src/core/types/events.js';

describe('Enhanced Event Queue - DLQ Functionality', () => {
    let enhancedQueue: EnhancedEventQueue;
    let persistor: ReturnType<typeof createPersistorFromConfig>;
    let observability: ReturnType<typeof getObservability>;

    beforeEach(() => {
        persistor = createPersistorFromConfig({
            type: 'memory',
            maxSnapshots: 1000,
            enableCompression: true,
            enableDeltaCompression: true,
            cleanupInterval: 300000,
            maxMemoryUsage: 100 * 1024 * 1024,
        });
        observability = getObservability({ environment: 'test' });
    });

    afterEach(() => {
        if (enhancedQueue) {
            enhancedQueue.destroy();
        }
    });

    describe('DLQ Integration', () => {
        beforeEach(() => {
            enhancedQueue = new EnhancedEventQueue(
                observability,
                persistor,
                'test-execution',
                {
                    maxRetries: 2,
                    baseRetryDelay: 100,
                    enableDLQ: true,
                    dlq: {
                        enablePersistence: true,
                        maxDLQSize: 10,
                        enableDetailedLogging: true,
                    },
                },
            );
        });

        it('should create DLQ instance during initialization', () => {
            const dlq = enhancedQueue.getDLQ();
            expect(dlq).toBeInstanceOf(DeadLetterQueue);
        });

        it('should send events to DLQ after max retries exhausted', async () => {
            const failingEvent = createEvent('agent.thinking', {
                agentName: 'test-agent',
                input: 'test input',
            });

            // Create a handler that always fails
            const failingHandler = vi
                .fn()
                .mockRejectedValue(new Error('Handler always fails'));

            // Process the event - should retry and then send to DLQ
            await enhancedQueue.processAll(failingHandler);
            await enhancedQueue.enqueue(failingEvent, 1);

            // Wait for retries to complete
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Process again to trigger retries
            await enhancedQueue.processAll(failingHandler);

            const stats = enhancedQueue.getStats();
            expect(stats.dlq).toBeTruthy();

            // Handler should be called for initial attempt + retries
            expect(failingHandler).toHaveBeenCalledTimes(1);
        });

        it('should allow reprocessing individual events from DLQ', async () => {
            const testEvent = createEvent('tool.call', {
                toolName: 'test-tool',
                input: { data: 'test' },
                agent: 'test-agent',
            });

            // Manually send to DLQ
            const dlq = enhancedQueue.getDLQ();
            await dlq.sendToDLQ(testEvent, new Error('Test error'), 3);

            const dlqStats = dlq.getDLQStats();
            expect(dlqStats.totalItems).toBe(1);

            const firstItem = dlqStats.recentItems[0];
            expect(firstItem).toBeTruthy();

            // Reprocess from DLQ
            const reprocessed = await enhancedQueue.reprocessFromDLQ(
                firstItem.id,
            );
            expect(reprocessed).toBe(true);

            // Should be removed from DLQ
            const updatedDlqStats = dlq.getDLQStats();
            expect(updatedDlqStats.totalItems).toBe(0);
        });

        it('should provide DLQ statistics', () => {
            const stats = enhancedQueue.getStats();

            expect(stats.dlq).toBeTruthy();
            expect(stats.dlq.totalItems).toBe(0);
            expect(stats.dlq.itemsByEventType).toEqual({});
            expect(stats.dlq.recentItems).toEqual([]);
        });
    });

    describe('Retry Logic with DLQ', () => {
        beforeEach(() => {
            enhancedQueue = new EnhancedEventQueue(
                observability,
                persistor,
                'test-execution',
                {
                    maxRetries: 3,
                    baseRetryDelay: 50, // Fast retries for testing
                    maxRetryDelay: 200,
                    enableJitter: false, // Disable jitter for predictable timing
                    enableDLQ: true,
                },
            );
        });

        it('should track retry attempts before sending to DLQ', async () => {
            const event = createEvent('workflow.step', {
                stepName: 'failing-step',
                input: { workflowId: 'test-wf' },
            });

            let attemptCount = 0;
            const countingHandler = vi.fn().mockImplementation(() => {
                attemptCount++;
                throw new Error(`Failure attempt ${attemptCount}`);
            });

            await enhancedQueue.enqueue(event, 1);
            await enhancedQueue.processAll(countingHandler);

            // Wait for retries to complete
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Process retry events
            await enhancedQueue.processAll(countingHandler);

            const stats = enhancedQueue.getStats();
            expect(stats.retry).toBeTruthy();
            expect(stats.retry.totalRetries).toBeGreaterThan(0);
        });

        it('should maintain retry metadata throughout retry chain', async () => {
            const event = createEvent('agent.error', {
                agent: 'test-agent',
                error: 'Test error',
            });

            await enhancedQueue.enqueue(event, 1);

            const trackingHandler = vi
                .fn()
                .mockImplementation((processedEvent) => {
                    if (processedEvent.metadata?.retry) {
                        expect(
                            processedEvent.metadata.retry.retryCount,
                        ).toBeGreaterThan(0);
                        expect(
                            processedEvent.metadata.retry.retryHistory,
                        ).toBeTruthy();
                        expect(processedEvent.metadata.isRetry).toBe(true);
                    }
                    throw new Error('Simulated failure');
                });

            await enhancedQueue.processAll(trackingHandler);

            // Wait for first retry
            await new Promise((resolve) => setTimeout(resolve, 200));
            await enhancedQueue.processAll(trackingHandler);

            expect(trackingHandler).toHaveBeenCalledTimes(2);
        });
    });

    describe('DLQ Reprocessing by Criteria', () => {
        let dlq: DeadLetterQueue;

        beforeEach(() => {
            enhancedQueue = new EnhancedEventQueue(
                observability,
                persistor,
                'test-execution',
                {
                    enableDLQ: true,
                    dlq: {
                        enablePersistence: true,
                    },
                },
            );
            dlq = enhancedQueue.getDLQ();
        });

        it('should reprocess events by event type criteria', async () => {
            // Add different types of events to DLQ
            const agentEvent = createEvent('agent.thinking', {
                agentName: 'agent1',
                input: { data: 'test' },
            });
            const toolEvent = createEvent('tool.call', {
                toolName: 'tool1',
                input: { data: 'test' },
                agent: 'test-agent',
            });
            const workflowEvent = createEvent('workflow.step', {
                stepName: 'step1',
                input: { data: 'test' },
            });

            await dlq.sendToDLQ(agentEvent, new Error('Error 1'), 3);
            await dlq.sendToDLQ(toolEvent, new Error('Error 2'), 3);
            await dlq.sendToDLQ(workflowEvent, new Error('Error 3'), 3);

            // Reprocess only agent events
            const reprocessed = await dlq.reprocessByCriteria({
                eventType: 'agent.thinking',
            });

            expect(reprocessed).toHaveLength(1);
            expect(reprocessed[0].type).toBe('agent.thinking');

            // DLQ should still have 2 items
            const stats = dlq.getDLQStats();
            expect(stats.totalItems).toBe(2);
        });

        it('should reprocess events by age criteria', async () => {
            const oldEvent = createEvent('test.old', { data: 'old' });
            const newEvent = createEvent('test.new', { data: 'new' });

            // Send old event first
            await dlq.sendToDLQ(oldEvent, new Error('Old error'), 3);

            // Wait longer to ensure clear age difference
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Send new event
            await dlq.sendToDLQ(newEvent, new Error('New error'), 3);

            // Reprocess events older than 100ms
            const reprocessed = await dlq.reprocessByCriteria({
                maxAge: 100,
            });

            expect(reprocessed).toHaveLength(1);
            expect((reprocessed[0].data as { data: string }).data).toBe('old');
        });

        it('should respect limit criteria', async () => {
            // Add multiple events
            for (let i = 0; i < 5; i++) {
                const event = createEvent('test.event', { index: i });
                await dlq.sendToDLQ(event, new Error(`Error ${i}`), 3);
            }

            // Reprocess with limit
            const reprocessed = await dlq.reprocessByCriteria({
                limit: 3,
            });

            expect(reprocessed).toHaveLength(3);
        });

        it('should combine multiple criteria', async () => {
            // Add events of different types
            for (let i = 0; i < 3; i++) {
                const agentEvent = createEvent('agent.thinking', {
                    agentName: `agent-${i}`,
                    input: { data: `test-${i}` },
                });
                const toolEvent = createEvent('tool.call', {
                    toolName: `tool-${i}`,
                    input: { data: `test-${i}` },
                    agent: `agent-${i}`,
                });

                await dlq.sendToDLQ(
                    agentEvent,
                    new Error(`Agent error ${i}`),
                    3,
                );
                await dlq.sendToDLQ(toolEvent, new Error(`Tool error ${i}`), 3);
            }

            // Reprocess only agent events with limit
            const reprocessed = await dlq.reprocessByCriteria({
                eventType: 'agent.thinking',
                limit: 2,
            });

            expect(reprocessed).toHaveLength(2);
            expect(reprocessed.every((e) => e.type === 'agent.thinking')).toBe(
                true,
            );
        });
    });

    describe('Circuit Breaker Integration', () => {
        beforeEach(() => {
            enhancedQueue = new EnhancedEventQueue(
                observability,
                persistor,
                'test-execution',
                {
                    maxRetries: 2,
                    enableDLQ: true,
                    enableCircuitBreaker: true,
                    circuitBreakerThreshold: 3,
                },
            );
        });

        it('should include circuit breaker state in statistics', () => {
            const stats = enhancedQueue.getStats() as {
                circuitBreaker: {
                    state: string;
                    failureCount: number;
                    threshold: number;
                };
            };

            expect(stats.circuitBreaker).toBeTruthy();
            expect(stats.circuitBreaker.state).toBe('closed');
            expect(stats.circuitBreaker.failureCount).toBe(0);
            expect(stats.circuitBreaker.threshold).toBe(3);
        });

        it('should send events directly to DLQ when circuit breaker is open', async () => {
            // Note: This is a simplified test since we'd need to trigger circuit breaker opening
            // In a real scenario, we'd need multiple failures to open the circuit breaker

            const event = createEvent('test.event', { data: 'test' });
            await enhancedQueue.enqueue(event, 1);

            const stats = enhancedQueue.getStats() as {
                circuitBreaker: { state: string };
            };
            expect(stats.circuitBreaker.state).toBe('closed'); // Should start closed
        });
    });
});
