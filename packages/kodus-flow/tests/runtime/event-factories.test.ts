import { describe, it, expect } from 'vitest';
import {
    isEventType,
    isEventTypeGroup,
    extractEventData,
} from '../../src/runtime/core/event-factory.js';
import {
    type EventType,
    type Event,
    createEvent,
} from '../../src/core/types/events.js';

describe('Event Factories', () => {
    describe('createEvent', () => {
        it('should create a basic event with data', () => {
            const event = createEvent('user.created', {
                userId: '123',
                name: 'John',
            });

            expect(event).toBeDefined();
            expect(event.type).toBe('user.created');
            expect(event.data).toEqual({ userId: '123', name: 'John' });
            expect(event.ts).toBeGreaterThan(0);
        });

        it('should create an event without data', () => {
            const event = createEvent('system.heartbeat');

            expect(event).toBeDefined();
            expect(event.type).toBe('system.heartbeat');
            expect(event.data).toBeUndefined();
            expect(event.ts).toBeGreaterThan(0);
        });

        it('should generate unique timestamps for each event', () => {
            const event1 = createEvent('test.1');
            const event2 = createEvent('test.2');

            expect(event1.ts).toBeLessThanOrEqual(event2.ts);
        });

        it('should handle complex data structures', () => {
            const complexData = {
                user: { id: '123', profile: { name: 'John', age: 30 } },
                metadata: { tags: ['test', 'user'], priority: 'high' },
                nested: { deep: { value: 'test' } },
            };

            const event = createEvent('user.complex', complexData);

            expect(event.data).toEqual(complexData);
            expect((event.data as typeof complexData).user.profile.name).toBe(
                'John',
            );
        });

        it('should handle null and undefined data', () => {
            const event1 = createEvent('test.null', null);
            const event2 = createEvent('test.undefined', undefined);

            expect(event1.data).toBeNull();
            expect(event2.data).toBeUndefined();
        });
    });

    describe('isEventType', () => {
        it('should correctly identify event types', () => {
            const userEvent = createEvent('user.created', { userId: '123' });
            const systemErrorEvent = createEvent('system.error', {
                error: 'test',
            });

            expect(isEventType(userEvent, 'user.created')).toBe(true);
            expect(isEventType(userEvent, 'user.updated')).toBe(false);
            expect(isEventType(systemErrorEvent, 'system.error')).toBe(true);
            expect(isEventType(systemErrorEvent, 'system.warning')).toBe(false);
        });

        it('should handle events without data', () => {
            const event = createEvent('test.event');

            expect(isEventType(event, 'test.event')).toBe(true);
            expect(isEventType(event, 'other.event')).toBe(false);
        });
    });

    describe('isEventTypeGroup', () => {
        it('should match event type patterns', () => {
            const userCreatedEvent = createEvent('user.created', {
                userId: '123',
            });
            const userUpdatedEvent = createEvent('user.updated', {
                userId: '123',
            });
            const orderPlacedEvent = createEvent('order.placed', {
                orderId: '456',
            });

            expect(
                isEventTypeGroup(userCreatedEvent, [
                    'user.created',
                    'user.updated',
                ]),
            ).toBe(true);
            expect(
                isEventTypeGroup(userUpdatedEvent, [
                    'user.created',
                    'user.updated',
                ]),
            ).toBe(true);
            expect(
                isEventTypeGroup(orderPlacedEvent, [
                    'user.created',
                    'user.updated',
                ]),
            ).toBe(false);
            expect(isEventTypeGroup(orderPlacedEvent, ['order.placed'])).toBe(
                true,
            );
        });

        it('should handle exact matches', () => {
            const event = createEvent('user.created', { userId: '123' });

            expect(isEventTypeGroup(event, ['user.created'])).toBe(true);
            expect(isEventTypeGroup(event, ['user.updated'])).toBe(false);
        });

        it('should handle nested patterns', () => {
            const event = createEvent('user.profile.updated', {
                userId: '123',
            });

            expect(isEventTypeGroup(event, ['user.profile.updated'])).toBe(
                true,
            );
            expect(isEventTypeGroup(event, ['user.profile.created'])).toBe(
                false,
            );
        });
    });

    describe('extractEventData', () => {
        it('should safely extract event data', () => {
            const event = createEvent('user.created', {
                userId: '123',
                name: 'John',
            });

            const data = extractEventData(event, 'user.created');

            expect(data).toEqual({ userId: '123', name: 'John' });
        });

        it('should handle events without data', () => {
            const event = createEvent('system.heartbeat');

            const data = extractEventData(event, 'system.heartbeat');

            expect(data).toEqual({});
        });

        it('should handle null data', () => {
            const event = createEvent('test.null', null);

            const data = extractEventData(event, 'test.null');

            expect(data).toBeNull();
        });

        it('should handle complex nested data', () => {
            const complexData = {
                user: {
                    id: '123',
                    profile: {
                        name: 'John',
                        preferences: {
                            theme: 'dark',
                            language: 'en',
                        },
                    },
                },
                metadata: {
                    tags: ['test', 'user'],
                    priority: 'high',
                },
            };

            const event = createEvent('user.complex', complexData);
            const data = extractEventData(event, 'user.complex');

            expect(data).toEqual(complexData);
            const theme = (data as typeof complexData).user?.profile
                ?.preferences?.theme;
            expect(theme).toBe('dark');
        });

        it('should handle type mismatches gracefully', () => {
            const event = createEvent('user.created', { userId: '123' });

            // Should not throw even if type doesn't match
            const data = extractEventData(event, 'different.type');

            expect(data).toBeUndefined();
        });
    });

    describe('Timestamp Consistency', () => {
        it('should use consistent timestamps', () => {
            const before = Date.now();
            const event = createEvent('test.event');
            const after = Date.now();

            expect(event.ts).toBeGreaterThanOrEqual(before);
            expect(event.ts).toBeLessThanOrEqual(after);
        });

        it('should have monotonically increasing timestamps', () => {
            const events: Event<EventType>[] = [];
            for (let i = 0; i < 10; i++) {
                events.push(createEvent(`test.${i}`));
            }

            for (let i = 1; i < events.length; i++) {
                expect(events[i].ts).toBeGreaterThanOrEqual(events[i - 1].ts);
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty event types', () => {
            const event = createEvent('', { data: 'test' });

            expect(event.type).toBe('');
            expect(event.data).toEqual({ data: 'test' });
        });

        it('should handle very long event types', () => {
            const longType = 'a'.repeat(1000);
            const event = createEvent(longType, { data: 'test' });

            expect(event.type).toBe(longType);
            expect(event.data).toEqual({ data: 'test' });
        });

        it('should handle special characters in event types', () => {
            const specialType = 'test.event-with-dashes_and_underscores.123';
            const event = createEvent(specialType, { data: 'test' });

            expect(event.type).toBe(specialType);
            expect(event.data).toEqual({ data: 'test' });
        });

        it('should handle unicode characters in event types', () => {
            const unicodeType = 'test.事件.événement.событие';
            const event = createEvent(unicodeType, { data: 'test' });

            expect(event.type).toBe(unicodeType);
            expect(event.data).toEqual({ data: 'test' });
        });

        it('should handle very large data objects', () => {
            const largeData = {
                array: Array.from({ length: 1000 }, (_, i) => ({
                    id: i,
                    value: `item-${i}`,
                })),
                nested: {
                    deep: {
                        very: {
                            nested: {
                                object: { value: 'test' },
                            },
                        },
                    },
                },
            };

            const event = createEvent('test.large', largeData);

            expect(event.data).toEqual(largeData);
            expect((event.data as typeof largeData).array).toHaveLength(1000);
            const nestedObject = (event.data as typeof largeData).nested?.deep
                ?.very?.nested?.object;
            expect(nestedObject?.value).toBe('test');
        });
    });
});
