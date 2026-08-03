import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { importConfig } from "@/lib/imports/config";
import { detectFile, type DetectedFile } from "@/lib/imports/file-types";

export type StoredUpload = {
  storageKey: string;
  absolutePath: string;
  byteSize: number;
  sha256: string;
  detected: DetectedFile;
};

const stagingDirectory = () => path.join(importConfig.storagePath, ".staging");
const globalForImportStorage = globalThis as unknown as { orbitImportStorageReady?: Promise<void> };
const storageMarkerName = ".orbit-import-storage";
const storageMarkerContents = "orbit-finance-import-storage-v1\n";
const storedFilename = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:pdf|csv|png|jpg|webp)$/i;

function assertSafeStorageRoot() {
  const root = path.resolve(importConfig.storagePath);
  const cwd = path.resolve(process.cwd());
  const home = path.resolve(homedir());
  const temporaryRoot = path.resolve(tmpdir());
  if (root === path.parse(root).root
    || root === cwd || cwd.startsWith(`${root}${path.sep}`)
    || root === home || home.startsWith(`${root}${path.sep}`)
    || root === temporaryRoot) {
    throw new Error("IMPORT_STORAGE_PATH must be a dedicated child directory, not a filesystem, home, project, or temporary root.");
  }
}

async function adoptOrVerifyStorageRoot() {
  const markerPath = path.join(importConfig.storagePath, storageMarkerName);
  const marker = await readFile(markerPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (marker !== null) {
    if (marker !== storageMarkerContents) throw new Error("IMPORT_STORAGE_PATH has an invalid ownership marker.");
    return;
  }

  // Safely adopt volumes created by earlier Orbit versions only when every
  // existing entry follows the private content-addressed store layout.
  const entries = await readdir(importConfig.storagePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".staging" && entry.isDirectory()) continue;
    if (!entry.isDirectory() || !/^[a-f0-9]{2}$/i.test(entry.name)) {
      throw new Error("IMPORT_STORAGE_PATH is non-empty and is not an Orbit import store.");
    }
    const children = await readdir(path.join(importConfig.storagePath, entry.name), { withFileTypes: true });
    if (children.some((child) => !child.isFile() || !storedFilename.test(child.name))) {
      throw new Error("IMPORT_STORAGE_PATH contains files that do not belong to the Orbit import store.");
    }
  }
  await writeFile(markerPath, storageMarkerContents, { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const createdMarker = await readFile(markerPath, "utf8");
  if (createdMarker !== storageMarkerContents) throw new Error("IMPORT_STORAGE_PATH has an invalid ownership marker.");
}

export function resolveStorageKey(storageKey: string) {
  if (!/^[a-f0-9-]+\/[a-f0-9-]+\.(?:pdf|csv|png|jpg|webp)$/i.test(storageKey)) {
    throw new Error("Invalid import storage key.");
  }
  const resolved = path.resolve(importConfig.storagePath, storageKey);
  if (!resolved.startsWith(`${importConfig.storagePath}${path.sep}`)) throw new Error("Invalid import storage path.");
  return resolved;
}

export async function readStoredFile(storageKey: string) {
  return readFile(resolveStorageKey(storageKey));
}

export function streamStoredFile(storageKey: string) {
  return createReadStream(resolveStorageKey(storageKey));
}

export async function deleteStoredFile(storageKey: string) {
  await unlink(resolveStorageKey(storageKey)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function storeUpload(
  body: ReadableStream<Uint8Array>,
  originalFilename: string,
  declaredMime: string | null,
): Promise<StoredUpload> {
  await ensureStorageReady();
  const stagingPath = path.join(stagingDirectory(), `${randomUUID()}.upload`);
  const output = createWriteStream(stagingPath, { flags: "wx", mode: 0o600 });
  const hash = createHash("sha256");
  const sampleChunks: Buffer[] = [];
  let sampleBytes = 0;
  let byteSize = 0;
  const absoluteCeiling = Math.max(importConfig.maxPdfBytes, importConfig.maxCsvBytes, importConfig.maxImageBytes);

  try {
    const input = Readable.fromWeb(body as never);
    const inspect = new Transform({
      transform(rawChunk: Buffer | Uint8Array, _encoding, callback) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        byteSize += chunk.length;
        if (byteSize > absoluteCeiling) {
          callback(new Error(`File exceeds the ${absoluteCeiling / 1024 / 1024} MiB upload limit.`));
          return;
        }
        if (sampleBytes < 8192) {
          const slice = chunk.subarray(0, Math.min(chunk.length, 8192 - sampleBytes));
          sampleChunks.push(slice);
          sampleBytes += slice.length;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    // pipeline installs error handlers before bytes start flowing and propagates
    // read, transform, disk, and backpressure failures through one promise.
    await pipeline(input, inspect, output);
    if (!byteSize) throw new Error("The uploaded file is empty.");
    const detected = detectFile(Buffer.concat(sampleChunks), originalFilename, declaredMime);
    if (byteSize > detected.maxBytes) throw new Error(`This ${detected.kind} exceeds its ${detected.maxBytes / 1024 / 1024} MiB limit.`);

    const documentId = randomUUID();
    const storageKey = `${documentId.slice(0, 2)}/${documentId}${detected.extension}`;
    const finalPath = resolveStorageKey(storageKey);
    await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
    await rename(stagingPath, finalPath);
    return { storageKey, absolutePath: finalPath, byteSize, sha256: hash.digest("hex"), detected };
  } catch (error) {
    output.destroy();
    await unlink(stagingPath).catch(() => undefined);
    throw error;
  }
}

/** Remove only the private import store's controlled directories. */
export async function clearImportStorage() {
  await ensureStorageReady();
  const marker = await readFile(path.join(importConfig.storagePath, storageMarkerName), "utf8");
  if (marker !== storageMarkerContents) throw new Error("Refusing to clear an unowned import storage directory.");
  const entries = await readdir(importConfig.storagePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".staging" || (entry.isDirectory() && /^[a-f0-9]{2}$/i.test(entry.name))) {
      await rm(path.join(importConfig.storagePath, entry.name), { recursive: true, force: true });
    }
  }
  await mkdir(stagingDirectory(), { recursive: true, mode: 0o700 });
}

export async function ensureStorageReady() {
  globalForImportStorage.orbitImportStorageReady ??= (async () => {
    assertSafeStorageRoot();
    await mkdir(importConfig.storagePath, { recursive: true, mode: 0o700 });
    const info = await stat(importConfig.storagePath);
    if (!info.isDirectory()) throw new Error("IMPORT_STORAGE_PATH must be a directory.");
    await adoptOrVerifyStorageRoot();
    await mkdir(stagingDirectory(), { recursive: true, mode: 0o700 });
    const cutoff = Date.now() - 24 * 60 * 60 * 1_000;
    const entries = await readdir(stagingDirectory(), { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const filename = path.join(stagingDirectory(), entry.name);
      const info = await stat(filename).catch(() => null);
      if (info && info.mtimeMs < cutoff) await unlink(filename).catch(() => undefined);
    }));
  })().catch((error) => {
    globalForImportStorage.orbitImportStorageReady = undefined;
    throw error;
  });
  await globalForImportStorage.orbitImportStorageReady;
}
