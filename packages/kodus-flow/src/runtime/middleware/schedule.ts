import {
    DEFAULT_SCHEDULE_OPTIONS,
    ScheduleOptions,
    TEvent,
} from '../../core/types/allTypes.js';
import { IdGenerator } from '../../utils/id-generator.js';

export function schedule(options: ScheduleOptions) {
    const scheduleOptions: ScheduleOptions = {
        ...DEFAULT_SCHEDULE_OPTIONS,
        ...options,
    };

    // Return a function that sets up the schedule when called
    return function setupSchedule(
        event: TEvent,
        sendEvent: (event: TEvent) => void,
    ): () => void {
        let triggerCount = 0;
        let active = true;

        // Function to emit a scheduled event
        const triggerEvent = () => {
            if (!active) return;

            // Check if we've reached the maximum number of triggers
            if (
                scheduleOptions.maxTriggers !== undefined &&
                triggerCount >= scheduleOptions.maxTriggers
            ) {
                cleanup();
                return;
            }

            // Generate event data if a generator function is provided
            const eventData = scheduleOptions.generateData
                ? scheduleOptions.generateData(triggerCount, event)
                : event.data;

            // Create and send the scheduled event
            const scheduledEvent: TEvent = {
                id: IdGenerator.callId(),
                type: event.type,
                threadId: event.threadId,
                data: eventData,
                ts: Date.now(),
            };

            sendEvent(scheduledEvent);
            triggerCount++;
        };

        // Trigger immediately if specified
        if (scheduleOptions.triggerImmediately) {
            triggerEvent();
        }

        // Set up the interval
        const intervalId = setInterval(
            triggerEvent,
            scheduleOptions.intervalMs,
        );

        // Cleanup function to stop the schedule
        const cleanup = () => {
            if (intervalId) {
                clearInterval(intervalId);
                active = false;
            }
        };

        return cleanup;
    };
}
