/**
 * @file basic-runtime.test.ts
 * @description Testes básicos do Runtime Layer
 */

import { describe, it, expect } from 'vitest';
import { workflowEvent } from '../../src/runtime/index.js';
import { createEvent } from '../../src/core/types/events.js';

describe('Runtime Layer - Basic Functionality', () => {
    it('should create events with proper structure', () => {
        const eventType = 'test.event';
        const eventData = { value: 42 };

        const event1 = createEvent(eventType, eventData);
        const event2 =
            workflowEvent<typeof eventData>(eventType).with(eventData);

        [event1, event2].forEach((evt) => {
            expect(evt.type).toBe(eventType);
            expect(evt.data).toEqual(eventData);
            expect(evt.ts).toBeDefined();
            expect(typeof evt.ts).toBe('number');
        });
    });

    it('should create events without data', () => {
        const eventType = 'simple.event';

        const evt = createEvent(eventType);

        expect(evt.type).toBe(eventType);
        expect(evt.data).toBeUndefined();
        expect(evt.ts).toBeDefined();
        expect(typeof evt.ts).toBe('number');
    });

    it('should create events with different data types', () => {
        const stringEvent = createEvent('string.event', 'hello');
        const numberEvent = createEvent('number.event', 42);
        const objectEvent = createEvent('object.event', { key: 'value' });
        const arrayEvent = createEvent('array.event', [1, 2, 3]);

        expect(stringEvent.data).toBe('hello');
        expect(numberEvent.data).toBe(42);
        expect(objectEvent.data).toEqual({ key: 'value' });
        expect(arrayEvent.data).toEqual([1, 2, 3]);
    });

    it('should have unique timestamps for events created at different times', async () => {
        const event1 = createEvent('first.event');
        await new Promise((resolve) => setTimeout(resolve, 10));
        const event2 = createEvent('second.event');

        expect(event1.ts).toBeLessThan(event2.ts);
    });
});
