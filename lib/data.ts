export type Account = {
  id: string;
  name: string;
  institution: string;
  number: string;
  openingBalance: number;
  balance: number;
  currency: string;
  color: string;
  kind: string;
};

export type Transaction = {
  id: string;
  occurredOn: string;
  date: string;
  merchant: string;
  detail: string;
  costCenter: string;
  costCenterId: string | null;
  account: string;
  accountId: string;
  transferId: string | null;
  transferAccountId: string | null;
  amount: number;
  currency: string;
  type: "Income" | "Expense" | "Transfer";
  icon: string;
};

export type CostCenter = {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  amount: number;
  children: CostCenter[];
};

export type Preferences = {
  currency: string;
  timezone: string;
  locale: string;
  priceFormat: string;
};

export type Currency = {
  code: string;
  name: string;
  symbol: string;
};

export type FinanceData = {
  accounts: Account[];
  transactions: Transaction[];
  costCenters: CostCenter[];
  currencies: Currency[];
  preferences: Preferences;
};

export const emptyFinanceData: FinanceData = {
  accounts: [],
  transactions: [],
  costCenters: [],
  currencies: [],
  preferences: { currency: "USD", timezone: "UTC", locale: "en-US", priceFormat: "symbol" },
};

export const formatMoney = (value: number, currency = "USD", locale = "en-US") =>
  new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(value);

export const flattenCostCenters = (centers: CostCenter[], prefix = ""): Array<CostCenter & { path: string }> =>
  centers.flatMap((center) => {
    const path = prefix ? `${prefix} › ${center.name}` : center.name;
    return [{ ...center, path }, ...flattenCostCenters(center.children, path)];
  });

export const costCenterTotal = (center: CostCenter): number =>
  center.amount + center.children.reduce((total, child) => total + costCenterTotal(child), 0);
