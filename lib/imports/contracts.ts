import { z } from "zod";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
// Matches the ledger's numeric(16, 2): 14 integer digits plus two decimals.
export const ledgerAmountPattern = /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;

export const transactionCandidateSchema = z.object({
  occurredOn: z.string().regex(isoDate, "Use an ISO date (YYYY-MM-DD)."),
  description: z.string().trim().min(1).max(500),
  note: z.string().max(2_000).default(""),
  amount: z.string().regex(
    ledgerAmountPattern,
    "Amount must be a plain decimal with at most 14 integer and two fractional digits.",
  ),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  type: z.enum(["Income", "Expense"]),
  confidence: z.number().min(0).max(1),
});

export const modelTransactionSchema = transactionCandidateSchema.extend({
  sourceEvidence: z.string().max(1_000).default(""),
});

export const modelTransactionsSchema = z.object({
  transactions: z.array(modelTransactionSchema).max(1_000),
  warnings: z.array(z.string().max(500)).max(100).default([]),
});

export const csvMappingSchema = z.object({
  dateColumn: z.string().min(1),
  descriptionColumn: z.string().min(1),
  amountColumn: z.string().nullable(),
  debitColumn: z.string().nullable(),
  creditColumn: z.string().nullable(),
  currencyColumn: z.string().nullable(),
  typeColumn: z.string().nullable(),
  dateOrder: z.enum(["YMD", "DMY", "MDY"]),
  positiveMeans: z.enum(["income", "expense"]),
}).refine((mapping) => mapping.amountColumn || mapping.debitColumn || mapping.creditColumn, {
  message: "At least one amount, debit, or credit column is required.",
});

export type TransactionCandidate = z.infer<typeof transactionCandidateSchema>;
export type ModelTransaction = z.infer<typeof modelTransactionSchema>;
export type CsvMapping = z.infer<typeof csvMappingSchema>;

export type ImportSource = {
  sourceKind: "csv_row" | "pdf_page" | "image";
  sourcePage?: number;
  sourceRow?: number;
  sourceEvidence: string;
};

export type ImportCandidateInput = ImportSource & {
  candidate: TransactionCandidate;
};

export type ImportJobData = { batchId: string };

export const IMPORT_QUEUE = "import.process";
