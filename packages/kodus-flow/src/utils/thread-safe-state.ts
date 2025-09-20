import { StateManager, StateManagerStats } from '../core/types/allTypes.js';
import { createLogger } from '../observability/index.js';

export class ConcurrentStateManager implements StateManager {
    private readonly states = new Map<string, Map<string, unknown>>();
    private readonly locks = new Map<string, Promise<void>>();
    private readonly logger = createLogger('state-manager');

    // Configuration
    private readonly maxNamespaces: number;
    private readonly maxKeysPerNamespace: number;
    private readonly gcInterval: number;
    private gcTimer?: NodeJS.Timeout;

    constructor(
        options: {
            maxNamespaces?: number;
            maxKeysPerNamespace?: number;
            gcInterval?: number; // Garbage collection interval in ms
        } = {},
    ) {
        this.maxNamespaces = options.maxNamespaces || 1000;
        this.maxKeysPerNamespace = options.maxKeysPerNamespace || 10000;
        this.gcInterval = options.gcInterval || 300000; // 5 minutes

        // Start garbage collection
        this.startGarbageCollection();
    }

    /**
     * Get value from state
     */
    async get<T = unknown>(
        namespace: string,
        key: string,
    ): Promise<T | undefined> {
        await this.acquireLock(namespace);
        try {
            const namespaceMap = this.states.get(namespace);
            return namespaceMap?.get(key) as T | undefined;
        } finally {
            this.releaseLock(namespace);
        }
    }

    /**
     * Set value in state
     */
    async set(namespace: string, key: string, value: unknown): Promise<void> {
        await this.acquireLock(namespace);
        try {
            // Check namespace limit
            if (
                !this.states.has(namespace) &&
                this.states.size >= this.maxNamespaces
            ) {
                throw new StateManagerError(
                    `Maximum namespaces limit reached: ${this.maxNamespaces}`,
                );
            }

            // Get or create namespace
            let namespaceMap = this.states.get(namespace);
            if (!namespaceMap) {
                namespaceMap = new Map();
                this.states.set(namespace, namespaceMap);
            }

            // Check keys per namespace limit
            if (
                !namespaceMap.has(key) &&
                namespaceMap.size >= this.maxKeysPerNamespace
            ) {
                throw new StateManagerError(
                    `Maximum keys per namespace limit reached: ${this.maxKeysPerNamespace}`,
                );
            }

            namespaceMap.set(key, value);

            this.logger.debug('State value set', {
                namespace,
                key,
                valueType: typeof value,
            });
        } finally {
            this.releaseLock(namespace);
        }
    }

    /**
     * Delete value from state
     */
    async delete(namespace: string, key: string): Promise<boolean> {
        await this.acquireLock(namespace);
        try {
            const namespaceMap = this.states.get(namespace);
            if (!namespaceMap) {
                return false;
            }

            const deleted = namespaceMap.delete(key);

            // Clean up empty namespace
            if (namespaceMap.size === 0) {
                this.states.delete(namespace);
            }

            if (deleted) {
                this.logger.debug('State value deleted', { namespace, key });
            }

            return deleted;
        } finally {
            this.releaseLock(namespace);
        }
    }

    /**
     * Clear namespace or all state
     */
    async clear(namespace?: string): Promise<void> {
        if (namespace) {
            await this.acquireLock(namespace);
            try {
                this.states.delete(namespace);
                this.logger.debug('Namespace cleared', { namespace });
            } finally {
                this.releaseLock(namespace);
            }
        } else {
            // Clear all - acquire all locks
            const namespaces = Array.from(this.states.keys());
            await Promise.all(namespaces.map((ns) => this.acquireLock(ns)));
            try {
                this.states.clear();
                this.logger.debug('All state cleared');
            } finally {
                namespaces.forEach((ns) => this.releaseLock(ns));
            }
        }
    }

    /**
     * Check if key exists
     */
    async has(namespace: string, key: string): Promise<boolean> {
        await this.acquireLock(namespace);
        try {
            return this.states.get(namespace)?.has(key) || false;
        } finally {
            this.releaseLock(namespace);
        }
    }

    /**
     * Get all keys in namespace
     */
    async keys(namespace: string): Promise<string[]> {
        await this.acquireLock(namespace);
        try {
            const namespaceMap = this.states.get(namespace);
            return namespaceMap ? Array.from(namespaceMap.keys()) : [];
        } finally {
            this.releaseLock(namespace);
        }
    }

    /**
     * Get size of namespace or total size
     */
    async size(namespace?: string): Promise<number> {
        if (namespace) {
            await this.acquireLock(namespace);
            try {
                return this.states.get(namespace)?.size || 0;
            } finally {
                this.releaseLock(namespace);
            }
        } else {
            // Get total size across all namespaces
            let total = 0;
            const namespaces = Array.from(this.states.keys());
            await Promise.all(namespaces.map((ns) => this.acquireLock(ns)));
            try {
                for (const namespaceMap of this.states.values()) {
                    total += namespaceMap.size;
                }
                return total;
            } finally {
                namespaces.forEach((ns) => this.releaseLock(ns));
            }
        }
    }

    /**
     * Get memory usage statistics
     */
    async getStats(): Promise<StateManagerStats> {
        const namespaces = Array.from(this.states.keys());
        await Promise.all(namespaces.map((ns) => this.acquireLock(ns)));

        try {
            const stats: StateManagerStats = {
                namespaceCount: this.states.size,
                totalKeys: 0,
                memoryUsage: this.estimateMemoryUsage(),
                namespaces: {},
            };

            for (const [namespace, namespaceMap] of this.states.entries()) {
                const keyCount = namespaceMap.size;
                stats.totalKeys += keyCount;
                stats.namespaces[namespace] = {
                    keyCount,
                    estimatedSize: this.estimateNamespaceSize(namespaceMap),
                };
            }

            return stats;
        } finally {
            namespaces.forEach((ns) => this.releaseLock(ns));
        }
    }

    /**
     * Acquire lock for namespace
     */
    private async acquireLock(namespace: string): Promise<void> {
        const existingLock = this.locks.get(namespace);
        if (existingLock) {
            await existingLock;
        }

        let resolve: () => void;
        const promise = new Promise<void>((res) => {
            resolve = res;
        });

        this.locks.set(namespace, promise);

        // For this implementation, we resolve immediately
        // In a real-world scenario, you might want to use a proper mutex library
        // or implement a more sophisticated locking mechanism
        process.nextTick(() => {
            resolve();
        });

        await promise;
    }

    /**
     * Release lock for namespace
     */
    private releaseLock(namespace: string): void {
        this.locks.delete(namespace);
    }

    /**
     * Start garbage collection timer
     */
    private startGarbageCollection(): void {
        this.gcTimer = setInterval(() => {
            this.performGarbageCollection().catch((error) => {
                this.logger.error('Garbage collection failed', error as Error);
            });
        }, this.gcInterval);
    }

    /**
     * Perform garbage collection
     */
    private async performGarbageCollection(): Promise<void> {
        const before = await this.size();
        let cleaned = 0;

        // Clean up empty namespaces
        const emptyNamespaces: string[] = [];
        for (const [namespace, namespaceMap] of this.states.entries()) {
            if (namespaceMap.size === 0) {
                emptyNamespaces.push(namespace);
            }
        }

        for (const namespace of emptyNamespaces) {
            await this.clear(namespace);
            cleaned++;
        }

        if (cleaned > 0) {
            const after = await this.size();
            this.logger.debug('Garbage collection completed', {
                cleanedNamespaces: cleaned,
                beforeSize: before,
                afterSize: after,
            });
        }
    }

    /**
     * Estimate memory usage (rough approximation)
     */
    private estimateMemoryUsage(): number {
        let estimate = 0;

        for (const [namespace, namespaceMap] of this.states.entries()) {
            // Estimate namespace overhead
            estimate += namespace.length * 2; // UTF-16
            estimate += this.estimateNamespaceSize(namespaceMap);
        }

        return estimate;
    }

    /**
     * Estimate size of namespace map
     */
    private estimateNamespaceSize(namespaceMap: Map<string, unknown>): number {
        let estimate = 0;

        for (const [key, value] of namespaceMap.entries()) {
            // Key size
            estimate += key.length * 2; // UTF-16

            // Value size (rough estimate)
            estimate += this.estimateValueSize(value);
        }

        return estimate;
    }

    /**
     * Estimate size of value
     */
    private estimateValueSize(value: unknown): number {
        if (value === null || value === undefined) return 0;
        if (typeof value === 'string') return value.length * 2;
        if (typeof value === 'number') return 8;
        if (typeof value === 'boolean') return 4;
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value).length * 2;
            } catch {
                return 100; // Fallback estimate
            }
        }
        return 50; // Default estimate
    }

    /**
     * Cleanup resources
     */
    async cleanup(): Promise<void> {
        if (this.gcTimer) {
            clearInterval(this.gcTimer);
            this.gcTimer = undefined;
        }

        await this.clear();
        this.logger.debug('State manager cleaned up');
    }
}

export class StateManagerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StateManagerError';
    }
}

/**
 * Simple in-memory state manager for single-threaded environments
 */
export class SimpleStateManager implements StateManager {
    private readonly states = new Map<string, Map<string, unknown>>();

    async get<T = unknown>(
        namespace: string,
        key: string,
    ): Promise<T | undefined> {
        return this.states.get(namespace)?.get(key) as T | undefined;
    }

    async set(namespace: string, key: string, value: unknown): Promise<void> {
        let namespaceMap = this.states.get(namespace);
        if (!namespaceMap) {
            namespaceMap = new Map();
            this.states.set(namespace, namespaceMap);
        }
        namespaceMap.set(key, value);
    }

    async delete(namespace: string, key: string): Promise<boolean> {
        const namespaceMap = this.states.get(namespace);
        if (!namespaceMap) return false;

        const deleted = namespaceMap.delete(key);
        if (namespaceMap.size === 0) {
            this.states.delete(namespace);
        }
        return deleted;
    }

    async clear(namespace?: string): Promise<void> {
        if (namespace) {
            this.states.delete(namespace);
        } else {
            this.states.clear();
        }
    }

    async has(namespace: string, key: string): Promise<boolean> {
        return this.states.get(namespace)?.has(key) || false;
    }

    async keys(namespace: string): Promise<string[]> {
        const namespaceMap = this.states.get(namespace);
        return namespaceMap ? Array.from(namespaceMap.keys()) : [];
    }

    async size(namespace?: string): Promise<number> {
        if (namespace) {
            return this.states.get(namespace)?.size || 0;
        } else {
            let total = 0;
            for (const namespaceMap of this.states.values()) {
                total += namespaceMap.size;
            }
            return total;
        }
    }
}

/**
 * State manager factory
 */
export class StateManagerFactory {
    private static managers = new Map<string, StateManager>();

    /**
     * Create or get state manager
     */
    static getOrCreate(
        name: string,
        type: 'concurrent' | 'simple' = 'concurrent',
        options?: ConstructorParameters<typeof ConcurrentStateManager>[0],
    ): StateManager {
        if (!this.managers.has(name)) {
            const manager =
                type === 'concurrent'
                    ? new ConcurrentStateManager(options)
                    : new SimpleStateManager();
            this.managers.set(name, manager);
        }
        return this.managers.get(name)!;
    }

    /**
     * Remove state manager
     */
    static async remove(name: string): Promise<boolean> {
        const manager = this.managers.get(name);
        if (manager && 'cleanup' in manager) {
            await (manager as ConcurrentStateManager).cleanup();
        }
        return this.managers.delete(name);
    }

    /**
     * Cleanup all state managers
     */
    static async cleanup(): Promise<void> {
        for (const [, manager] of this.managers.entries()) {
            if ('cleanup' in manager) {
                await (manager as ConcurrentStateManager).cleanup();
            }
        }
        this.managers.clear();
    }
}
