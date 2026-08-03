import { transactionCandidateSchema, type ImportCandidateInput, type TransactionCandidate } from "@/lib/imports/contracts";

const decimalPlaces = (value: string) => value.split(".")[1]?.length ?? 0;

export function validateCandidate(candidate: TransactionCandidate, accountCurrency: string) {
  const errors: string[] = [];
  const parsed = transactionCandidateSchema.safeParse(candidate);
  if (!parsed.success) errors.push(...parsed.error.issues.map((issue) => issue.message));
  const amount = Number(candidate.amount);
  if (!Number.isFinite(amount) || amount === 0) errors.push("Amount must be a non-zero decimal.");
  if (decimalPlaces(candidate.amount) > 2) errors.push("The current ledger supports at most two decimal places.");
  const integerDigits = candidate.amount.replace(/^-/, "").split(".")[0].replace(/^0+/, "").length;
  if (integerDigits > 14) errors.push("Amount exceeds the current ledger precision.");
  if (candidate.type === "Expense" && amount >= 0) errors.push("An expense must have a negative amount.");
  if (candidate.type === "Income" && amount <= 0) errors.push("Income must have a positive amount.");
  if (candidate.currency !== accountCurrency) errors.push(`Currency ${candidate.currency} differs from the account currency ${accountCurrency}.`);
  const date = new Date(`${candidate.occurredOn}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate.occurredOn) errors.push("Transaction date is invalid.");
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (!Number.isNaN(date.getTime()) && date > tomorrow) errors.push("Transaction date is unexpectedly in the future.");
  return [...new Set(errors)];
}

export function candidateFingerprint(accountId: string, candidate: TransactionCandidate) {
  const [integer, fraction = ""] = candidate.amount.split(".");
  const amount = `${integer}.${fraction.padEnd(2, "0")}`;
  const description = candidate.description.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${accountId}|${candidate.occurredOn}|${amount}|${candidate.currency}|${description}`;
}

export function validateCandidates(candidates: ImportCandidateInput[], accountCurrency: string) {
  return candidates.map((item) => ({ ...item, validationErrors: validateCandidate(item.candidate, accountCurrency) }));
}
