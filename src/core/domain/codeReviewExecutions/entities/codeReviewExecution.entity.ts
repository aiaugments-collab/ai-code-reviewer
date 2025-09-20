import { Entity } from '@/shared/domain/interfaces/entity';
import { CodeReviewExecution } from '../interfaces/codeReviewExecution.interface';

export class CodeReviewExecutionEntity implements Entity<CodeReviewExecution> {
    private readonly _uuid: CodeReviewExecution['uuid'];
    private readonly _createdAt: CodeReviewExecution['createdAt'];
    private readonly _updatedAt: CodeReviewExecution['updatedAt'];

    private readonly _automationExecution: CodeReviewExecution['automationExecution'];
    private readonly _status: CodeReviewExecution['status'];
    private readonly _message?: CodeReviewExecution['message'];

    constructor(codeReviewExecution: CodeReviewExecution) {
        this._uuid = codeReviewExecution.uuid;
        this._createdAt = codeReviewExecution.createdAt;
        this._updatedAt = codeReviewExecution.updatedAt;
        this._automationExecution = codeReviewExecution.automationExecution;
        this._status = codeReviewExecution.status;
        this._message = codeReviewExecution.message;
    }

    toObject(): CodeReviewExecution {
        return {
            uuid: this.uuid,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            automationExecution: this.automationExecution,
            status: this.status,
            message: this.message,
        };
    }

    toJson(): CodeReviewExecution {
        return this.toObject();
    }

    public static create(
        execution: CodeReviewExecution,
    ): CodeReviewExecutionEntity {
        return new CodeReviewExecutionEntity(execution);
    }

    get uuid(): CodeReviewExecution['uuid'] {
        return this._uuid;
    }

    get createdAt(): CodeReviewExecution['createdAt'] {
        return this._createdAt;
    }

    get updatedAt(): CodeReviewExecution['updatedAt'] {
        return this._updatedAt;
    }

    get automationExecution(): CodeReviewExecution['automationExecution'] {
        return this._automationExecution;
    }

    get status(): CodeReviewExecution['status'] {
        return this._status;
    }

    get message(): CodeReviewExecution['message'] {
        return this._message;
    }
}
