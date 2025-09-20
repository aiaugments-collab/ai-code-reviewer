import { MongoClient } from 'mongodb';
import { createLogger } from './logger.js';
import {
    MongoDBLogItem,
    MongoDBTelemetryItem,
    MongoDBErrorItem,
    MongoDBMetricsItem,
} from '@/core/types/allTypes.js';

// Interface para a resposta da rastreabilidade
export interface TraceabilityResponse {
    correlationId: string;
    summary: {
        totalLogs: number;
        totalTelemetry: number;
        totalErrors: number;
        totalMetrics: number;
        startTime?: Date;
        endTime?: Date;
        duration?: number;
        status: 'success' | 'error' | 'running';
    };
    timeline: Array<{
        timestamp: Date;
        type: 'log' | 'telemetry' | 'error' | 'metric';
        component?: string;
        message?: string;
        name?: string;
        level?: string;
        duration?: number;
        errorMessage?: string;
        phase?: string;
        agentName?: string;
        toolName?: string;
    }>;
    details: {
        logs: MongoDBLogItem[];
        telemetry: MongoDBTelemetryItem[];
        errors: MongoDBErrorItem[];
        metrics: MongoDBMetricsItem[];
    };
    execution: {
        executionId?: string;
        agentName?: string;
        sessionId?: string;
        tenantId?: string;
        input?: unknown;
        output?: unknown;
        steps?: Array<{
            timestamp: number;
            type: string;
            component: string;
            data: Record<string, unknown>;
        }>;
    };
}

/**
 * Busca toda a rastreabilidade de uma execução baseada no correlationId
 * @param mongoConnectionString - Connection string do MongoDB
 * @param correlationId - ID de correlação da execução
 * @param databaseName - Nome do banco de dados (opcional, padrão: 'kodus-observability')
 * @returns Promise<TraceabilityResponse> - Dados estruturados da execução
 */
export async function getExecutionTraceability(
    mongoConnectionString: string,
    correlationId: string,
    databaseName: string,
): Promise<TraceabilityResponse> {
    const logger = createLogger('traceability');
    let client: MongoClient | null = null;

    try {
        logger.info('🔍 Starting traceability search', {
            correlationId,
            databaseName,
        });

        // Conectar ao MongoDB
        client = new MongoClient(mongoConnectionString);
        await client.connect();

        const db = client.db(databaseName);

        // Buscar dados de todas as collections
        const [logs, telemetry, errors, metrics] = await Promise.all([
            db
                .collection('logs')
                .find({ correlationId })
                .sort({ timestamp: 1 })
                .toArray(),
            db
                .collection('telemetry')
                .find({ correlationId })
                .sort({ timestamp: 1 })
                .toArray(),
            db
                .collection('errors')
                .find({ correlationId })
                .sort({ timestamp: 1 })
                .toArray(),
            db
                .collection('metrics')
                .find({ correlationId })
                .sort({ timestamp: 1 })
                .toArray(),
        ]);

        // Buscar execution tracking se existir
        let executionData: any = {};
        try {
            const executions = await db
                .collection('executions')
                .find({ correlationId })
                .toArray();
            if (executions.length > 0) {
                executionData = executions[0];
            }
        } catch (error) {
            logger.warn('Execution collection not found or error', {
                error: (error as Error).message,
            });
        }

        // Calcular estatísticas
        const allTimestamps = [
            ...logs.map((log: any) => log.timestamp),
            ...telemetry.map((tel: any) => tel.timestamp),
            ...errors.map((err: any) => err.timestamp),
            ...metrics.map((met: any) => met.timestamp),
        ].sort();

        const startTime =
            allTimestamps.length > 0 ? allTimestamps[0] : undefined;
        const endTime =
            allTimestamps.length > 0
                ? allTimestamps[allTimestamps.length - 1]
                : undefined;
        const duration =
            startTime && endTime
                ? endTime.getTime() - startTime.getTime()
                : undefined;

        // Determinar status baseado nos dados
        let status: 'success' | 'error' | 'running' = 'running';
        if (errors.length > 0) {
            status = 'error';
        } else if (executionData.status === 'completed') {
            status = 'success';
        } else if (
            telemetry.some(
                (tel: any) =>
                    tel.name?.includes('agent.execute') && tel.status === 'ok',
            )
        ) {
            status = 'success';
        }

        // Criar timeline ordenada
        const timeline = [
            ...logs.map((log: any) => ({
                timestamp: log.timestamp,
                type: 'log' as const,
                component: log.component,
                message: log.message,
                level: log.level,
            })),
            ...telemetry.map((tel: any) => ({
                timestamp: tel.timestamp,
                type: 'telemetry' as const,
                name: tel.name,
                duration: tel.duration,
                phase: tel.phase,
                agentName: tel.agentName,
                toolName: tel.toolName,
            })),
            ...errors.map((err: any) => ({
                timestamp: err.timestamp,
                type: 'error' as const,
                errorMessage: err.errorMessage,
                component: err.context?.component as string,
            })),
            ...metrics.map((met: any) => ({
                timestamp: met.timestamp,
                type: 'metric' as const,
            })),
        ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // Montar resposta
        const response: TraceabilityResponse = {
            correlationId,
            summary: {
                totalLogs: logs.length,
                totalTelemetry: telemetry.length,
                totalErrors: errors.length,
                totalMetrics: metrics.length,
                startTime,
                endTime,
                duration,
                status,
            },
            timeline,
            details: {
                logs: logs.map((log) => log as unknown as MongoDBLogItem),
                telemetry: telemetry.map(
                    (tel) => tel as unknown as MongoDBTelemetryItem,
                ),
                errors: errors.map((err) => err as unknown as MongoDBErrorItem),
                metrics: metrics.map(
                    (met) => met as unknown as MongoDBMetricsItem,
                ),
            },
            execution: {
                executionId: executionData.executionId,
                agentName: executionData.agentName,
                sessionId: executionData.sessionId,
                tenantId: executionData.tenantId,
                input: executionData.input,
                output: executionData.output,
                steps: executionData.steps,
            },
        };

        logger.info('✅ Traceability search completed', {
            correlationId,
            totalItems: timeline.length,
            status,
            duration,
        });

        return response;
    } catch (error) {
        logger.error('❌ Error during traceability search', error as Error, {
            correlationId,
        });

        // Retornar resposta de erro
        return {
            correlationId,
            summary: {
                totalLogs: 0,
                totalTelemetry: 0,
                totalErrors: 1,
                totalMetrics: 0,
                status: 'error',
            },
            timeline: [
                {
                    timestamp: new Date(),
                    type: 'error',
                    message: `Failed to retrieve traceability: ${(error as Error).message}`,
                },
            ],
            details: {
                logs: [],
                telemetry: [],
                errors: [],
                metrics: [],
            },
            execution: {},
        };
    } finally {
        if (client) {
            await client.close();
        }
    }
}

/**
 * Busca apenas o resumo da execução (mais rápido)
 * @param mongoConnectionString - Connection string do MongoDB
 * @param correlationId - ID de correlação da execução
 * @param databaseName - Nome do banco de dados (opcional)
 * @returns Promise com resumo da execução
 */
export async function getExecutionSummary(
    mongoConnectionString: string,
    correlationId: string,
    databaseName: string,
): Promise<TraceabilityResponse['summary'] & { correlationId: string }> {
    const logger = createLogger('traceability-summary');
    let client: MongoClient | null = null;

    try {
        client = new MongoClient(mongoConnectionString);
        await client.connect();

        const db = client.db(databaseName);

        // Contar documentos em cada collection
        const [totalLogs, totalTelemetry, totalErrors, totalMetrics] =
            await Promise.all([
                db.collection('logs').countDocuments({ correlationId }),
                db.collection('telemetry').countDocuments({ correlationId }),
                db.collection('errors').countDocuments({ correlationId }),
                db.collection('metrics').countDocuments({ correlationId }),
            ]);

        // Buscar primeiro e último timestamp
        const firstDoc = await db
            .collection('telemetry')
            .findOne({ correlationId }, { sort: { timestamp: 1 } });
        const lastDoc = await db
            .collection('telemetry')
            .findOne({ correlationId }, { sort: { timestamp: -1 } });

        const startTime = firstDoc?.timestamp;
        const endTime = lastDoc?.timestamp;
        const duration =
            startTime && endTime
                ? endTime.getTime() - startTime.getTime()
                : undefined;

        // Determinar status
        let status: 'success' | 'error' | 'running' = 'running';
        if (totalErrors > 0) {
            status = 'error';
        } else if (totalTelemetry > 0) {
            status = 'success';
        }

        return {
            correlationId,
            totalLogs,
            totalTelemetry,
            totalErrors,
            totalMetrics,
            startTime,
            endTime,
            duration,
            status,
        };
    } catch (error) {
        logger.error('Error getting execution summary', error as Error, {
            correlationId,
        });
        return {
            correlationId,
            totalLogs: 0,
            totalTelemetry: 0,
            totalErrors: 0,
            totalMetrics: 0,
            status: 'error',
        };
    } finally {
        if (client) {
            await client.close();
        }
    }
}
