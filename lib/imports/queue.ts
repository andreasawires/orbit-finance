import { PgBoss } from "pg-boss";
import { IMPORT_QUEUE, type ImportJobData } from "@/lib/imports/contracts";

const globalForImportQueue = globalThis as unknown as { orbitImportBoss?: Promise<PgBoss> };

export async function getImportQueue() {
  if (!globalForImportQueue.orbitImportBoss) {
    globalForImportQueue.orbitImportBoss = (async () => {
      const boss = new PgBoss({
        connectionString: process.env.DATABASE_URL ?? "postgresql://orbit:orbit@localhost:5433/orbit_finance",
        application_name: "orbit-import-queue",
      });
      boss.on("error", (error) => console.error("Import queue error", error));
      await boss.start();
      const mutableOptions = {
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
        retryDelayMax: 120,
        expireInSeconds: 4 * 60 * 60,
        heartbeatSeconds: 60,
        retentionSeconds: 7 * 24 * 60 * 60,
      } as const;
      await boss.createQueue(IMPORT_QUEUE, {
        policy: "standard",
        ...mutableOptions,
      });
      // createQueue is conflict-do-nothing; update keeps existing installations
      // on the same retry/expiration policy as fresh ones.
      await boss.updateQueue(IMPORT_QUEUE, mutableOptions);
      return boss;
    })().catch((error) => {
      globalForImportQueue.orbitImportBoss = undefined;
      throw error;
    });
  }
  return globalForImportQueue.orbitImportBoss;
}

export async function enqueueImport(batchId: string) {
  const boss = await getImportQueue();
  return boss.send(IMPORT_QUEUE, { batchId } satisfies ImportJobData);
}
