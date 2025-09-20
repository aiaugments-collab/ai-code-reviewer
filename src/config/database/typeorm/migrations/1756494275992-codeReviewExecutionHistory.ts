import { MigrationInterface, QueryRunner } from "typeorm";

export class CodeReviewExecutionHistory1756494275992 implements MigrationInterface {
    name = 'CodeReviewExecutionHistory1756494275992'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TYPE "public"."code_review_execution_status_enum" AS ENUM(
                'pending',
                'in_progress',
                'success',
                'error',
                'skipped'
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "code_review_execution" (
                "uuid" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "createdAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "updatedAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "status" "public"."code_review_execution_status_enum" NOT NULL DEFAULT 'pending',
                "message" text,
                "automation_execution_id" uuid,
                CONSTRAINT "PK_af6ec52dfbe7899f370c374a68b" PRIMARY KEY ("uuid")
            )
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."organization_automation_execution_status_enum"
            RENAME TO "organization_automation_execution_status_enum_old"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."organization_automation_execution_status_enum" AS ENUM(
                'pending',
                'in_progress',
                'success',
                'error',
                'skipped'
            )
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
            CREATE TYPE "public"."automation_execution_status_enum" AS ENUM(
                'pending',
                'in_progress',
                'success',
                'error',
                'skipped'
            )
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
        await queryRunner.query(`
            ALTER TABLE "code_review_execution"
            ADD CONSTRAINT "FK_d69f14dec6454d25968d2586314" FOREIGN KEY ("automation_execution_id") REFERENCES "automation_execution"("uuid") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "code_review_execution" DROP CONSTRAINT "FK_d69f14dec6454d25968d2586314"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."automation_execution_status_enum_old" AS ENUM('error', 'skipped', 'success')
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
            CREATE TYPE "public"."organization_automation_execution_status_enum_old" AS ENUM('error', 'skipped', 'success')
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
        await queryRunner.query(`
            DROP TABLE "code_review_execution"
        `);
        await queryRunner.query(`
            DROP TYPE "public"."code_review_execution_status_enum"
        `);
    }

}
