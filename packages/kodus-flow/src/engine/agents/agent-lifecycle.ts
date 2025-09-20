import { createLogger } from '../../observability/index.js';
import { EngineError } from '../../core/errors.js';
import {
    agentLifecycleEvents,
    AgentPausePayload,
    AgentRegistryEntry,
    AgentResumePayload,
    AgentSchedulePayload,
    AgentStartPayload,
    AgentStopPayload,
    AnyEvent,
    createEvent,
    EVENT_TYPES,
    ExecutionId,
    isValidStatusTransition,
    LifecycleStats,
    TenantId,
    UNIFIED_STATUS,
} from '../../core/types/allTypes.js';

export class AgentLifecycleHandler {
    private logger = createLogger('agent-lifecycle-handler');
    private agents = new Map<string, AgentRegistryEntry>();
    private stats = {
        totalTransitions: 0,
        totalErrors: 0,
        startTime: Date.now(),
    };

    constructor() {
        this.logger.info('AgentLifecycleHandler initialized');
    }

    /**
     * Handle lifecycle events
     */
    async handleLifecycleEvent(event: AnyEvent): Promise<AnyEvent> {
        try {
            switch (event.type) {
                case 'agent.lifecycle.start':
                    return await this.handleStartAgent(event);
                case 'agent.lifecycle.stop':
                    return await this.handleStopAgent(event);
                case 'agent.lifecycle.pause':
                    return await this.handlePauseAgent(event);
                case 'agent.lifecycle.resume':
                    return await this.handleResumeAgent(event);
                case 'agent.lifecycle.schedule':
                    return await this.handleScheduleAgent(event);
                default:
                    throw new EngineError(
                        'AGENT_ERROR',
                        `Unknown lifecycle operation: ${event.type}`,
                    );
            }
        } catch (error) {
            this.stats.totalErrors++;
            this.logger.error('Lifecycle operation failed', error as Error, {
                eventType: event.type,
                eventData: event.data,
            });

            // Create error event
            const errorEvent = {
                id: `agent-error-${Date.now()}`,
                type: 'agent.lifecycle.error',
                data: {
                    agentName:
                        (event.data as { agentName?: string }).agentName ||
                        'unknown',
                    tenantId:
                        (event.data as { tenantId?: string }).tenantId ||
                        'unknown',
                    operation: event.type,
                    error: (error as Error).message,
                    details: error,
                    timestamp: Date.now(),
                },
                ts: Date.now(),
            };

            throw new EngineError(
                'AGENT_ERROR',
                `Lifecycle operation failed: ${(error as Error).message}`,
                { context: { originalEvent: event, errorEvent } },
            );
        }
    }

    /**
     * Start agent
     */
    private async handleStartAgent(event: AnyEvent): Promise<AnyEvent> {
        const payload = event.data as AgentStartPayload;
        const { agentName, tenantId, config, context } = payload;
        const agentKey = `${tenantId}:${agentName}`;

        this.logger.info('Starting agent', { agentName, tenantId });

        // Check if agent already exists
        const existing = this.agents.get(agentKey);
        if (
            existing &&
            ['running', 'starting', 'pausing', 'resuming'].includes(
                existing.status,
            )
        ) {
            throw new EngineError(
                'AGENT_ERROR',
                `Agent ${agentName} is already ${existing.status}`,
            );
        }

        // Create or update registry entry
        const entry: AgentRegistryEntry = {
            agentName,
            tenantId: tenantId as TenantId,
            status: 'starting',
            startedAt: Date.now(),
            config,
            context,
        };

        this.agents.set(agentKey, entry);

        try {
            // KernelHandler integration - funcionalidades migradas do ExecutionEngine
            entry.executionId =
                `lifecycle-${agentName}-${Date.now()}` as ExecutionId;

            // Transition to running
            await this.transitionStatus(agentKey, 'running');

            this.logger.info('Agent started successfully', {
                agentName,
                tenantId,
                executionId: entry.executionId,
            });

            return agentLifecycleEvents.started({
                agentName,
                tenantId,
                executionId: entry.executionId!,
                status: 'running',
                startedAt: entry.startedAt!,
            });
        } catch (error) {
            await this.transitionStatus(
                agentKey,
                'error',
                (error as Error).message,
            );
            throw error;
        }
    }

    /**
     * Stop agent
     */
    private async handleStopAgent(event: AnyEvent): Promise<AnyEvent> {
        const payload = event.data as AgentStopPayload;
        const { agentName, tenantId, reason, force } = payload;
        const agentKey = `${tenantId}:${agentName}`;

        this.logger.info('Stopping agent', {
            agentName,
            tenantId,
            reason,
            force,
        });

        const entry = this.agents.get(agentKey);
        if (!entry) {
            throw new EngineError(
                'AGENT_ERROR',
                `Agent ${agentName} not found`,
            );
        }

        if (entry.status === 'stopped') {
            this.logger.warn('Agent already stopped', { agentName, tenantId });
            return createEvent(EVENT_TYPES.AGENT_LIFECYCLE_STOPPED, {
                agentName,
                tenantId,
                status: 'stopped',
                stoppedAt: entry.stoppedAt!,
                reason: 'already stopped',
            });
        }

        try {
            await this.transitionStatus(agentKey, 'stopping');

            // Cleanup resources
            if (entry.executionId) {
                // KernelHandler integration - funcionalidades migradas do ExecutionEngine
                entry.executionId = undefined;
            }

            // Clear schedule timer
            if (entry.scheduleTimer) {
                clearTimeout(entry.scheduleTimer);
                entry.scheduleTimer = undefined;
            }

            // Remove from registry
            this.agents.delete(agentKey);

            entry.stoppedAt = Date.now();

            await this.transitionStatus(agentKey, 'stopped');

            this.logger.info('Agent stopped successfully', {
                agentName,
                tenantId,
                reason,
            });

            return createEvent(EVENT_TYPES.AGENT_LIFECYCLE_STOPPED, {
                agentName,
                tenantId,
                status: 'stopped',
                stoppedAt: entry.stoppedAt,
                reason,
            });
        } catch (error) {
            await this.transitionStatus(
                agentKey,
                'error',
                (error as Error).message,
            );
            throw error;
        }
    }

    /**
     * Pause agent
     */
    private async handlePauseAgent(event: AnyEvent): Promise<AnyEvent> {
        const payload = event.data as AgentPausePayload;
        const { agentName, tenantId, reason, saveSnapshot = true } = payload;
        const agentKey = `${tenantId}:${agentName}`;

        this.logger.info('Pausing agent', {
            agentName,
            tenantId,
            reason,
            saveSnapshot,
        });

        const entry = this.agents.get(agentKey);
        if (!entry) {
            throw new EngineError(
                'AGENT_ERROR',
                `Agent ${agentName} not found`,
            );
        }

        if (entry.status !== 'running') {
            throw new EngineError(
                'AGENT_ERROR',
                `Cannot pause agent in status: ${entry.status}`,
            );
        }

        try {
            await this.transitionStatus(agentKey, 'pausing');

            let snapshotId: string | undefined;

            // Save snapshot if requested
            if (saveSnapshot && entry.executionId) {
                // KernelHandler integration - funcionalidades migradas do ExecutionEngine
                entry.snapshotId = `snapshot-${entry.executionId}-${Date.now()}`;
            } else if (saveSnapshot) {
                // Mock snapshot ID for testing
                snapshotId = `snapshot-${agentName}-${Date.now()}`;
                entry.snapshotId = snapshotId;
            }

            entry.pausedAt = Date.now();
            await this.transitionStatus(agentKey, 'paused');

            this.logger.info('Agent paused successfully', {
                agentName,
                tenantId,
                snapshotId,
            });

            return createEvent(EVENT_TYPES.AGENT_LIFECYCLE_PAUSED, {
                agentName,
                tenantId,
                status: 'paused',
                pausedAt: entry.pausedAt,
                snapshotId,
                reason,
            });
        } catch (error) {
            await this.transitionStatus(
                agentKey,
                'error',
                (error as Error).message,
            );
            throw error;
        }
    }

    /**
     * Resume agent
     */
    private async handleResumeAgent(event: AnyEvent): Promise<AnyEvent> {
        const payload = event.data as AgentResumePayload;
        const { agentName, tenantId, snapshotId, context } = payload;
        const agentKey = `${tenantId}:${agentName}`;

        this.logger.info('Resuming agent', { agentName, tenantId, snapshotId });

        const entry = this.agents.get(agentKey);
        if (!entry) {
            throw new EngineError(
                'AGENT_ERROR',
                `Agent ${agentName} not found`,
            );
        }

        if (entry.status !== 'paused') {
            throw new EngineError(
                'AGENT_ERROR',
                `Cannot resume agent in status: ${entry.status}`,
            );
        }

        try {
            await this.transitionStatus(agentKey, 'resuming');

            // Resume from snapshot if provided
            if (entry.executionId && (snapshotId || entry.snapshotId)) {
                const resumeSnapshotId = snapshotId || entry.snapshotId!;
                // KernelHandler integration - funcionalidades migradas do ExecutionEngine
                this.logger.info('Resuming agent from snapshot', {
                    agentName,
                    tenantId,
                    snapshotId: resumeSnapshotId,
                });
            }

            // Update context if provided
            if (context) {
                entry.context = { ...entry.context, ...context };
            }

            entry.pausedAt = undefined;
            await this.transitionStatus(agentKey, 'running');

            this.logger.info('Agent resumed successfully', {
                agentName,
                tenantId,
                snapshotId: snapshotId || entry.snapshotId,
            });

            return createEvent(EVENT_TYPES.AGENT_LIFECYCLE_RESUMED, {
                agentName,
                tenantId,
                status: 'running',
                resumedAt: Date.now(),
                snapshotId: snapshotId || entry.snapshotId,
            });
        } catch (error) {
            await this.transitionStatus(
                agentKey,
                'error',
                (error as Error).message,
            );
            throw error;
        }
    }

    /**
     * Schedule agent
     */
    private async handleScheduleAgent(event: AnyEvent): Promise<AnyEvent> {
        const payload = event.data as AgentSchedulePayload;
        const { agentName, tenantId, schedule, config } = payload;
        const agentKey = `${tenantId}:${agentName}`;

        this.logger.info('Scheduling agent', { agentName, tenantId, schedule });

        // Create or update registry entry
        const entry: AgentRegistryEntry = this.agents.get(agentKey) || {
            agentName,
            tenantId: tenantId as TenantId,
            status: 'stopped',
        };

        entry.scheduleConfig = schedule;
        entry.config = { ...entry.config, ...config };

        // Clear existing timer
        if (entry.scheduleTimer) {
            clearTimeout(entry.scheduleTimer);
        }

        // Setup new timer
        const scheduleTime =
            typeof schedule.schedule === 'number'
                ? schedule.schedule
                : this.parseCronExpression(schedule.schedule);

        entry.scheduleTimer = setTimeout(async () => {
            try {
                await this.executeScheduledAgent(agentKey);
            } catch (error) {
                this.logger.error(
                    'Scheduled agent execution failed',
                    error as Error,
                    {
                        agentName,
                        tenantId,
                    },
                );
            }
        }, scheduleTime - Date.now());

        await this.transitionStatus(agentKey, 'scheduled');
        this.agents.set(agentKey, entry);

        this.logger.info('Agent scheduled successfully', {
            agentName,
            tenantId,
            scheduleTime: new Date(scheduleTime),
        });

        return createEvent(EVENT_TYPES.AGENT_LIFECYCLE_SCHEDULED, {
            agentName,
            tenantId,
            status: 'scheduled',
            scheduleTime,
            scheduleConfig: schedule,
        });
    }

    /**
     * Execute scheduled agent
     */
    private async executeScheduledAgent(agentKey: string): Promise<void> {
        const entry = this.agents.get(agentKey);
        if (!entry) return;

        this.logger.info('Executing scheduled agent', {
            agentName: entry.agentName,
            tenantId: entry.tenantId,
        });

        // Start agent - create event manually since we don't have a specific start event type
        const startEvent = {
            id: `agent-start-${entry.agentName}-${Date.now()}`,
            type: 'agent.lifecycle.start',
            threadId: `lifecycle-${entry.agentName}-${Date.now()}`,
            data: {
                agentName: entry.agentName,
                tenantId: entry.tenantId,
                config: entry.config,
                context: entry.context,
            },
            ts: Date.now(),
        };

        await this.handleStartAgent(startEvent);

        // Setup next execution if repeat is enabled
        if (entry.scheduleConfig?.repeat) {
            await this.handleScheduleAgent({
                id: `agent-schedule-${entry.agentName}-${Date.now()}`,
                type: 'agent.lifecycle.schedule',
                threadId: `lifecycle-${entry.agentName}-${Date.now()}`,
                data: {
                    agentName: entry.agentName,
                    tenantId: entry.tenantId,
                    schedule: entry.scheduleConfig,
                    config: entry.config,
                },
                ts: Date.now(),
            });
        }
    }

    /**
     * Transition agent status with validation
     */
    private async transitionStatus(
        agentKey: string,
        newStatus: string,
        reason?: string,
    ): Promise<void> {
        const entry = this.agents.get(agentKey);
        if (!entry) return;

        const previousStatus = entry.status;

        // Validate transition - map lifecycle status to UnifiedStatus
        const mapToUnifiedStatus = (status: string): string => {
            switch (status) {
                case 'starting':
                    return UNIFIED_STATUS.PENDING;
                case 'running':
                    return UNIFIED_STATUS.EXECUTING;
                case 'stopping':
                    return UNIFIED_STATUS.CANCELLED;
                case 'stopped':
                    return UNIFIED_STATUS.CANCELLED;
                case 'pausing':
                    return UNIFIED_STATUS.PAUSED;
                case 'paused':
                    return UNIFIED_STATUS.PAUSED;
                case 'resuming':
                    return UNIFIED_STATUS.EXECUTING;
                case 'scheduled':
                    return UNIFIED_STATUS.PENDING;
                case 'error':
                    return UNIFIED_STATUS.FAILED;
                default:
                    return status;
            }
        };

        const unifiedFrom = mapToUnifiedStatus(previousStatus) as any;
        const unifiedTo = mapToUnifiedStatus(newStatus) as any;

        if (!isValidStatusTransition(unifiedFrom, unifiedTo)) {
            throw new EngineError(
                'AGENT_ERROR',
                `Invalid status transition from ${previousStatus} to ${newStatus}`,
            );
        }

        // Update status
        entry.status = newStatus;
        if (newStatus === 'error' && reason) {
            entry.error = new Error(reason);
        }

        this.stats.totalTransitions++;

        // Emit status changed event
        const statusEvent = agentLifecycleEvents.statusChanged({
            agentName: entry.agentName,
            tenantId: entry.tenantId,
            fromStatus: previousStatus,
            toStatus: newStatus,
            timestamp: Date.now(),
            reason,
        });

        // Log the status change and emit event
        this.logger.debug('Agent status changed', {
            agentName: entry.agentName,
            tenantId: entry.tenantId,
            from: previousStatus,
            to: newStatus,
            reason,
            eventId: statusEvent.type,
        });
    }

    /**
     * Parse cron expression to next execution time
     * Simplified implementation - in production use a proper cron library
     */
    private parseCronExpression(cronExpr: string): number {
        // Simplified: just handle basic time patterns
        // In production, use node-cron or similar library
        this.logger.warn(
            'Cron parsing not fully implemented, using 1 minute delay',
            {
                expression: cronExpr,
            },
        );
        return Date.now() + 60000; // 1 minute
    }

    /**
     * Get agent status
     */
    getAgentStatus(
        tenantId: string,
        agentName: string,
    ): AgentRegistryEntry | undefined {
        return this.agents.get(`${tenantId}:${agentName}`);
    }

    /**
     * List agents by tenant
     */
    listAgentsByTenant(tenantId: string): AgentRegistryEntry[] {
        return Array.from(this.agents.values()).filter(
            (entry) => entry.tenantId === tenantId,
        );
    }

    /**
     * Get lifecycle statistics
     */
    getStats(): LifecycleStats {
        const agentsByStatus: Record<string, number> = {
            stopped: 0,
            starting: 0,
            running: 0,
            pausing: 0,
            paused: 0,
            resuming: 0,
            stopping: 0,
            scheduled: 0,
            error: 0,
        };

        const agentsByTenant: Record<string, number> = {};

        for (const entry of this.agents.values()) {
            agentsByStatus[entry.status] =
                (agentsByStatus[entry.status] || 0) + 1;
            agentsByTenant[entry.tenantId] =
                (agentsByTenant[entry.tenantId] || 0) + 1;
        }

        return {
            totalAgents: this.agents.size,
            agentsByStatus,
            agentsByTenant,
            totalTransitions: this.stats.totalTransitions,
            totalErrors: this.stats.totalErrors,
            uptime: Date.now() - this.stats.startTime,
        };
    }

    /**
     * Cleanup all agents and resources
     */
    async dispose(): Promise<void> {
        this.logger.info('Disposing AgentLifecycleHandler');

        // Stop all running agents
        for (const [agentKey, entry] of this.agents) {
            if (['running', 'paused', 'scheduled'].includes(entry.status)) {
                try {
                    await this.handleStopAgent({
                        id: `agent-stop-${entry.agentName}-${Date.now()}`,
                        type: 'agent.lifecycle.stop',
                        threadId: `lifecycle-${entry.agentName}-${Date.now()}`,
                        data: {
                            agentName: entry.agentName,
                            tenantId: entry.tenantId,
                            reason: 'Handler disposal',
                            force: true,
                        },
                        ts: Date.now(),
                    });
                } catch (error) {
                    this.logger.error(
                        'Error stopping agent during disposal',
                        error as Error,
                        {
                            agentKey,
                        },
                    );
                }
            }
        }

        this.agents.clear();
        this.logger.info('AgentLifecycleHandler disposed');
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 🛠️ FACTORY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Create agent lifecycle handler
 */
export function createAgentLifecycleHandler(): AgentLifecycleHandler {
    return new AgentLifecycleHandler();
}
