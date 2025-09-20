import {
    BaseContext,
    DeltaSnapshot,
    deltaSnapshotSchema,
    ExtendedContext,
    Persistor,
    Snapshot,
    SnapshotOptions,
    snapshotSchema,
    TEvent,
} from '../core/types/allTypes.js';
import {
    getGlobalPersistor as getGlobalPersistorFromFactory,
    setGlobalPersistor as setGlobalPersistorFromFactory,
} from '../persistor/factory.js';
import { IdGenerator } from '../utils/id-generator.js';

function stringifyDeterministic(obj: unknown): string {
    if (obj === null || obj === undefined) {
        return String(obj);
    }

    const type = typeof obj;
    if (type !== 'object') {
        return type === 'string' ? JSON.stringify(obj) : String(obj);
    }

    if (Array.isArray(obj)) {
        const arr = obj.map((item) => stringifyDeterministic(item));
        return `[${arr.join(',')}]`;
    }

    const keys = Object.keys(obj as object).sort();
    const pairs = keys.map((key) => {
        const value = stringifyDeterministic(
            (obj as Record<string, unknown>)[key],
        );
        return `"${key}":${value}`;
    });

    return `{${pairs.join(',')}}`;
}

/**
 * Hashes a value into a 32-bit unsigned integer string using the FNV-1a algorithm.
 * @param value The value to hash.
 * @returns The 32-bit unsigned integer hash as a hex string.
 */
export function stableHash(value: string | number | object): string {
    const str =
        typeof value === 'string' ? value : stringifyDeterministic(value);

    let hash = 0x811c9dc5; // FNV_offset_basis

    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash +=
            (hash << 1) +
            (hash << 4) +
            (hash << 7) +
            (hash << 8) +
            (hash << 24);
    }

    return `00000000${(hash >>> 0).toString(16)}`.slice(-8);
}

/**
 * Creates a snapshot of the current execution context.
 * @param context The base context to snapshot.
 * @param events The events to include in the snapshot.
 * @param state The state to include in the snapshot.
 * @returns A new snapshot object.
 */
export function createSnapshot(
    context: BaseContext,
    events: TEvent[] = [],
    state: unknown = {},
): Snapshot {
    const payload = { events, state };

    const jobId =
        (context as ExtendedContext).jobId || IdGenerator.executionId();
    const xcId = `${context.tenantId}:${jobId}`;

    return {
        xcId,
        ts: Date.now(),
        events,
        state,
        hash: stableHash(payload),
    };
}

/**
 * Creates a snapshot and persists it using the provided persistor.
 * @param context The base context to snapshot.
 * @param persistor The persistor to use for storing the snapshot.
 * @param events The events to include in the snapshot.
 * @param state The state to include in the snapshot.
 * @param options Options for snapshot creation.
 * @returns A promise that resolves to the created snapshot.
 */
export async function createAndPersistSnapshot(
    context: BaseContext,
    persistor: Persistor,
    events: TEvent[] = [],
    state: unknown = {},
    options: SnapshotOptions = {},
): Promise<Snapshot> {
    const snapshot = createSnapshot(context, events, state);

    // Pass options to the persistor for potential delta compression
    await persistor.append(snapshot, options);

    return snapshot;
}

/**
 * Restores the state and events from a snapshot.
 * This function does not create a BaseContext; it only extracts the data.
 * @param snap The snapshot to restore from.
 * @returns An object containing the state and events from the snapshot.
 */
export function restoreSnapshot(snap: Snapshot): {
    state: unknown;
    events: TEvent[];
} {
    validateSnapshot(snap);
    return {
        state: snap.state,
        events: snap.events,
    };
}

/**
 * Validates the structure of a snapshot object.
 * @param snap The snapshot to validate.
 * @throws An error if the snapshot is invalid.
 */
export function validateSnapshot(snap: unknown): asserts snap is Snapshot {
    snapshotSchema.parse(snap);
}

/**
 * Validates a delta snapshot object.
 * @param snap The snapshot to validate.
 * @throws An error if the snapshot is invalid.
 */
export function validateDeltaSnapshot(
    snap: unknown,
): asserts snap is DeltaSnapshot {
    deltaSnapshotSchema.parse(snap);
}

/**
 * Generates a string diff between two snapshots for debugging.
 * @param a The first snapshot.
 * @param b The second snapshot.
 * @returns A string describing the differences.
 */
export function diffSnapshot(a: Snapshot, b: Snapshot): string {
    const diff: string[] = [];
    if (a.hash !== b.hash) {
        diff.push(`- Hash: ${a.hash}\n+ Hash: ${b.hash}`);
    }
    if (a.events.length !== b.events.length) {
        diff.push(`- Events: ${a.events.length}\n+ Events: ${b.events.length}`);
    }
    const stateA = stringifyDeterministic(a.state);
    const stateB = stringifyDeterministic(b.state);
    if (stateA !== stateB) {
        diff.push(`- State: ${stateA}\n+ State: ${stateB}`);
    }

    return diff.join('\n\n');
}

/**
 * Get the global persistor instance
 * @returns The global persistor
 */
export function getPersistor(): Persistor {
    return getGlobalPersistorFromFactory();
}

/**
 * Set the global persistor instance
 * @param persistor The persistor to use
 */
export function setPersistor(persistor: Persistor): void {
    setGlobalPersistorFromFactory(persistor);
}
