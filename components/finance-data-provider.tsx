"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { emptyFinanceData, type FinanceData } from "@/lib/data";
import { useWorkspace } from "@/components/workspace-provider";

type FinanceDataContextValue = {
  data: FinanceData;
  loading: boolean;
  refreshing: boolean;
  error: string;
  refresh: () => Promise<void>;
  mutate: (method: "POST" | "PATCH" | "DELETE", body: unknown) => Promise<FinanceData>;
};

const FinanceDataContext = createContext<FinanceDataContextValue | null>(null);

export function FinanceDataProvider({ children }: { children: React.ReactNode }) {
  const { workspaceId, workspaceFetch } = useWorkspace();
  const [cache, setCache] = useState<Record<string, FinanceData>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const cacheRef = useRef(cache);
  const inFlight = useRef(new Map<string, Promise<FinanceData>>());
  // Each request gets a sequence number so a slow GET can't overwrite newer data from a later mutation.
  const sequence = useRef(0);
  const storedSequence = useRef(new Map<string, number>());

  useEffect(() => { cacheRef.current = cache; }, [cache]);

  const store = useCallback((id: string, seq: number, data: FinanceData) => {
    if (seq < (storedSequence.current.get(id) ?? 0)) return;
    storedSequence.current.set(id, seq);
    setCache((current) => ({ ...current, [id]: data }));
    setErrors((current) => ({ ...current, [id]: "" }));
  }, []);

  const fetchFinance = useCallback(() => {
    if (!workspaceId) return Promise.resolve(emptyFinanceData);
    const id = workspaceId;
    const pending = inFlight.current.get(id);
    if (pending) return pending;
    const seq = ++sequence.current;
    const request = workspaceFetch("/api/finance", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load finance data");
        store(id, seq, body);
        return body as FinanceData;
      })
      .catch((caught) => {
        setErrors((current) => ({ ...current, [id]: caught instanceof Error ? caught.message : "Could not load finance data" }));
        throw caught;
      })
      .finally(() => inFlight.current.delete(id));
    inFlight.current.set(id, request);
    return request;
  }, [store, workspaceFetch, workspaceId]);

  useEffect(() => {
    if (!workspaceId || cacheRef.current[workspaceId]) return;
    void fetchFinance().catch(() => undefined);
  }, [fetchFinance, workspaceId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await fetchFinance(); } catch { /* surfaced through `error` */ }
    finally { setRefreshing(false); }
  }, [fetchFinance]);

  const mutate = useCallback(async (method: "POST" | "PATCH" | "DELETE", body: unknown) => {
    const id = workspaceId ?? "";
    const seq = ++sequence.current;
    const response = await workspaceFetch("/api/finance", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save changes");
    store(id, seq, result);
    return result as FinanceData;
  }, [store, workspaceFetch, workspaceId]);

  const cached = workspaceId ? cache[workspaceId] : undefined;
  const error = workspaceId ? errors[workspaceId] ?? "" : "";
  const value = useMemo(() => ({ data: cached ?? emptyFinanceData, loading: !cached && !error, refreshing, error, refresh, mutate }),
    [cached, error, refreshing, refresh, mutate]);
  return <FinanceDataContext.Provider value={value}>{children}</FinanceDataContext.Provider>;
}

export function useFinanceDataContext() {
  const context = useContext(FinanceDataContext);
  if (!context) throw new Error("useFinanceDataContext must be used inside FinanceDataProvider.");
  return context;
}
