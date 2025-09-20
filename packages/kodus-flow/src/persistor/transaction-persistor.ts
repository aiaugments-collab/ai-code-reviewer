import { BasePersistor } from '../kernel/persistor.js';
import { ConcurrentStateManager } from '../utils/thread-safe-state.js';
import { createLogger } from '../observability/logger.js';
import {
    DeltaSnapshot,
    Persistor,
    PersistorStats,
    Snapshot,
    SnapshotOptions,
    Transaction,
    TransactionOperation,
    TransactionState,
} from '../core/types/allTypes.js';

const logger = createLogger('transaction-persistor');

export class TransactionPersistor extends BasePersistor {
    private readonly basePersistor: Persistor;
    private readonly stateManager: ConcurrentStateManager;
    private readonly transactions = new Map<string, TransactionState>();
    private readonly locks = new Map<string, Promise<void>>();

    constructor(basePersistor: Persistor) {
        super();
        this.basePersistor = basePersistor;
        this.stateManager = new ConcurrentStateManager({
            maxNamespaces: 100,
            maxKeysPerNamespace: 1000,
        });

        logger.info('TransactionPersistor initialized');
    }

    /**
     * Begin a new transaction
     */
    async beginTransaction(): Promise<Transaction> {
        const transactionId = this.generateTransactionId();
        const state: TransactionState = {
            id: transactionId,
            operations: [],
            status: 'pending',
            startTime: Date.now(),
        };

        this.transactions.set(transactionId, state);

        const transaction: Transaction = {
            id: transactionId,
            begin: async () => {
                logger.debug('Transaction begun', { transactionId });
            },
            commit: async () => {
                await this.commitTransaction(transactionId);
            },
            rollback: async () => {
                await this.rollbackTransaction(transactionId);
            },
            addOperation: (op: TransactionOperation) => {
                state.operations.push(op);
            },
        };

        await transaction.begin();
        return transaction;
    }

    /**
     * Commit a transaction
     */
    private async commitTransaction(transactionId: string): Promise<void> {
        const state = this.transactions.get(transactionId);
        if (!state || state.status !== 'pending') {
            throw new Error(`Invalid transaction state: ${transactionId}`);
        }

        // Acquire locks for all affected execution contexts
        const xcIds = new Set<string>();
        for (const op of state.operations) {
            xcIds.add(op.data.xcId);
        }

        await Promise.all(
            Array.from(xcIds).map((xcId) => this.acquireLock(xcId)),
        );

        try {
            // Execute all operations atomically
            for (const op of state.operations) {
                switch (op.type) {
                    case 'save':
                        await this.saveSnapshot(op.data);
                        break;
                    case 'delete':
                        // Implement delete if needed
                        break;
                    case 'update':
                        // Implement update if needed
                        break;
                }
            }

            state.status = 'committed';
            state.endTime = Date.now();

            logger.info('Transaction committed', {
                transactionId,
                operationCount: state.operations.length,
                duration: state.endTime - state.startTime,
            });
        } catch (error) {
            // Rollback on error
            await this.rollbackTransaction(transactionId);
            throw error;
        } finally {
            // Release locks
            for (const xcId of xcIds) {
                this.releaseLock(xcId);
            }
        }
    }

    /**
     * Rollback a transaction
     */
    private async rollbackTransaction(transactionId: string): Promise<void> {
        const state = this.transactions.get(transactionId);
        if (!state) {
            throw new Error(`Transaction not found: ${transactionId}`);
        }

        state.status = 'rolled_back';
        state.endTime = Date.now();

        logger.warn('Transaction rolled back', {
            transactionId,
            operationCount: state.operations.length,
            duration: state.endTime - state.startTime,
        });

        // Clean up transaction state
        this.transactions.delete(transactionId);
    }

    /**
     * Append snapshot with transaction support
     */
    async append(snap: Snapshot, options?: SnapshotOptions): Promise<void> {
        // If no active transaction, create one for this operation
        const transaction = await this.beginTransaction();

        try {
            transaction.addOperation({
                type: 'save',
                data: snap,
                options,
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Check if snapshot exists
     */
    async has(hash: string): Promise<boolean> {
        return this.basePersistor.has(hash);
    }

    /**
     * Get snapshot by hash
     */
    async getByHash(hash: string): Promise<Snapshot | null> {
        return this.basePersistor.getByHash?.(hash) || null;
    }

    /**
     * List snapshot hashes
     */
    async listHashes(xcId: string): Promise<string[]> {
        return this.basePersistor.listHashes?.(xcId) || [];
    }

    /**
     * Get persistor statistics
     */
    async getStats(): Promise<PersistorStats> {
        const baseStats = (await this.basePersistor.getStats?.()) || {
            snapshotCount: 0,
            totalSizeBytes: 0,
            avgSnapshotSizeBytes: 0,
            deltaCompressionRatio: 0,
        };

        // Add transaction stats
        const transactionStats = {
            activeTransactions: this.transactions.size,
            pendingTransactions: Array.from(this.transactions.values()).filter(
                (t) => t.status === 'pending',
            ).length,
        };

        return {
            ...baseStats,
            ...transactionStats,
        };
    }

    /**
     * Save snapshot (internal)
     */
    protected async saveSnapshot(
        snap: Snapshot | DeltaSnapshot,
    ): Promise<void> {
        await this.basePersistor.append(snap);
    }

    /**
     * Acquire lock for execution context
     */
    private async acquireLock(xcId: string): Promise<void> {
        const existingLock = this.locks.get(xcId);
        if (existingLock) {
            await existingLock;
        }

        let resolve: () => void;
        const promise = new Promise<void>((res) => {
            resolve = res;
        });

        this.locks.set(xcId, promise);

        // Resolve on next tick for simple async locking
        process.nextTick(() => {
            resolve();
        });

        await promise;
    }

    /**
     * Release lock for execution context
     */
    private releaseLock(xcId: string): void {
        this.locks.delete(xcId);
    }

    /**
     * Generate unique transaction ID
     */
    private generateTransactionId(): string {
        return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Cleanup resources
     */
    async cleanup(): Promise<void> {
        // Rollback any pending transactions
        for (const [transactionId, state] of this.transactions.entries()) {
            if (state.status === 'pending') {
                await this.rollbackTransaction(transactionId);
            }
        }

        await this.stateManager.cleanup();
        logger.info('TransactionPersistor cleaned up');
    }
}

/**
 * Create transaction-aware persistor
 */
export function createTransactionPersistor(
    basePersistor: Persistor,
): TransactionPersistor {
    return new TransactionPersistor(basePersistor);
}
