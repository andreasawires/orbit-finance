import { Pool } from "pg";

const globalForDatabase = globalThis as unknown as { orbitPool?: Pool };

export const db = globalForDatabase.orbitPool ?? new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://orbit:orbit@localhost:5433/orbit_finance",
  max: 10,
});

if (process.env.NODE_ENV !== "production") globalForDatabase.orbitPool = db;
