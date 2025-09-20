import { MigrationInterface, QueryRunner } from 'typeorm';

export class Rbac1758129060956 implements MigrationInterface {
    name = 'Rbac1758129060956';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "permissions" (
                "uuid" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "createdAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "updatedAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "permissions" jsonb NOT NULL,
                "user_id" uuid,
                CONSTRAINT "REL_03f05d2567b1421a6f294d69f4" UNIQUE ("user_id"),
                CONSTRAINT "PK_82c4b329177eba3db6338f732c5" PRIMARY KEY ("uuid")
            )
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."users_role_enum"
            RENAME TO "users_role_enum_old"
        `);

        await queryRunner.query(`
            CREATE TYPE "public"."users_role_enum" AS ENUM(
                'owner',
                'billing_manager',
                'repo_admin',
                'contributor'
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "role" DROP DEFAULT
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "role" TYPE text
            USING "role"::text
        `);

        await queryRunner.query(`
            UPDATE "users"
            SET "role" = 'contributor'
            WHERE "role" = 'user'
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "role" TYPE "public"."users_role_enum"
            USING "role"::"public"."users_role_enum"
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "role"
            SET DEFAULT 'owner'
        `);

        await queryRunner.query(`
            DROP TYPE "public"."users_role_enum_old"
        `);
        await queryRunner.query(`
            ALTER TABLE "permissions"
            ADD CONSTRAINT "FK_03f05d2567b1421a6f294d69f45" FOREIGN KEY ("user_id") REFERENCES "users"("uuid") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "permissions" DROP CONSTRAINT "FK_03f05d2567b1421a6f294d69f45"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."users_role_enum_old" AS ENUM('owner', 'user')
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "role" DROP DEFAULT
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "role" TYPE "public"."users_role_enum_old" USING "role"::"text"::"public"."users_role_enum_old"
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ALTER COLUMN "role"
            SET DEFAULT 'owner'
        `);
        await queryRunner.query(`
            DROP TYPE "public"."users_role_enum"
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."users_role_enum_old"
            RENAME TO "users_role_enum"
        `);
        await queryRunner.query(`
            DROP TABLE "permissions"
        `);
    }
}
