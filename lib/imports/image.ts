import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { importConfig } from "@/lib/imports/config";

const execFileAsync = promisify(execFile);

export async function normalizeImage(inputPath: string, outputPath: string) {
  const image = sharp(inputPath, { limitInputPixels: importConfig.maxImagePixels });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error("Could not determine image dimensions.");
  if (metadata.width * metadata.height > importConfig.maxImagePixels) throw new Error("Image exceeds the decoded pixel limit.");
  const scale = Math.min(1, Math.sqrt(importConfig.maxRenderedPixels / (metadata.width * metadata.height)));
  await image
    .rotate()
    .resize({ width: Math.max(1, Math.floor(metadata.width * scale)), height: Math.max(1, Math.floor(metadata.height * scale)), fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 8 })
    .toFile(outputPath);
}

export async function withRenderedPdfPage<T>(pdfPath: string, page: number, callback: (imagePath: string) => Promise<T>) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "orbit-import-"));
  const prefix = path.join(tempDirectory, "page");
  const renderedPath = `${prefix}.png`;
  const normalizedPath = path.join(tempDirectory, "page-limited.png");
  try {
    await execFileAsync("pdftoppm", [
      "-f", String(page),
      "-l", String(page),
      "-singlefile",
      "-r", "200",
      "-scale-to", "2560",
      "-png",
      pdfPath,
      prefix,
    ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    await normalizeImage(renderedPath, normalizedPath);
    return await callback(normalizedPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown rendering error";
    throw new Error(`Could not render PDF page ${page}: ${detail}`);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
