import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyPdf, extractPagesMarkdown } from "@firecrawl/pdf-inspector";

// Loads the platform's native pdf-inspector binary, so CI catches a missing build for an OS/arch.
// The fixture has one page of native text and one image-only page.
const pdf = readFileSync(new URL("./fixtures/sample-statement.pdf", import.meta.url));

test("pdf-inspector classifies native-text and scanned pages", () => {
  const classification = classifyPdf(pdf);
  assert.equal(classification.pageCount, 2);
  assert.deepEqual(classification.pagesNeedingOcr, [1]);
});

test("pdf-inspector extracts per-page markdown with OCR flags", () => {
  const { pages } = extractPagesMarkdown(pdf);
  assert.deepEqual(pages.map((page) => [page.page, page.needsOcr]), [[0, false], [1, true]]);
  assert.match(pages[0].markdown, /Coffee Roma/);
  assert.match(pages[0].markdown, /-3\.50/);
});
