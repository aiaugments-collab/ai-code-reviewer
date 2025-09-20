import { createLogger } from '../../observability/index.js';
import {
    DistanceMetric,
    MemoryVector,
    MemoryVectorQuery,
    MemoryVectorSearchResult,
    MemoryVectorStoreOptions,
} from '../types/allTypes.js';

const logger = createLogger('vector-store');

export class VectorStore {
    private vectors: Map<string, MemoryVector> = new Map();
    private options: MemoryVectorStoreOptions;

    constructor(options: MemoryVectorStoreOptions) {
        this.options = {
            distanceMetric: 'cosine',
            ...options,
        };

        logger.info('VectorStore initialized', {
            dimensions: this.options.dimensions,
            distanceMetric: this.options.distanceMetric,
            storageType: this.options.storage?.type ?? 'unknown',
        });
    }

    /**
     * Store a vector
     */
    async store(vector: MemoryVector): Promise<void> {
        // Validate vector dimensions
        if (vector.vector.length !== this.options.dimensions) {
            throw new Error(
                `Vector dimensions mismatch: expected ${this.options.dimensions}, got ${vector.vector.length}`,
            );
        }

        // Normalize vector for cosine similarity
        if (this.options.distanceMetric === 'cosine') {
            vector.vector = this.normalizeVector(vector.vector);
        }

        this.vectors.set(vector.id, vector);

        logger.debug('Vector stored', {
            id: vector.id,
            dimensions: vector.vector.length,
            hasText: !!vector.text,
        });
    }

    /**
     * Search for similar vectors
     */
    async search(
        query: MemoryVectorQuery,
    ): Promise<MemoryVectorSearchResult[]> {
        // Validate query vector dimensions
        if (query.vector.length !== this.options.dimensions) {
            throw new Error(
                `Query vector dimensions mismatch: expected ${this.options.dimensions}, got ${query.vector.length}`,
            );
        }

        // Normalize query vector for cosine similarity
        let queryVector = query.vector;
        if (this.options.distanceMetric === 'cosine') {
            queryVector = this.normalizeVector(queryVector);
        }

        const results: MemoryVectorSearchResult[] = [];

        // Calculate similarity for all vectors
        for (const vector of this.vectors.values()) {
            // Apply filters
            if (query.filter) {
                if (
                    query.filter.entityId &&
                    vector.entityId !== query.filter.entityId
                )
                    continue;
                if (
                    query.filter.sessionId &&
                    vector.sessionId !== query.filter.sessionId
                )
                    continue;
                if (
                    query.filter.tenantId &&
                    vector.tenantId !== query.filter.tenantId
                )
                    continue;
                if (
                    query.filter.contextId &&
                    vector.contextId !== query.filter.contextId
                )
                    continue;

                // Apply metadata filters
                if (query.filter.metadata) {
                    const vectorMetadata = vector.metadata || {};
                    const shouldSkip = Object.entries(
                        query.filter.metadata,
                    ).some(([key, value]) => vectorMetadata[key] !== value);
                    if (shouldSkip) continue;
                }
            }

            // Calculate similarity score
            const score = this.calculateSimilarity(queryVector, vector.vector);

            // Apply minimum score filter
            if (query.minScore && score < query.minScore) {
                continue;
            }

            results.push({
                id: vector.id,
                score,
                vector: vector.vector,
                text: vector.text,
                metadata: vector.metadata,
                timestamp: vector.timestamp,
                entityId: vector.entityId,
                sessionId: vector.sessionId,
                tenantId: vector.tenantId,
                contextId: vector.contextId,
            });
        }

        // Sort by similarity score (descending)
        results.sort((a, b) => b.score - a.score);

        // Apply topK limit
        const topResults = results.slice(0, query.topK);

        logger.debug('Vector search completed', {
            queryText: query.text,
            totalVectors: this.vectors.size,
            resultsCount: topResults.length,
            topScore: topResults[0]?.score || 0,
        });

        return topResults;
    }

    /**
     * Delete a vector
     */
    async delete(id: string): Promise<boolean> {
        const deleted = this.vectors.delete(id);
        if (deleted) {
            logger.debug('Vector deleted', { id });
        }
        return deleted;
    }

    /**
     * Clear all vectors
     */
    async clear(): Promise<void> {
        this.vectors.clear();
        logger.info('Vector store cleared');
    }

    /**
     * Get vector by ID
     */
    async get(id: string): Promise<MemoryVector | null> {
        return this.vectors.get(id) || null;
    }

    /**
     * Get store size
     */
    size(): number {
        return this.vectors.size;
    }

    /**
     * Get vector dimensions
     */
    getDimensions(): number {
        return this.options.dimensions;
    }

    /**
     * Get all vector IDs
     */
    getIds(): string[] {
        return Array.from(this.vectors.keys());
    }

    /**
     * Calculate similarity between two vectors
     */
    private calculateSimilarity(v1: number[], v2: number[]): number {
        const metric = this.options.distanceMetric || 'cosine';

        switch (metric) {
            case 'cosine':
                return this.cosineSimilarity(v1, v2);
            case 'euclidean':
                return this.euclideanSimilarity(v1, v2);
            case 'dot':
                return this.dotProductSimilarity(v1, v2);
            default:
                throw new Error(`Unknown distance metric: ${metric}`);
        }
    }

    /**
     * Cosine similarity calculation
     */
    private cosineSimilarity(v1: number[], v2: number[]): number {
        // For normalized vectors, cosine similarity is just dot product
        const dotProduct = v1.reduce(
            (sum, val, i) => sum + val * (v2[i] ?? 0),
            0,
        );
        return Math.max(0, dotProduct); // Ensure non-negative
    }

    /**
     * Euclidean similarity calculation
     * Converts distance to similarity (higher is more similar)
     */
    private euclideanSimilarity(v1: number[], v2: number[]): number {
        const squaredDistance = v1.reduce(
            (sum, val, i) => sum + Math.pow(val - (v2[i] ?? 0), 2),
            0,
        );
        const distance = Math.sqrt(squaredDistance);

        // Convert distance to similarity (0 to 1, where 1 is most similar)
        return 1 / (1 + distance);
    }

    /**
     * Dot product similarity calculation
     */
    private dotProductSimilarity(v1: number[], v2: number[]): number {
        const dotProduct = v1.reduce(
            (sum, val, i) => sum + val * (v2[i] ?? 0),
            0,
        );

        // Normalize to 0-1 range (assuming vectors are normalized)
        return Math.max(0, Math.min(1, dotProduct));
    }

    /**
     * Normalize vector for cosine similarity
     */
    private normalizeVector(vector: number[]): number[] {
        const magnitude = Math.sqrt(
            vector.reduce((sum, val) => sum + val * val, 0),
        );

        if (magnitude === 0) {
            return vector; // Avoid division by zero
        }

        return vector.map((val) => val / magnitude);
    }

    /**
     * Get vector store statistics
     */
    getStats(): {
        vectorCount: number;
        dimensions: number;
        distanceMetric: DistanceMetric;
        storageType: string;
        averageVectorMagnitude: number;
    } {
        const vectors = Array.from(this.vectors.values());
        const vectorCount = vectors.length;

        // Calculate average vector magnitude
        const averageVectorMagnitude =
            vectorCount > 0
                ? vectors.reduce((sum, v) => {
                      const magnitude = Math.sqrt(
                          v.vector.reduce((s, val) => s + val * val, 0),
                      );
                      return sum + magnitude;
                  }, 0) / vectorCount
                : 0;

        return {
            vectorCount,
            dimensions: this.options.dimensions,
            distanceMetric: this.options.distanceMetric || 'cosine',
            storageType: this.options.storage?.type ?? 'unknown',
            averageVectorMagnitude,
        };
    }
}

/**
 * Utility function to create a vector store with default options
 */
export function createVectorStore(
    dimensions: number = 1536,
    distanceMetric: DistanceMetric = 'cosine',
): VectorStore {
    return new VectorStore({
        dimensions,
        distanceMetric,
        storage: { type: 'memory' },
    });
}

/**
 * Utility function to calculate cosine similarity between two vectors
 */
export function cosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) {
        throw new Error('Vectors must have the same length');
    }

    // Calculate dot product
    const dotProduct = v1.reduce((sum, val, i) => sum + val * (v2[i] ?? 0), 0);

    // Calculate magnitudes
    const magnitude1 = Math.sqrt(v1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(v2.reduce((sum, val) => sum + val * val, 0));

    // Avoid division by zero
    if (magnitude1 === 0 || magnitude2 === 0) {
        return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
}
