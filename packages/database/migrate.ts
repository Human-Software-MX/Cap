import path from "node:path";
import { db } from "@cap/database";
import { DrizzleQueryError, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";

import { runOrgIdBackfill } from "./migrations/orgid_backfill.ts";
import { runSpaceMemberRoleBackfill } from "./migrations/space_member_role_backfill.ts";

/**
 * One-time adoption for databases bootstrapped with `db:push` (schema present,
 * no drizzle journal). Such a DB makes drizzle try to re-create existing objects
 * from migration 0000 and fail. Setting `MIGRATION_BASELINE_WHEN` to the `when`
 * (ms) of the last already-applied migration stamps a single baseline row, so
 * drizzle then only runs the genuinely-pending migrations after it. Idempotent:
 * only stamps when `__drizzle_migrations` is empty, so it's safe to leave set
 * (but you can remove the env after the first successful deploy). No history is
 * replayed — avoids intermediate-schema drift.
 */
async function maybeStampBaseline() {
	const raw = process.env.MIGRATION_BASELINE_WHEN;
	if (!raw || !/^\d+$/.test(raw)) return;
	const when = Number(raw);

	await db().execute(
		sql.raw(
			"CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (`id` bigint AUTO_INCREMENT PRIMARY KEY, `hash` text NOT NULL, `created_at` bigint)",
		),
	);
	const result = await db().execute(
		sql.raw("SELECT COUNT(*) AS c FROM `__drizzle_migrations`"),
	);
	// drizzle types execute() as ResultSetHeader (DML); a SELECT actually
	// returns rows at runtime, so go through `unknown`.
	const rows = (Array.isArray(result)
		? result[0]
		: result) as unknown as Array<{
		c: number | bigint;
	}>;
	if (Number(rows?.[0]?.c ?? 0) > 0) return; // already adopted/migrated — do nothing

	await db().execute(
		sql.raw(
			`INSERT INTO \`__drizzle_migrations\` (\`hash\`, \`created_at\`) VALUES ('baseline', ${when})`,
		),
	);
	console.log(
		`💿 Stamped migration baseline at ${when}; drizzle will apply only migrations newer than this.`,
	);
}

async function runMigrate() {
	await migrate(db(), {
		migrationsFolder: path.join(process.cwd(), "/migrations"),
	});
}

function errorIsOrgIdMigration(e: unknown): e is DrizzleQueryError {
	return (
		e instanceof DrizzleQueryError &&
		e.query ===
			"ALTER TABLE `videos` MODIFY COLUMN `orgId` varchar(15) NOT NULL;"
	);
}

export async function migrateDb() {
	await maybeStampBaseline();
	try {
		await runMigrate();
	} catch (e) {
		if (!errorIsOrgIdMigration(e)) throw e;

		console.log("non-null videos.orgId migration failed, running backfill");

		await runOrgIdBackfill();

		try {
			await runMigrate();
		} catch (retryError) {
			if (errorIsOrgIdMigration(retryError)) {
				throw new Error(
					"videos.orgId backfill failed, you will need to manually update the videos.orgId column before attempting to migrate again.",
				);
			}
			throw retryError;
		}
	}

	await runSpaceMemberRoleBackfill();
}
