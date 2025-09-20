import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewAutomationStatus1752667280920 implements MigrationInterface {
    name = 'AddNewAutomationStatus1752667280920'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TYPE "public"."organization_automation_execution_status_enum"
            RENAME TO "organization_automation_execution_status_enum_old"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."organization_automation_execution_status_enum" AS ENUM('success', 'error', 'skipped')
        `);
        await queryRunner.query(`
            ALTER TABLE "organization_automation_execution"
            ALTER COLUMN "status" DROP DEFAULT
        `);
        await queryRunner.query(`
            ALTER TABLE "organization_automation_execution"
            ALTER COLUMN "status" TYPE "public"."organization_automation_execution_status_enum" USING "status"::"text"::"public"."organization_automation_execution_status_enum"
        `);
        await queryRunner.query(`
            ALTER TABLE "organization_automation_execution"
            ALTER COLUMN "status"
            SET DEFAULT 'success'
        `);
        await queryRunner.query(`
            DROP TYPE "public"."organization_automation_execution_status_enum_old"
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."automation_execution_status_enum"
            RENAME TO "automation_execution_status_enum_old"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."automation_execution_status_enum" AS ENUM('success', 'error', 'skipped')
        `);
        await queryRunner.query(`
            ALTER TABLE "automation_execution"
            ALTER COLUMN "status" DROP DEFAULT
        `);
        await queryRunner.query(`
            ALTER TABLE "automation_execution"
            ALTER COLUMN "status" TYPE "public"."automation_execution_status_enum" USING "status"::"text"::"public"."automation_execution_status_enum"
        `);
        await queryRunner.query(`
            ALTER TABLE "automation_execution"
            ALTER COLUMN "status"
            SET DEFAULT 'success'
        `);
        await queryRunner.query(`
            DROP TYPE "public"."automation_execution_status_enum_old"
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TYPE "public"."automation_execution_status_enum_old" AS ENUM('error', 'success')
        `);
        await queryRunner.query(`
            ALTER TABLE "automation_execution"
            ALTER COLUMN "status" DROP DEFAULT
        `);
        await queryRunner.query(`
            ALTER TABLE "automation_execution"
            ALTER COLUMN "status" TYPE "public"."automation_execution_status_enum_old" USING "status"::"text"::"public"."automation_execution_status_enum_old"
        `);
        await queryRunner.query(`
            ALTER TABLE "automation_execution"
            ALTER COLUMN "status"
            SET DEFAULT 'success'
        `);
        await queryRunner.query(`
            DROP TYPE "public"."automation_execution_status_enum"
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."automation_execution_status_enum_old"
            RENAME TO "automation_execution_status_enum"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."organization_automation_execution_status_enum_old" AS ENUM('error', 'success')
        `);
        await queryRunner.query(`
            ALTER TABLE "organization_automation_execution"
            ALTER COLUMN "status" DROP DEFAULT
        `);
        await queryRunner.query(`
            ALTER TABLE "organization_automation_execution"
            ALTER COLUMN "status" TYPE "public"."organization_automation_execution_status_enum_old" USING "status"::"text"::"public"."organization_automation_execution_status_enum_old"
        `);
        await queryRunner.query(`
            ALTER TABLE "organization_automation_execution"
            ALTER COLUMN "status"
            SET DEFAULT 'success'
        `);
        await queryRunner.query(`
            DROP TYPE "public"."organization_automation_execution_status_enum"
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."organization_automation_execution_status_enum_old"
            RENAME TO "organization_automation_execution_status_enum"
        `);
    }

}
