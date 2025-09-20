import { CoreModel } from '@/shared/infrastructure/repositories/model/typeOrm';
import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { AutomationStatus } from '@/core/domain/automation/enums/automation-status';
import { TeamAutomationModel } from './teamAutomation.model';
import { CodeReviewExecutionModel } from './codeReviewExecution.model';

@Entity('automation_execution')
export class AutomationExecutionModel extends CoreModel {
    @Column({
        type: 'enum',
        enum: AutomationStatus,
        default: AutomationStatus.SUCCESS,
    })
    status: AutomationStatus;

    @Column({ nullable: true })
    errorMessage?: string;

    @Column({ type: 'jsonb', nullable: true })
    dataExecution: any;

    @Column({ nullable: true })
    pullRequestNumber?: number;

    @Column({ nullable: true })
    repositoryId?: string;

    @ManyToOne(
        () => TeamAutomationModel,
        (teamAutomation) => teamAutomation.executions,
    )
    @JoinColumn({ name: 'team_automation_id', referencedColumnName: 'uuid' })
    teamAutomation: TeamAutomationModel;

    @OneToMany(
        () => CodeReviewExecutionModel,
        (codeReviewExecution) => codeReviewExecution.automationExecution,
        {
            nullable: true,
        },
    )
    codeReviewExecutions: CodeReviewExecutionModel[];

    @Column({ nullable: true })
    origin: string;
}
