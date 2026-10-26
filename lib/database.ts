import { Pool, types } from "pg";

// Return SQL `date` columns as plain "YYYY-MM-DD" strings instead of local-midnight Date objects,
// which shift by a day once serialized with toISOString() on hosts east of UTC.
types.setTypeParser(types.builtins.DATE, (value) => value);

const globalForDatabase = globalThis as unknown as { orbitPool?: Pool };

export const db = globalForDatabase.orbitPool ?? new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://orbit:orbit@localhost:5433/orbit_finance",
  max: 10,
});

if (process.env.NODE_ENV !== "production") globalForDatabase.orbitPool = db;
