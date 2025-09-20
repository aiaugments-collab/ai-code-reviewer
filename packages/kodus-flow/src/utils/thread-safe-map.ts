class SimpleMutex {
    private queue: Array<() => void> = [];
    private locked = false;

    async lock(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (!this.locked) {
                this.locked = true;
                resolve();
            } else {
                this.queue.push(resolve);
            }
        });
    }

    release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) {
                next();
            }
        } else {
            this.locked = false;
        }
    }

    async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
        await this.lock();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

/**
 * Thread-safe Map wrapper for AgentContext.state
 *
 * Drop-in replacement para Map<string, unknown> com thread safety básico
 */
export class ThreadSafeMap<K = string, V = unknown> {
    private map = new Map<K, V>();
    private mutex = new SimpleMutex();

    async get(key: K): Promise<V | undefined> {
        return this.mutex.withLock(() => this.map.get(key));
    }

    async set(key: K, value: V): Promise<this> {
        await this.mutex.withLock(() => {
            this.map.set(key, value);
        });
        return this;
    }

    async has(key: K): Promise<boolean> {
        return this.mutex.withLock(() => this.map.has(key));
    }

    async delete(key: K): Promise<boolean> {
        return this.mutex.withLock(() => this.map.delete(key));
    }

    async clear(): Promise<void> {
        return this.mutex.withLock(() => {
            this.map.clear();
        });
    }

    async size(): Promise<number> {
        return this.mutex.withLock(() => this.map.size);
    }

    async keys(): Promise<K[]> {
        return this.mutex.withLock(() => Array.from(this.map.keys()));
    }

    async values(): Promise<V[]> {
        return this.mutex.withLock(() => Array.from(this.map.values()));
    }

    async entries(): Promise<Array<[K, V]>> {
        return this.mutex.withLock(() => Array.from(this.map.entries()));
    }

    // Métodos síncronos para compatibilidade com código existente
    // ⚠️ ATENÇÃO: Estes métodos NÃO são thread-safe, use apenas para leitura read-only
    getSyncUnsafe(key: K): V | undefined {
        return this.map.get(key);
    }

    setSyncUnsafe(key: K, value: V): this {
        this.map.set(key, value);
        return this;
    }

    hasSyncUnsafe(key: K): boolean {
        return this.map.has(key);
    }

    deleteSyncUnsafe(key: K): boolean {
        return this.map.delete(key);
    }

    clearSyncUnsafe(): void {
        this.map.clear();
    }

    get sizeUnsafe(): number {
        return this.map.size;
    }

    // Método helper para operações batch thread-safe
    async batch<T>(operations: Array<(map: Map<K, V>) => T>): Promise<T[]> {
        return this.mutex.withLock(() => {
            return operations.map((op) => op(this.map));
        });
    }

    // Para debugging - snapshot thread-safe
    async snapshot(): Promise<Map<K, V>> {
        return this.mutex.withLock(() => new Map(this.map));
    }
}

/**
 * Factory function para criar ThreadSafeMap
 */
export function createThreadSafeMap<K = string, V = unknown>(): ThreadSafeMap<
    K,
    V
> {
    return new ThreadSafeMap<K, V>();
}

/**
 * Helper para converter Map normal para ThreadSafeMap
 */
export function wrapMapThreadSafe<K, V>(
    originalMap: Map<K, V>,
): ThreadSafeMap<K, V> {
    const threadSafeMap = new ThreadSafeMap<K, V>();
    // Copia dados do Map original
    for (const [key, value] of originalMap.entries()) {
        threadSafeMap.setSyncUnsafe(key, value);
    }
    return threadSafeMap;
}
