import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPrNumberAndRepositoryIdinAutomationExecutionTable1749579680002 implements MigrationInterface {
    name = 'AddPrNumberAndRepositoryIdinAutomationExecutionTable1749579680002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "automation_execution"
            ADD "pullRequestNumber" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "automation_execution"
            ADD "repositoryId" character varying
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "automation_execution" DROP COLUMN "repositoryId"
        `);
        await queryRunner.query(`
            ALTER TABLE "automation_execution" DROP COLUMN "pullRequestNumber"
        `);
    }

}
