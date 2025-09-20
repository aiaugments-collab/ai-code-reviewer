import { CoreModel } from '@/shared/infrastructure/repositories/model/typeOrm';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AutomationExecutionModel } from './automationExecution.model';
import { AutomationStatus } from '@/core/domain/automation/enums/automation-status';

@Entity('code_review_execution')
export class CodeReviewExecutionModel extends CoreModel {
    @ManyToOne(
        () => AutomationExecutionModel,
        (automationExecution) => automationExecution.uuid,
    )
    @JoinColumn({
        name: 'automation_execution_id',
        referencedColumnName: 'uuid',
    })
    automationExecution: AutomationExecutionModel;

    @Column({
        type: 'enum',
        enum: AutomationStatus,
        default: AutomationStatus.PENDING,
    })
    status: AutomationStatus;

    @Column({
        type: 'text',
        nullable: true,
    })
    message?: string;
}
