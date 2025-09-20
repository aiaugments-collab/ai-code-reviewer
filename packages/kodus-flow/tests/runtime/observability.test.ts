/**
 * @file observability.test.ts
 * @description Testes de Observabilidade do Runtime Layer
 */

import { describe, it, expect } from 'vitest';
import { createEvent } from '../../src/core/types/events.js';
import { getObservability } from '../../src/observability/index.js';

describe('Runtime Layer - Observability', () => {
    it('should create events with proper observability metadata', () => {
        const eventType = 'observability.test';
        const eventData = { value: 'test' };

        const event = createEvent(eventType, eventData);

        expect(event.type).toBe(eventType);
        expect(event.data).toEqual(eventData);
        expect(event.ts).toBeDefined();
        expect(typeof event.ts).toBe('number');
        expect(event.ts).toBeGreaterThan(0);
    });

    it('should have consistent timestamps across events', () => {
        const events: Array<{ type: string; ts: number }> = [];
        const baseTime = Date.now();

        // Create multiple events in quick succession
        for (let i = 0; i < 10; i++) {
            const event = createEvent(`event.${i}`, { index: i });
            events.push({ type: event.type, ts: event.ts });
        }

        // All events should have timestamps
        events.forEach((event) => {
            expect(event.ts).toBeDefined();
            expect(event.ts).toBeGreaterThanOrEqual(baseTime);
            expect(event.ts).toBeLessThanOrEqual(Date.now());
        });
    });

    it('should handle observability with different log levels', () => {
        const observability = getObservability();

        // Test that observability system is available
        expect(observability).toBeDefined();
        expect(observability.logger).toBeDefined();

        // Test different log levels
        expect(() => {
            observability.logger.debug('Debug message');
            observability.logger.info('Info message');
            observability.logger.warn('Warning message');
            observability.logger.error('Error message');
        }).not.toThrow();
    });

    it('should create events with traceable IDs', () => {
        const event1 = createEvent('trace.1', { id: 1 });
        const event2 = createEvent('trace.2', { id: 2 });

        // Events should have unique timestamps (even if created very quickly)
        expect(event1.ts).toBeDefined();
        expect(event2.ts).toBeDefined();

        // Events should be traceable through their structure
        expect(event1.type).toBe('trace.1');
        expect(event2.type).toBe('trace.2');
        expect((event1.data as Record<string, unknown>).id).toBe(1);
        expect((event2.data as Record<string, unknown>).id).toBe(2);
    });

    it('should handle observability with structured logging', () => {
        const observability = getObservability();

        // Test structured logging with metadata
        expect(() => {
            observability.logger.info('Structured log', {
                eventType: 'test',
                userId: 'user123',
                action: 'create',
                metadata: {
                    source: 'runtime-test',
                    version: '1.0.0',
                },
            });
        }).not.toThrow();
    });

    it('should create events with performance metrics', () => {
        const startTime = performance.now();

        const event = createEvent('performance.test', {
            metric: 'event_creation_time',
            value: startTime,
        });

        const endTime = performance.now();
        const creationTime = endTime - startTime;

        expect(event.ts).toBeDefined();
        expect(creationTime).toBeLessThan(1); // Should be very fast
        expect((event.data as Record<string, unknown>).metric).toBe(
            'event_creation_time',
        );
    });

    it('should handle observability with error tracking', () => {
        const observability = getObservability();

        // Test error logging
        expect(() => {
            observability.logger.error(
                'Test error',
                new Error('Test error message'),
                {
                    context: 'runtime-test',
                    severity: 'high',
                    user: 'test-user',
                },
            );
        }).not.toThrow();
    });

    it('should create events with correlation IDs', () => {
        const correlationId = 'corr-12345';

        const event = createEvent('correlation.test', {
            correlationId,
            message: 'Test message',
        });

        expect(event.type).toBe('correlation.test');
        // ✅ CORREÇÃO: Verificar correlationId em metadata, não em data
        expect(event.metadata?.correlationId).toBe(correlationId);
        expect((event.data as Record<string, unknown>).message).toBe(
            'Test message',
        );
    });

    it('should handle observability with metrics collection', () => {
        const observability = getObservability();

        // Test metrics collection
        expect(() => {
            // Simulate metrics collection
            const metrics = {
                eventsProcessed: 100,
                averageLatency: 5.2,
                errorRate: 0.01,
                memoryUsage: 1024 * 1024, // 1MB
            };

            observability.logger.info('Metrics collected', metrics);
        }).not.toThrow();
    });

    it('should create events with proper audit trail', () => {
        const auditEvent = createEvent('audit.user.action', {
            userId: 'user123',
            action: 'login',
            timestamp: Date.now(),
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0...',
            success: true,
        });

        expect(auditEvent.type).toBe('audit.user.action');
        expect((auditEvent.data as Record<string, unknown>).userId).toBe(
            'user123',
        );
        expect((auditEvent.data as Record<string, unknown>).action).toBe(
            'login',
        );
        expect((auditEvent.data as Record<string, unknown>).success).toBe(true);
    });

    it('should handle observability with health checks', () => {
        const observability = getObservability();

        // Test health check logging
        expect(() => {
            const healthStatus = {
                status: 'healthy',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: Date.now(),
            };

            observability.logger.info('Health check', healthStatus);
        }).not.toThrow();
    });
});
