import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime } from '../../src/runtime/index.js';
import { getObservability } from '../../src/observability/index.js';
import type { WorkflowContext } from '../../src/core/types/workflow-types.js';

describe.sequential('Runtime V2 - EventStore replay', () => {
    let observability = getObservability({ environment: 'test' });
    let context: WorkflowContext;

    beforeEach(() => {
        observability = getObservability({ environment: 'test' });
        context = {
            executionId: 'rt-es',
            tenantId: 't1',
        } as unknown as WorkflowContext;
    });

    it('should not replay processed (acked) events when onlyUnprocessed=true', async () => {
        const runtime = createRuntime(context, observability, {
            queueSize: 100,
            batchSize: 10,
            enableObservability: false,
            enableAcks: true,
            enableEventStore: true,
            eventStoreConfig: { persistorType: 'memory' },
        });

        const processed: string[] = [];
        runtime.on('v2.es.acked', async (ev) => {
            processed.push(ev.id);
        });

        for (let i = 0; i < 3; i++) {
            await runtime.emitAsync('v2.es.acked', { i }, { priority: 1 });
        }

        // process with stats -> auto-ack
        await runtime.process(true);
        expect(processed).toHaveLength(3);

        // replay only unprocessed should return 0 events
        const replayed: string[] = [];
        for await (const batch of runtime.replayEvents!(0, {
            onlyUnprocessed: true,
            batchSize: 10,
        })) {
            for (const ev of batch) replayed.push(ev.id);
        }
        expect(replayed).toHaveLength(0);
    });

    it('should replay events not acked when onlyUnprocessed=true', async () => {
        const runtime = createRuntime(context, observability, {
            queueSize: 100,
            batchSize: 10,
            enableObservability: false,
            enableAcks: false, // do not auto-ack
            enableEventStore: true,
            eventStoreConfig: { persistorType: 'memory' },
        });

        const processed: string[] = [];
        runtime.on('v2.es.unacked', async (ev) => {
            processed.push(ev.id);
        });

        for (let i = 0; i < 3; i++) {
            await runtime.emitAsync('v2.es.unacked', { i }, { priority: 1 });
        }

        // process simple -> no ack
        await runtime.process();
        expect(processed).toHaveLength(3);

        const replayed: string[] = [];
        for await (const batch of runtime.replayEvents!(0, {
            onlyUnprocessed: true,
            batchSize: 10,
        })) {
            for (const ev of batch) replayed.push(ev.id);
        }
        expect(replayed).toHaveLength(3);
    });
});
