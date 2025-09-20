import { AutomationStatus } from '@/core/domain/automation/enums/automation-status';

export interface PipelineContext {
    statusInfo: {
        status: AutomationStatus;
        message?: string;
    };
    pipelineVersion: string;
    errors: PipelineError[];
    pipelineMetadata?: {
        pipelineId?: string;
        pipelineName?: string;
        parentPipelineId?: string;
        rootPipelineId?: string;
        [key: string]: any;
    };
}

export interface PipelineError {
    pipelineId?: string;
    stage: string;
    substage?: string;
    error: Error;
    metadata?: any;
}
