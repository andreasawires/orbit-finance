"use client";

import { useEffect, useState } from "react";
import { useFinanceDataContext } from "@/components/finance-data-provider";
import { useViewState } from "@/components/view-state-provider";
import { useWorkspace } from "@/components/workspace-provider";

type QueryState<T> = { key: string; revision: number; workspaceId: string | null; data: T | null; error: string };

/**
 * GETs `path?params` for the active workspace and refetches whenever the params change or data is mutated.
 * While a new request is in flight it keeps showing the cached result for the same URL, or else the previous
 * result in the same workspace, so paging and filtering don't flash empty. Pass `params: null` to skip.
 */
export function useServerQuery<T>(path: string, params: URLSearchParams | null) {
  const { workspaceId, workspaceFetch } = useWorkspace();
  const { revision } = useFinanceDataContext();
  const { readResult, storeResult } = useViewState();
  const url = workspaceId && params ? `${path}?${params}` : null;
  const key = url ? `${workspaceId}:${url}` : "";
  const [state, setState] = useState<QueryState<T>>({ key: "", revision: -1, workspaceId: null, data: null, error: "" });

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    workspaceFetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load data");
        storeResult(key, body);
        setState({ key, revision, workspaceId, data: body as T, error: "" });
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ key, revision, workspaceId, data: current.key === key ? current.data : null, error: caught instanceof Error ? caught.message : "Could not load data" }));
      });
    return () => controller.abort();
  }, [key, revision, storeResult, url, workspaceFetch, workspaceId]);

  if (!url) return { data: null, loading: false, error: "" };
  const current = state.key === key;
  const data = (current ? state.data : null) ?? (readResult(key) as T | undefined) ?? (state.workspaceId === workspaceId ? state.data : null);
  return { data, loading: !current || state.revision !== revision, error: current ? state.error : "" };
}
