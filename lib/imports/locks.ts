import { Pool } from "pg";

export const IMPORT_STORAGE_ADVISORY_LOCK = "orbit-finance:import-storage";

const globalForImportLocks = globalThis as unknown as { orbitImportLockPool?: Pool };

function getLockPool() {
  globalForImportLocks.orbitImportLockPool ??= new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://orbit:orbit@localhost:5433/orbit_finance",
    application_name: "orbit-import-storage-lock",
    max: 4,
  });
  return globalForImportLocks.orbitImportLockPool;
}

/**
 * Uses a dedicated pool so uploads waiting for the storage barrier cannot
 * exhaust the application's query pool while a lock holder registers a batch.
 */
export async function acquireImportStorageReadLock() {
  const client = await getLockPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock_shared(hashtextextended($1, 0))", [IMPORT_STORAGE_ADVISORY_LOCK]);
  } catch (error) {
    client.release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query("SELECT pg_advisory_unlock_shared(hashtextextended($1, 0))", [IMPORT_STORAGE_ADVISORY_LOCK]);
      client.release();
    } catch (error) {
      client.release(true);
      throw error;
    }
  };
}
