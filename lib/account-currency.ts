export function lockedAccountCurrency(currentCurrency: string, requestedCurrency: unknown) {
  const current = currentCurrency.trim().toUpperCase();
  const requested = requestedCurrency == null ? current : String(requestedCurrency).trim().toUpperCase();
  if (requested !== current) throw new Error("Account currency is locked. Create a new account to use another currency.");
  return current;
}
