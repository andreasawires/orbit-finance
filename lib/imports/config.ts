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
  model: process.env.VISION_MODEL ?? "qwen3-vl:4b-instruct",
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, ""),
  modelContext: positiveInteger("VISION_CONTEXT_SIZE", 8192),
  maxModelInputChars: positiveInteger("VISION_MAX_INPUT_CHARS", 24_000),
  modelTimeoutMs: positiveInteger("VISION_TIMEOUT_MS", 120_000),
  workerConcurrency: positiveInteger("IMPORT_WORKER_CONCURRENCY", 1),
} as const;

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
