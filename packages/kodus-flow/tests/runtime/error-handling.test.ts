/**
 * @file error-handling.test.ts
 * @description Testes de Error Handling do Runtime Layer
 */

import { describe, it, expect } from 'vitest';
import { createEvent } from '../../src/core/types/events.js';

describe('Runtime Layer - Error Handling', () => {
    it('should create event with basic data', () => {
        const eventType = 'test.event';
        const eventData = { value: 'test' };

        const event = createEvent(eventType, eventData);

        expect(event.type).toBe(eventType);
        expect(event.data).toEqual(eventData);
        expect(event.ts).toBeDefined();
    });

    it('should create event without data', () => {
        const eventType = 'test.event';

        const event = createEvent(eventType);

        expect(event.type).toBe(eventType);
        expect(event.data).toBeUndefined();
        expect(event.ts).toBeDefined();
    });

    it('should handle null data', () => {
        const eventType = 'test.event';

        expect(() => {
            createEvent(eventType, null);
        }).not.toThrow();
    });

    it('should handle undefined data', () => {
        const eventType = 'test.event';

        expect(() => {
            createEvent(eventType, undefined);
        }).not.toThrow();
    });

    it('should handle empty string event type', () => {
        expect(() => {
            createEvent('', { test: 'data' });
        }).not.toThrow();
    });

    it('should handle special characters in event type', () => {
        const specialEventTypes = [
            'event.with.dots',
            'event-with-dashes',
            'event_with_underscores',
            'eventWithCamelCase',
            'EVENT_WITH_UPPERCASE',
        ];

        specialEventTypes.forEach((eventType) => {
            expect(() => {
                createEvent(eventType, { test: 'data' });
            }).not.toThrow();
        });
    });
});
