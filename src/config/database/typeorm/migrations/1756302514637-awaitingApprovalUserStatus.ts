import { MigrationInterface, QueryRunner } from "typeorm";

export class AwaitingApprovalUserStatus1756302514637 implements MigrationInterface {
    name = 'AwaitingApprovalUserStatus1756302514637'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TYPE "public"."users_status_enum"
            RENAME TO "users_status_enum_old"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."users_status_enum" AS ENUM(
                'active',
                'inactive',
                'pending',
                'awaiting_approval',
                'removed'
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "status" DROP DEFAULT
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "status" TYPE "public"."users_status_enum" USING "status"::"text"::"public"."users_status_enum"
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "status"
            SET DEFAULT 'pending'
        `);
        await queryRunner.query(`
            DROP TYPE "public"."users_status_enum_old"
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."teams_status_enum"
            RENAME TO "teams_status_enum_old"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."teams_status_enum" AS ENUM(
                'active',
                'inactive',
                'pending',
                'awaiting_approval',
                'removed'
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "teams"
            ALTER COLUMN "status" DROP DEFAULT
        `);
        await queryRunner.query(`
            ALTER TABLE "teams"
            ALTER COLUMN "status" TYPE "public"."teams_status_enum" USING "status"::"text"::"public"."teams_status_enum"
        `);
        await queryRunner.query(`
            ALTER TABLE "teams"
            ALTER COLUMN "status"
            SET DEFAULT 'pending'
        `);
        await queryRunner.query(`
            DROP TYPE "public"."teams_status_enum_old"
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TYPE "public"."teams_status_enum_old" AS ENUM('active', 'inactive', 'pending', 'removed')
        `);
        await queryRunner.query(`
            ALTER TABLE "teams"
            ALTER COLUMN "status" DROP DEFAULT
        `);
        await queryRunner.query(`
            ALTER TABLE "teams"
            ALTER COLUMN "status" TYPE "public"."teams_status_enum_old" USING "status"::"text"::"public"."teams_status_enum_old"
        `);
        await queryRunner.query(`
            ALTER TABLE "teams"
            ALTER COLUMN "status"
            SET DEFAULT 'pending'
        `);
        await queryRunner.query(`
            DROP TYPE "public"."teams_status_enum"
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."teams_status_enum_old"
            RENAME TO "teams_status_enum"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."users_status_enum_old" AS ENUM('active', 'inactive', 'pending', 'removed')
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "status" DROP DEFAULT
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "status" TYPE "public"."users_status_enum_old" USING "status"::"text"::"public"."users_status_enum_old"
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "status"
            SET DEFAULT 'pending'
        `);
        await queryRunner.query(`
            DROP TYPE "public"."users_status_enum"
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."users_status_enum_old"
            RENAME TO "users_status_enum"
        `);
    }

}
