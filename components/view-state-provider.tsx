"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";

// Session-only view state: each page's filters, plus the last server response per request URL so a page
// shows its previous result immediately when revisited while it refetches. Both live in memory and reset on reload.

const MAX_CACHED_RESULTS = 100;

type ViewStateContextValue = {
  filters: Record<string, unknown>;
  setFilters: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  readResult: (key: string) => unknown;
  storeResult: (key: string, value: unknown) => void;
};

const ViewStateContext = createContext<ViewStateContextValue | null>(null);

export function ViewStateProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const results = useRef(new Map<string, unknown>());
  const readResult = useCallback((key: string) => results.current.get(key), []);
  const storeResult = useCallback((key: string, value: unknown) => {
    const cache = results.current;
    cache.delete(key);
    cache.set(key, value);
    // Maps keep insertion order, so the first key is the least recently stored.
    if (cache.size > MAX_CACHED_RESULTS) cache.delete(cache.keys().next().value!);
  }, []);
  const value = useMemo(() => ({ filters, setFilters, readResult, storeResult }), [filters, readResult, storeResult]);
  return <ViewStateContext.Provider value={value}>{children}</ViewStateContext.Provider>;
}

export function useViewState() {
  const context = useContext(ViewStateContext);
  if (!context) throw new Error("useViewState must be used inside ViewStateProvider.");
  return context;
}

/**
 * Filters for one page, kept per workspace for the session. `defaults` must be a stable (module-level) object.
 * Any update that doesn't set `page` itself starts again from the first page.
 */
export function usePageFilters<T extends object>(pageKey: string, defaults: T) {
  const { workspaceId } = useWorkspace();
  const { filters, setFilters } = useViewState();
  const key = `${workspaceId ?? ""}:${pageKey}`;
  const current = (filters[key] as T | undefined) ?? defaults;
  const update = useCallback((patch: Partial<T>) => setFilters((all) => {
    const previous = (all[key] as T | undefined) ?? defaults;
    const next: T = { ...previous, ...patch };
    if ("page" in next && !("page" in patch)) (next as { page: number }).page = 1;
    return { ...all, [key]: next };
  }), [defaults, key, setFilters]);
  return [current, update] as const;
}
