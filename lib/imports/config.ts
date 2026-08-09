import path from "node:path";

const mib = 1024 * 1024;

function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const importConfig = {
  storagePath: path.resolve(process.env.IMPORT_STORAGE_PATH ?? path.join(process.cwd(), "data", "imports")),
  maxPdfBytes: positiveInteger("IMPORT_MAX_PDF_MB", 25) * mib,
  maxCsvBytes: positiveInteger("IMPORT_MAX_CSV_MB", 10) * mib,
  maxImageBytes: positiveInteger("IMPORT_MAX_IMAGE_MB", 10) * mib,
  maxPdfPages: positiveInteger("IMPORT_MAX_PDF_PAGES", 50),
  maxCsvRows: positiveInteger("IMPORT_MAX_CSV_ROWS", 50_000),
  maxCsvColumns: positiveInteger("IMPORT_MAX_CSV_COLUMNS", 100),
  maxImagePixels: positiveInteger("IMPORT_MAX_IMAGE_MEGAPIXELS", 20) * 1_000_000,
  maxRenderedPixels: positiveInteger("IMPORT_MAX_RENDERED_MEGAPIXELS", 4) * 1_000_000,
  maxModelInputChars: positiveInteger("MODEL_MAX_INPUT_CHARS", 24_000),
  modelTimeoutMs: positiveInteger("MODEL_TIMEOUT_MS", 300_000),
  workerConcurrency: positiveInteger("IMPORT_WORKER_CONCURRENCY", 1),
} as const;

export type ModelStructuredOutputMode = "auto" | "json_schema" | "json_object";

export type ModelProviderConfig = {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  structuredOutput: ModelStructuredOutputMode;
  isRemote: boolean;
};

// Docker Compose maps this hostname to the host gateway for the importer
// containers. It is therefore a local endpoint, like loopback, rather than a
// remote provider to which statement data would be disclosed.
const localModelHosts = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to process imports with a model.`);
  return value;
}

export function getModelProviderConfig(): ModelProviderConfig {
  const baseUrlValue = requiredEnvironment("MODEL_BASE_URL");
  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlValue);
  } catch {
    throw new Error("MODEL_BASE_URL must be an absolute HTTP(S) URL ending in /v1.");
  }
  if (!/^https?:$/.test(baseUrl.protocol) || !baseUrl.pathname.replace(/\/$/, "").endsWith("/v1")) {
    throw new Error("MODEL_BASE_URL must be an absolute HTTP(S) URL ending in /v1.");
  }
  if (baseUrl.search || baseUrl.hash || baseUrl.username || baseUrl.password) {
    throw new Error("MODEL_BASE_URL must not include credentials, query parameters, or a fragment.");
  }

  const isRemote = !localModelHosts.has(baseUrl.hostname.toLowerCase());
  if (isRemote && baseUrl.protocol !== "https:") {
    throw new Error("Remote MODEL_BASE_URL endpoints must use HTTPS.");
  }
  if (isRemote && process.env.MODEL_ALLOW_REMOTE?.trim().toLowerCase() !== "true") {
    throw new Error("MODEL_BASE_URL is remote. Set MODEL_ALLOW_REMOTE=true to acknowledge that imports will be sent to this endpoint.");
  }

  const structuredOutput = (process.env.MODEL_STRUCTURED_OUTPUT?.trim().toLowerCase() || "auto") as ModelStructuredOutputMode;
  if (!["auto", "json_schema", "json_object"].includes(structuredOutput)) {
    throw new Error("MODEL_STRUCTURED_OUTPUT must be auto, json_schema, or json_object.");
  }

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    apiKey: process.env.MODEL_API_KEY?.trim() || null,
    model: requiredEnvironment("MODEL_NAME"),
    structuredOutput,
    isRemote,
  };
}

export function isRemoteModelProviderConfigured() {
  const value = process.env.MODEL_BASE_URL?.trim();
  if (!value) return false;
  try {
    return !localModelHosts.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export type ImportFileKind = "pdf" | "csv" | "image";

export const allowedMimeTypes = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/csv": "csv",
  "text/plain": "csv",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
} as const satisfies Record<string, ImportFileKind>;
