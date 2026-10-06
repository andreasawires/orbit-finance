import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyPdf, extractPagesMarkdown } from "@firecrawl/pdf-inspector";
import { parse } from "csv-parse/sync";
import { importConfig, type ImportFileKind } from "@/lib/imports/config";
import type { CsvMapping, ImportCandidateInput, TransactionCandidate } from "@/lib/imports/contracts";
import { normalizeImage, withRenderedPdfPage } from "@/lib/imports/image";
import { convertWithModel, inferCsvMapping } from "@/lib/imports/model";
import { readStoredFile, resolveStorageKey } from "@/lib/imports/storage";

type ExtractRequest = {
  storageKey: string;
  kind: ImportFileKind;
  accountCurrency: string;
};

type ExtractStage = "converting";

type ExtractResult = {
  pageCount: number | null;
  candidates: ImportCandidateInput[];
  warnings: string[];
};

const knownHeaders = {
  date: ["date", "transaction date", "booking date", "posted date", "value date", "data", "data operazione", "data contabile", "data valuta"],
  description: ["description", "details", "merchant", "payee", "transaction", "memo", "narrative", "causale", "descrizione", "operazione"],
  amount: ["amount", "transaction amount", "value", "importo"],
  debit: ["debit", "dr", "withdrawal", "money out", "addebito", "dare", "uscite"],
  credit: ["credit", "cr", "deposit", "money in", "accredito", "avere", "entrate"],
  currency: ["currency", "ccy", "valuta", "divisa"],
  type: ["type", "direction", "debit/credit", "d/c", "dr/cr", "dare/avere", "transaction type", "tipo"],
} as const;

const normalizeHeader = (value: string) => value.toLocaleLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

function findHeader(headers: string[], aliases: readonly string[]) {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  for (const alias of aliases) {
    const exact = normalized.get(alias);
    if (exact) return exact;
  }
  return null;
}

function inferKnownMapping(headers: string[]): CsvMapping | null {
  const dateColumn = findHeader(headers, knownHeaders.date);
  const descriptionColumn = findHeader(headers, knownHeaders.description);
  const amountColumn = findHeader(headers, knownHeaders.amount);
  const debitColumn = findHeader(headers, knownHeaders.debit);
  const creditColumn = findHeader(headers, knownHeaders.credit);
  if (!dateColumn || !descriptionColumn || (!amountColumn && !debitColumn && !creditColumn)) return null;
  return {
    dateColumn,
    descriptionColumn,
    amountColumn: debitColumn || creditColumn ? null : amountColumn,
    debitColumn,
    creditColumn,
    currencyColumn: findHeader(headers, knownHeaders.currency),
    typeColumn: findHeader(headers, knownHeaders.type),
    dateOrder: "DMY",
    positiveMeans: "income",
  };
}

function detectDelimiter(text: string) {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const choices = [",", ";", "\t"];
  return choices.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
}

function decimalString(rawValue: unknown) {
  let raw = String(rawValue ?? "").trim();
  if (!raw) return null;
  const parentheses = raw.startsWith("(") && raw.endsWith(")");
  raw = raw.replace(/[\s\u00A0'’]/g, "").replace(/[^0-9,.+-]/g, "");
  if (!raw || !/[0-9]/.test(raw)) return null;
  const leadingSign = /^[+-]/.exec(raw)?.[0] ?? "";
  const trailingSign = /[+-]$/.exec(raw)?.[0] ?? "";
  if ((leadingSign && trailingSign) || /[+-]/.test(raw.slice(leadingSign ? 1 : 0, trailingSign ? -1 : undefined))) return null;
  if (leadingSign) raw = raw.slice(1);
  if (trailingSign) raw = raw.slice(0, -1);
  if (!raw || !/^[0-9.,]+$/.test(raw)) return null;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  const decimalSeparator = comma > dot ? "," : dot >= 0 ? "." : null;
  if (decimalSeparator) {
    const separatorIndex = raw.lastIndexOf(decimalSeparator);
    const fractionLength = raw.length - separatorIndex - 1;
    if (fractionLength >= 1 && fractionLength <= 8) {
      const integer = raw.slice(0, separatorIndex).replace(/[.,]/g, "");
      const fraction = raw.slice(separatorIndex + 1).replace(/[.,]/g, "");
      raw = `${integer}.${fraction}`;
    } else raw = raw.replace(/[.,]/g, "");
  }
  const negative = parentheses || leadingSign === "-" || trailingSign === "-";
  const [integerRaw, fraction] = raw.split(".");
  const integer = (integerRaw || "0").replace(/^0+(?=\d)/, "");
  const normalized = `${negative ? "-" : ""}${integer}${fraction !== undefined ? `.${fraction}` : ""}`;
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
}

function negate(value: string) {
  return value.startsWith("-") ? value : `-${value}`;
}

function absolute(value: string) {
  return value.replace(/^-/, "");
}

function isNonZeroDecimal(value: string | null) {
  return value !== null && !/^-?0(?:\.0+)?$/.test(value);
}

function isEmptyAmountCell(value: string) {
  return !value || /^(?:-|–|—|n\/?a)$/i.test(value);
}

type AmountDirection = "expense" | "income";

function amountDirection(rawValue: unknown): AmountDirection | null {
  const raw = normalizeHeader(String(rawValue ?? "")).replace(/[./\\]+/g, " ").trim();
  if (/^(?:d|dr|db|debit|debitore|dare|expense|withdrawal|withdraw|addebito|uscita|payment)$/.test(raw)) return "expense";
  if (/^(?:c|cr|credit|creditore|avere|income|deposit|accredito|entrata)$/.test(raw)) return "income";
  return null;
}

function inlineAmountDirection(rawValue: unknown): AmountDirection | null {
  const raw = String(rawValue ?? "").trim().toLocaleLowerCase();
  if (/(?:^|[^a-z])(?:d|dr|db|debit|dare)$/.test(raw)) return "expense";
  if (/(?:^|[^a-z])(?:c|cr|credit|avere)$/.test(raw)) return "income";
  return null;
}

function parseDate(rawValue: unknown, order: CsvMapping["dateOrder"]) {
  const raw = String(rawValue ?? "").trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const parts = raw.match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})/);
  if (!parts) return raw;
  let year: string;
  let month: string;
  let day: string;
  if (order === "YMD") [year, month, day] = parts.slice(1, 4);
  else if (order === "MDY") [month, day, year] = parts.slice(1, 4);
  else [day, month, year] = parts.slice(1, 4);
  if (year.length === 2) year = `${Number(year) >= 70 ? "19" : "20"}${year}`;
  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function inferDateOrder(rows: Record<string, string>[], dateColumn: string): CsvMapping["dateOrder"] {
  for (const row of rows.slice(0, 100)) {
    const match = String(row[dateColumn] ?? "").trim().match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (match[1].length === 4) return "YMD";
    if (first > 12 && second <= 12) return "DMY";
    if (second > 12 && first <= 12) return "MDY";
  }
  return "DMY";
}

function hasConclusiveDateOrder(rows: Record<string, string>[], dateColumn: string) {
  return rows.slice(0, 100).some((row) => {
    const match = String(row[dateColumn] ?? "").trim().match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/);
    if (!match) return false;
    return match[1].length === 4 || Number(match[1]) > 12 || Number(match[2]) > 12;
  });
}

function isAmbiguousNumericDate(rawValue: unknown) {
  const match = String(rawValue ?? "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\D|$)/);
  return !!match && Number(match[1]) >= 1 && Number(match[1]) <= 12 && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

function currencyCode(rawValue: unknown, accountCurrency: string) {
  const raw = String(rawValue ?? "").trim().toUpperCase();
  return raw || accountCurrency;
}

function rowAmount(row: Record<string, string>, mapping: CsvMapping) {
  const warnings: string[] = [];
  const debitRaw = mapping.debitColumn ? String(row[mapping.debitColumn] ?? "").trim() : "";
  const creditRaw = mapping.creditColumn ? String(row[mapping.creditColumn] ?? "").trim() : "";
  const debit = decimalString(debitRaw);
  const credit = decimalString(creditRaw);
  if (!isEmptyAmountCell(debitRaw) && !debit) warnings.push(`Debit value "${debitRaw.slice(0, 80)}" is not a readable amount.`);
  if (!isEmptyAmountCell(creditRaw) && !credit) warnings.push(`Credit value "${creditRaw.slice(0, 80)}" is not a readable amount.`);
  if (isNonZeroDecimal(debit) && isNonZeroDecimal(credit)) {
    warnings.push("Both debit/Dare and credit/Avere contain non-zero values; the direction is ambiguous.");
    return { amount: null, direction: null, warnings };
  }
  if (isNonZeroDecimal(debit)) return { amount: negate(absolute(debit!)), direction: "expense" as const, warnings };
  if (isNonZeroDecimal(credit)) return { amount: absolute(credit!), direction: "income" as const, warnings };
  if (!mapping.amountColumn) {
    warnings.push("No non-zero debit/Dare or credit/Avere amount was found.");
    return { amount: null, direction: null, warnings };
  }
  const amountRaw = String(row[mapping.amountColumn] ?? "").trim();
  const explicitDirection = mapping.typeColumn ? amountDirection(row[mapping.typeColumn]) : null;
  const markerDirection = inlineAmountDirection(amountRaw);
  if (mapping.typeColumn && String(row[mapping.typeColumn] ?? "").trim() && !explicitDirection) {
    warnings.push(`Type value "${String(row[mapping.typeColumn] ?? "").trim().slice(0, 80)}" is not a recognized D/C, DR/CR, Dare/Avere, income, or expense marker.`);
  }
  if (explicitDirection && markerDirection && explicitDirection !== markerDirection) {
    warnings.push("The type column and amount suffix disagree about debit/credit direction.");
    return { amount: null, direction: null, warnings };
  }
  const direction = explicitDirection ?? markerDirection;
  const amount = decimalString(amountRaw);
  if (!amount || !isNonZeroDecimal(amount)) {
    warnings.push(amountRaw
      ? `Amount value "${amountRaw.slice(0, 80)}" is not a readable non-zero amount.`
      : "Amount is missing.");
    return { amount: null, direction, warnings };
  }
  if (direction === "income" && amount.startsWith("-")) {
    warnings.push("The amount is negative but its D/C or credit marker indicates income; verify the direction.");
    return { amount: null, direction, warnings };
  }
  if (direction === "expense") return { amount: negate(absolute(amount)), direction, warnings };
  if (direction === "income") return { amount: absolute(amount), direction, warnings };
  return {
    amount: mapping.positiveMeans === "expense" && !amount.startsWith("-") ? negate(amount) : amount,
    direction: amount.startsWith("-") || mapping.positiveMeans === "expense" ? "expense" : "income",
    warnings,
  };
}

function evidenceText(headers: string[], row: Record<string, string>, warnings: string[]) {
  const source = headers.map((header) => `${header}: ${row[header] ?? ""}`).join(" | ");
  const warning = warnings.length ? ` | Extraction warning: ${warnings.join(" ")}` : "";
  return `${source}${warning}`.slice(0, 1_000);
}

function normalizeEvidence(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function shortStatementContext(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= 2_000) return normalized;
  const boundary = normalized.lastIndexOf("\n", 2_000);
  return normalized.slice(0, boundary >= 1_000 ? boundary : 2_000);
}

function contextFromFirstPageCandidates(transactions: Array<{
  occurredOn: string;
  currency: string;
  sourceEvidence: string;
}>) {
  return shortStatementContext(transactions.slice(0, 20).map((transaction) => (
    `${transaction.occurredOn} ${transaction.currency}: ${transaction.sourceEvidence}`
  )).join("\n"));
}

async function extractCsv(request: ExtractRequest, onStage?: (stage: ExtractStage) => Promise<void>): Promise<ExtractResult> {
  const buffer = await readStoredFile(request.storageKey);
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);
  const headerRecords = parse(text, {
    bom: true,
    delimiter,
    max_record_size: 256 * 1024,
    skip_empty_lines: true,
    to: 1,
    trim: true,
  }) as string[][];
  const declaredHeaders = headerRecords[0] ?? [];
  if (!declaredHeaders.length) throw new Error("The CSV has no header row.");
  if (declaredHeaders.length > importConfig.maxCsvColumns) {
    throw new Error(`CSV exceeds the ${importConfig.maxCsvColumns} column limit.`);
  }
  if (declaredHeaders.some((header) => !header)) throw new Error("Every CSV column must have a header.");
  if (new Set(declaredHeaders.map(normalizeHeader)).size !== declaredHeaders.length) {
    throw new Error("CSV column headers must be unique.");
  }
  const rows = parse(text, {
    columns: true,
    bom: true,
    delimiter,
    max_record_size: 256 * 1024,
    skip_empty_lines: true,
    to: importConfig.maxCsvRows + 2,
    trim: true,
  }) as Record<string, string>[];
  if (!rows.length) throw new Error("The CSV contains no transaction rows.");
  if (rows.length > importConfig.maxCsvRows) throw new Error(`CSV exceeds the ${importConfig.maxCsvRows.toLocaleString()} row limit.`);
  const headers = Object.keys(rows[0]);
  let mapping = inferKnownMapping(headers);
  let dateOrderConclusive = true;
  let confidence = 0.98;
  if (!mapping) {
    await onStage?.("converting");
    mapping = await inferCsvMapping(headers, rows);
    confidence = 0.86;
  } else {
    dateOrderConclusive = hasConclusiveDateOrder(rows, mapping.dateColumn);
    mapping = { ...mapping, dateOrder: inferDateOrder(rows, mapping.dateColumn) };
  }
  await onStage?.("converting");
  const candidates: ImportCandidateInput[] = [];
  const warnings: string[] = [];
  rows.forEach((row, index) => {
    const amountResult = rowAmount(row, mapping!);
    const occurredOn = parseDate(row[mapping!.dateColumn], mapping!.dateOrder);
    const description = String(row[mapping!.descriptionColumn] ?? "").trim().slice(0, 500);
    const rowWarnings = [...amountResult.warnings];
    if (!String(row[mapping!.dateColumn] ?? "").trim()) rowWarnings.push("Transaction date is missing.");
    else if (!dateOrderConclusive && isAmbiguousNumericDate(row[mapping!.dateColumn])) {
      rowWarnings.push(`Numeric date is ambiguous and was interpreted as ${mapping!.dateOrder}.`);
    }
    if (!description) rowWarnings.push("Description is missing.");
    const amount = amountResult.amount ?? "0";
    if (rowWarnings.length) warnings.push(`CSV row ${index + 2}: ${rowWarnings.join(" ")}`);
    const candidate: TransactionCandidate = {
      occurredOn,
      description,
      note: "",
      amount,
      currency: currencyCode(mapping!.currencyColumn ? row[mapping!.currencyColumn] : null, request.accountCurrency),
      type: amountResult.direction === "expense" || amount.startsWith("-") ? "Expense" : "Income",
      confidence: rowWarnings.length ? Math.min(confidence, amountResult.amount ? 0.72 : 0.25) : confidence,
    };
    candidates.push({
      sourceKind: "csv_row",
      sourceRow: index + 2,
      sourceEvidence: evidenceText(headers, row, rowWarnings),
      candidate,
    });
  });
  if (!candidates.length) throw new Error("No transaction rows could be extracted from the CSV.");
  return { pageCount: null, candidates, warnings };
}

async function extractPdf(request: ExtractRequest, onStage?: (stage: ExtractStage) => Promise<void>): Promise<ExtractResult> {
  const buffer = await readStoredFile(request.storageKey);
  const classification = classifyPdf(buffer);
  if (classification.pageCount > importConfig.maxPdfPages) {
    throw new Error(`PDF has ${classification.pageCount} pages; the limit is ${importConfig.maxPdfPages}.`);
  }
  const extracted = extractPagesMarkdown(buffer);
  const candidates: ImportCandidateInput[] = [];
  const warnings: string[] = [];
  const pdfPath = resolveStorageKey(request.storageKey);
  let statementContext = shortStatementContext(extracted.pages[0]?.markdown ?? "");
  await onStage?.("converting");
  const addResult = (result: Awaited<ReturnType<typeof convertWithModel>>, pageNumbers: number[]) => {
    const pageSet = new Set(pageNumbers);
    const pageText = new Map(extracted.pages.map((page) => [page.page + 1, normalizeEvidence(page.markdown ?? "")]));
    warnings.push(...result.warnings.map((warning) => `Pages ${pageNumbers.join(", ")}: ${warning}`));
    if (!result.transactions.length) {
      warnings.push(`Pages ${pageNumbers.join(", ")}: No transaction candidates were returned; verify these pages during review.`);
    }
    result.transactions.forEach(({ sourceEvidence, sourcePage, ...candidate }, index) => {
      const pageNumber = sourcePage ?? pageNumbers[0]!;
      if (!pageSet.has(pageNumber)) {
        throw new Error(`Model returned source page ${pageNumber}, which was not included in this request.`);
      }
      const normalizedSourceEvidence = normalizeEvidence(sourceEvidence);
      const evidenceVerified = normalizedSourceEvidence.length >= 3 && (pageText.get(pageNumber)?.includes(normalizedSourceEvidence) ?? false);
      if (!evidenceVerified) {
        warnings.push(`Page ${pageNumber}, candidate ${index + 1}: sourceEvidence could not be verified against the page's native text.`);
        candidate.confidence = Math.min(candidate.confidence, 0.75);
      }
      candidates.push({
        sourceKind: "pdf_page" as const,
        sourcePage: pageNumber,
        sourceEvidence,
        candidate,
      });
    });
  };

  for (let pageIndex = 0; pageIndex < extracted.pages.length;) {
    const page = extracted.pages[pageIndex]!;
    const pageNumber = page.page + 1;
    if (page.needsOcr) {
      const result = await withRenderedPdfPage(pdfPath, pageNumber, (imagePath) => convertWithModel({
        accountCurrency: request.accountCurrency,
        sourceLabel: `PDF page ${pageNumber} (visual source)`,
        content: page.markdown ? `Unreliable native text, for context only:\n${page.markdown}` : "Read the transaction table from this page image.",
        statementContext: pageNumber > 1 ? statementContext : undefined,
        imagePath,
      }));
      if (pageNumber === 1 && !statementContext) statementContext = contextFromFirstPageCandidates(result.transactions);
      addResult(result, [pageNumber]);
      pageIndex += 1;
      continue;
    }

    const nativePages = [] as typeof extracted.pages;
    while (pageIndex < extracted.pages.length && !extracted.pages[pageIndex]!.needsOcr) {
      nativePages.push(extracted.pages[pageIndex]!);
      pageIndex += 1;
    }
    const pageNumbers = nativePages.map((nativePage) => nativePage.page + 1);
    const result = await convertWithModel({
      accountCurrency: request.accountCurrency,
      sourceLabel: `PDF pages ${pageNumbers[0]}-${pageNumbers.at(-1)} (native text)`,
      // convertWithModel enforces MODEL_MAX_INPUT_CHARS and only splits this
      // combined source when the configured limit is exceeded.
      content: nativePages.map((nativePage) => `[PDF page ${nativePage.page + 1}]\n${nativePage.markdown}`).join("\n\n"),
      requireSourcePage: true,
    });
    addResult(result, pageNumbers);
  }
  if (!candidates.length) throw new Error("No transaction rows could be extracted from the PDF.");
  return { pageCount: extracted.pages.length, candidates, warnings };
}

async function extractImage(request: ExtractRequest, onStage?: (stage: ExtractStage) => Promise<void>): Promise<ExtractResult> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "orbit-image-"));
  const normalizedPath = path.join(tempDirectory, "normalized.png");
  try {
    await normalizeImage(resolveStorageKey(request.storageKey), normalizedPath);
    await onStage?.("converting");
    const result = await convertWithModel({
      accountCurrency: request.accountCurrency,
      sourceLabel: "uploaded statement or receipt image",
      content: "Read all visible financial transaction rows from this image.",
      imagePath: normalizedPath,
    });
    const candidates = result.transactions.map(({ sourceEvidence, ...candidate }) => ({
      sourceKind: "image" as const,
      sourceEvidence,
      candidate,
    }));
    if (!candidates.length) throw new Error("No transaction rows could be extracted from the image.");
    return { pageCount: 1, candidates, warnings: result.warnings };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function extractImport(request: ExtractRequest, onStage?: (stage: ExtractStage) => Promise<void>) {
  if (request.kind === "csv") return extractCsv(request, onStage);
  if (request.kind === "pdf") return extractPdf(request, onStage);
  return extractImage(request, onStage);
}
