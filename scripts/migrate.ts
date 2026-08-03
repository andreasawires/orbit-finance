import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../database/migrations");
const migrationFilename = /^\d{4}_[a-z0-9_]+\.sql$/;
const advisoryLockName = "orbit_finance_schema_migrations";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://orbit:orbit@localhost:5433/orbit_finance",
  max: 1,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [advisoryLockName]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const filenames = (await readdir(migrationDirectory))
      .filter((filename) => migrationFilename.test(filename))
      .sort();

    for (const filename of filenames) {
      const version = filename.slice(0, 4);
      const sql = await readFile(resolve(migrationDirectory, filename), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const applied = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [version],
      );

      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) {
          throw new Error(`Migration ${filename} changed after it was applied.`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [version, checksum],
        );
        await client.query("COMMIT");
        console.log(`Applied ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [advisoryLockName]);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

migrate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
