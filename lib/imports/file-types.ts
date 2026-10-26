import path from "node:path";
import { allowedMimeTypes, importConfig, type ImportFileKind } from "@/lib/imports/config";

export type DetectedFile = {
  kind: ImportFileKind;
  mimeType: keyof typeof allowedMimeTypes;
  extension: string;
  maxBytes: number;
};

function looksLikeCsv(sample: Buffer) {
  if (!sample.length || sample.includes(0)) return false;
  const text = sample.toString("utf8");
  if (/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/u.test(text)) return false;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return [",", ";", "\t"].some((delimiter) => firstLine.includes(delimiter));
}

export function detectFile(sample: Buffer, originalFilename: string, declaredMime?: string | null): DetectedFile {
  const extension = path.extname(originalFilename).toLowerCase();
  if (sample.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { kind: "pdf", mimeType: "application/pdf", extension: ".pdf", maxBytes: importConfig.maxPdfBytes };
  }
  if (sample[0] === 0xff && sample[1] === 0xd8 && sample[2] === 0xff) {
    return { kind: "image", mimeType: "image/jpeg", extension: ".jpg", maxBytes: importConfig.maxImageBytes };
  }
  if (sample.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: "image", mimeType: "image/png", extension: ".png", maxBytes: importConfig.maxImageBytes };
  }
  if (sample.subarray(0, 4).toString("ascii") === "RIFF" && sample.subarray(8, 12).toString("ascii") === "WEBP") {
    return { kind: "image", mimeType: "image/webp", extension: ".webp", maxBytes: importConfig.maxImageBytes };
  }
  if ((extension === ".csv" || declaredMime?.includes("csv") || declaredMime === "text/plain") && looksLikeCsv(sample)) {
    return { kind: "csv", mimeType: "text/csv", extension: ".csv", maxBytes: importConfig.maxCsvBytes };
  }
  throw new Error("Unsupported file. Upload a PDF, CSV, PNG, JPEG, or WebP file.");
}

