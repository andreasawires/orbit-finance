"use client";

import { useFinanceDataContext } from "@/components/finance-data-provider";

export function useFinanceData() {
  const { data, loading, error, refresh, mutate, syncWallets } = useFinanceDataContext();
  return { ...data, loading, error, reload: refresh, mutate, syncWallets };
}
