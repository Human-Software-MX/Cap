// This file is used to run database migrations in the docker builds or other self hosting environments.
// It is not suitable (a.k.a DEADLY) for serverless environments where the server will be restarted on each request.
//

import {
	BucketAlreadyOwnedByYou,
	CreateBucketCommand,
	PutBucketPolicyCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { migrateDb } from "@cap/database/migrate";
import { buildEnv, serverEnv } from "@cap/env";

export async function register() {
	if (process.env.NEXT_PUBLIC_IS_CAP) return;

	console.log("Waiting 5 seconds to run migrations");
	// Function to trigger migrations with retry logic
	const triggerMigrations = async (retryCount = 0, maxRetries = 3) => {
		try {
			await runMigrations();
		} catch (error) {
			console.error(
				`🚨 Error triggering migrations (attempt ${retryCount + 1}):`,
				error,
			);
			if (retryCount < maxRetries - 1) {
				console.log(
					`🔄 Retrying in 5 seconds... (${retryCount + 1}/${maxRetries})`,
				);
				setTimeout(() => triggerMigrations(retryCount + 1, maxRetries), 5000);
			} else {
				console.error(`🚨 All ${maxRetries} migration attempts failed.`);
				process.exit(1); // Exit with error code if all attempts fail
			}
		}
	};
	// Add a timeout to trigger migrations after 5 seconds on server start
	setTimeout(() => triggerMigrations(), 5000);
	setTimeout(() => createS3Bucket(), 5000);
}

async function createS3Bucket() {
	const s3Client = new S3Client({
		endpoint: serverEnv().S3_INTERNAL_ENDPOINT,
		region: serverEnv().CAP_AWS_REGION,
		credentials: {
			accessKeyId: serverEnv().CAP_AWS_ACCESS_KEY ?? "",
			secretAccessKey: serverEnv().CAP_AWS_SECRET_KEY ?? "",
		},
		forcePathStyle: serverEnv().S3_PATH_STYLE,
	});

	await s3Client
		.send(new CreateBucketCommand({ Bucket: serverEnv().CAP_AWS_BUCKET }))
		.then(() => {
			console.log("Created S3 bucket");
			return s3Client.send(
				new PutBucketPolicyCommand({
					Bucket: serverEnv().CAP_AWS_BUCKET,
					Policy: JSON.stringify({
						Version: "2012-10-17",
						Statement: [
							{
								Effect: "Allow",
								Principal: "*",
								Action: ["s3:GetObject"],
								Resource: [`arn:aws:s3:::${serverEnv().CAP_AWS_BUCKET}/*`],
							},
						],
					}),
				}),
			);
		})
		.then(() => {
			console.log("Configured S3 buckeet");
		})
		.catch((e) => {
			if (e instanceof BucketAlreadyOwnedByYou) {
				console.log("Found existing S3 bucket");
				return;
			}
		});
}

async function runMigrations() {
	const isDockerBuild = buildEnv.NEXT_PUBLIC_DOCKER_BUILD === "true";
	if (isDockerBuild) {
		try {
			console.log("🔍 DB migrations triggered");
			console.log("💿 Running DB migrations...");

			await migrateDb();

			console.log("💿 Migrations run successfully!");
		} catch (error) {
			// A DB provisioned outside the drizzle journal (e.g. via `db:push`)
			// makes migrate try to re-create existing objects. That's not fatal —
			// the schema is already present — so continue serving instead of
			// crash-looping the whole app. Genuine failures still throw.
			if (isSchemaAlreadyPresentError(error)) {
				console.warn(
					"⚠️ Migrations report objects already exist; treating schema as up to date and continuing.",
				);
				return;
			}
			console.error("🚨 MIGRATION_FAILED", { error });
			throw error;
		}
	}
}

function isSchemaAlreadyPresentError(error: unknown): boolean {
	const codes = new Set([
		"ER_TABLE_EXISTS_ERROR",
		"ER_DUP_FIELDNAME",
		"ER_DUP_KEYNAME",
		"ER_DUP_ENTRY",
	]);
	const errnos = new Set([1050, 1060, 1061, 1062]);
	let current: unknown = error;
	for (let depth = 0; depth < 6 && current; depth++) {
		const e = current as {
			code?: unknown;
			errno?: unknown;
			message?: unknown;
			cause?: unknown;
		};
		if (typeof e.code === "string" && codes.has(e.code)) return true;
		if (typeof e.errno === "number" && errnos.has(e.errno)) return true;
		if (
			typeof e.message === "string" &&
			/already exists|Duplicate (column|key|entry)/i.test(e.message)
		) {
			return true;
		}
		current = e.cause;
	}
	return false;
}
