import {
    AnyEvent,
    DeltaSnapshot,
    Persistor,
    PersistorStats,
    Snapshot,
    SnapshotOptions,
} from '../core/types/allTypes.js';
import {
    createPersistor as createPersistorFromFactory,
    getGlobalPersistor as getGlobalPersistorFromFactory,
    setGlobalPersistor as setGlobalPersistorFromFactory,
} from '../persistor/factory.js';

function calculateDelta(
    oldData: unknown,
    newData: unknown,
): {
    eventsDelta?: unknown;
    stateDelta?: unknown;
} {
    const result: { eventsDelta?: unknown; stateDelta?: unknown } = {};

    // For events, calculate diff as array operations
    if (Array.isArray(oldData) && Array.isArray(newData)) {
        const eventsAdded = newData.slice(oldData.length);
        if (eventsAdded.length > 0) {
            result.eventsDelta = { added: eventsAdded };
        }
    }

    // For state, calculate a simple diff of changed keys
    if (
        typeof oldData === 'object' &&
        typeof newData === 'object' &&
        oldData &&
        newData
    ) {
        const oldObj = oldData as Record<string, unknown>;
        const newObj = newData as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        const deletions: string[] = [];

        // Find changed/added keys
        for (const key in newObj) {
            if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
                changes[key] = newObj[key];
            }
        }

        // Find deleted keys
        for (const key in oldObj) {
            if (!(key in newObj)) {
                deletions.push(key);
            }
        }

        if (Object.keys(changes).length > 0 || deletions.length > 0) {
            result.stateDelta = { changes, deletions };
        }
    }

    return result;
}

/**
 * Type guard to check if unknown array contains AnyEvent objects
 */
function isEventArray(events: unknown[]): events is AnyEvent[] {
    return events.every(
        (event) =>
            event &&
            typeof event === 'object' &&
            'id' in event &&
            'type' in event &&
            'data' in event &&
            'ts' in event,
    );
}

/**
 * Apply delta to reconstruct full snapshot
 */
function applyDelta(baseSnap: Snapshot, delta: DeltaSnapshot): Snapshot {
    let events = [...baseSnap.events];
    let state =
        typeof baseSnap.state === 'object' && baseSnap.state !== null
            ? { ...(baseSnap.state as Record<string, unknown>) }
            : baseSnap.state;

    // Apply events delta
    if (delta.eventsDelta && typeof delta.eventsDelta === 'object') {
        const eventsDelta = delta.eventsDelta as { added?: unknown[] };
        if (
            eventsDelta.added &&
            Array.isArray(eventsDelta.added) &&
            isEventArray(eventsDelta.added)
        ) {
            events = [...events, ...eventsDelta.added];
        }
    }

    // Apply state delta
    if (delta.stateDelta && typeof delta.stateDelta === 'object') {
        const stateDelta = delta.stateDelta as {
            changes?: Record<string, unknown>;
            deletions?: string[];
        };

        if (stateDelta.changes && typeof state === 'object' && state !== null) {
            state = {
                ...(state as Record<string, unknown>),
                ...stateDelta.changes,
            };
        }

        if (
            stateDelta.deletions &&
            typeof state === 'object' &&
            state !== null
        ) {
            const newState = { ...(state as Record<string, unknown>) };
            for (const key of stateDelta.deletions) {
                delete newState[key];
            }
            state = newState;
        }
    }

    return {
        xcId: delta.xcId,
        ts: delta.ts,
        events,
        state,
        hash: delta.hash,
    };
}

export abstract class BasePersistor implements Persistor {
    /**
     * Save a snapshot
     * @param snap The snapshot to save
     * @param options Options for snapshot persistence
     */
    async append(snap: Snapshot, options?: SnapshotOptions): Promise<void> {
        if (options?.useDelta) {
            // Get the previous snapshot for this execution context
            const prevSnapshots = (await this.listHashes?.(snap.xcId)) || [];
            if (prevSnapshots.length > 0) {
                const prevHash = prevSnapshots[prevSnapshots.length - 1];
                const prevSnap = prevHash
                    ? await this.getByHash?.(prevHash)
                    : null;

                if (prevSnap) {
                    // Calculate deltas
                    const { eventsDelta, stateDelta } = calculateDelta(
                        { events: prevSnap.events, state: prevSnap.state },
                        { events: snap.events, state: snap.state },
                    );

                    // Only create delta if it saves space
                    const deltaSize = JSON.stringify({
                        eventsDelta,
                        stateDelta,
                    }).length;
                    const fullSize = JSON.stringify({
                        events: snap.events,
                        state: snap.state,
                    }).length;

                    if (deltaSize < fullSize * 0.8) {
                        // Only compress if saves at least 20%
                        // Create delta snapshot with non-undefined baseHash
                        if (prevHash) {
                            const deltaSnap: DeltaSnapshot = {
                                xcId: snap.xcId,
                                ts: snap.ts,
                                hash: snap.hash,
                                isDelta: true,
                                baseHash: prevHash,
                                eventsDelta,
                                stateDelta,
                                // Store minimal events/state for compatibility
                                events: [],
                                state: {},
                            };

                            await this.saveSnapshot(deltaSnap);
                            return;
                        }
                    }
                }
            }
        }

        // If delta compression is not possible or not requested, save as full snapshot
        await this.saveSnapshot(snap);
    }

    /**
     * Load snapshots for an execution context
     * @param xcId The execution context ID
     */
    async *load(xcId: string): AsyncIterable<Snapshot> {
        const hashes = (await this.listHashes?.(xcId)) || [];
        for (const hash of hashes) {
            const snap = hash ? await this.getByHash?.(hash) : null;
            if (snap) {
                // If this is a delta snapshot, reconstruct the full snapshot
                if (
                    'isDelta' in snap &&
                    (snap as DeltaSnapshot).isDelta &&
                    (snap as DeltaSnapshot).baseHash
                ) {
                    const deltaSnap = snap as DeltaSnapshot;
                    const baseSnap = deltaSnap.baseHash
                        ? await this.getByHash?.(deltaSnap.baseHash)
                        : null;
                    if (baseSnap) {
                        // Apply delta to base snapshot to reconstruct full snapshot
                        const fullSnap = applyDelta(baseSnap, deltaSnap);
                        yield fullSnap;
                        continue;
                    }
                }

                yield snap;
            }
        }
    }

    /**
     * Check if a snapshot exists
     * @param hash The hash to check
     */
    abstract has(hash: string): Promise<boolean>;

    /**
     * Load a snapshot by hash
     * @param hash The hash of the snapshot to load
     * @returns The snapshot or null if not found
     */
    getByHash?(hash: string): Promise<Snapshot | null>;

    /**
     * List all snapshot hashes for an execution context
     * @param xcId The execution context ID
     * @returns Array of snapshot hashes
     */
    listHashes?(xcId: string): Promise<string[]>;

    /**
     * Get storage statistics
     * @returns Storage statistics
     */
    getStats?(): Promise<PersistorStats>;

    /**
     * Internal method to save a snapshot
     * @param snap The snapshot to save
     */
    protected abstract saveSnapshot(
        snap: Snapshot | DeltaSnapshot,
    ): Promise<void>;
}

/**
 * In-memory persistor implementation
 * Useful for development and testing
 */
export class MemoryPersistor extends BasePersistor {
    private snapshots: Map<string, Snapshot> = new Map();
    private xcIdToHashes: Map<string, string[]> = new Map();

    /**
     * Check if a snapshot exists
     * @param hash The hash to check
     */
    async has(hash: string): Promise<boolean> {
        return this.snapshots.has(hash);
    }

    /**
     * Load a snapshot by hash
     * @param hash The hash of the snapshot to load
     */
    async getByHash(hash: string): Promise<Snapshot | null> {
        return this.snapshots.get(hash) || null;
    }

    /**
     * List all snapshot hashes for an execution context
     * @param xcId The execution context ID
     */
    async listHashes(xcId: string): Promise<string[]> {
        return this.xcIdToHashes.get(xcId) || [];
    }

    /**
     * Get storage statistics
     */
    async getStats(): Promise<PersistorStats> {
        const snapshotCount = this.snapshots.size;
        let totalSize = 0;
        let deltaCount = 0;

        for (const snap of this.snapshots.values()) {
            // Estimate size by stringifying
            const size = JSON.stringify(snap).length;
            totalSize += size;

            // Count delta snapshots
            if ((snap as DeltaSnapshot).isDelta) {
                deltaCount++;
            }
        }

        return {
            snapshotCount,
            totalSizeBytes: totalSize,
            avgSnapshotSizeBytes:
                snapshotCount > 0 ? totalSize / snapshotCount : 0,
            deltaCompressionRatio:
                snapshotCount > 0 ? deltaCount / snapshotCount : 0,
        };
    }

    /**
     * Internal method to save a snapshot
     * @param snap The snapshot to save
     */
    protected async saveSnapshot(
        snap: Snapshot | DeltaSnapshot,
    ): Promise<void> {
        this.snapshots.set(snap.hash, snap);

        // Update xcId to hashes mapping
        const hashes = this.xcIdToHashes.get(snap.xcId) || [];
        hashes.push(snap.hash);
        this.xcIdToHashes.set(snap.xcId, hashes);
    }
}

/**
 * Factory function to create a persistor
 * @param type The type of persistor to create
 * @param options Options for the persistor
 * @returns A persistor instance
 */
export function createPersistor(
    type: 'memory' | 'mongodb' = 'memory',
    options: Record<string, unknown> = {},
): Persistor {
    // Use the unified factory from persistor module
    return createPersistorFromFactory(type, options);
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
