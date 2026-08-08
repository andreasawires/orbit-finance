"use client";

import { useCallback, useEffect, useState } from "react";
import { emptyFinanceData, type FinanceData } from "@/lib/data";
import { useWorkspace } from "@/components/workspace-provider";

export function useFinanceData() {
  const { workspaceId, workspaceFetch } = useWorkspace();
  const [data, setData] = useState<FinanceData>(emptyFinanceData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!workspaceId) return;
      const response = await workspaceFetch("/api/finance", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load finance data");
      setData(body); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load finance data"); }
    finally { setLoading(false); }
  }, [workspaceFetch, workspaceId]);

  useEffect(() => {
    let active = true;
    if (!workspaceId) return;
    workspaceFetch("/api/finance", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load finance data");
        if (active) { setData(body); setError(""); }
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load finance data"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceFetch, workspaceId]);

  const mutate = useCallback(async (method: "POST" | "PATCH" | "DELETE", body: unknown) => {
    const response = await workspaceFetch("/api/finance", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save changes");
    setData(result); setError("");
    return result as FinanceData;
  }, [workspaceFetch]);

  return { ...data, loading, error, reload: load, mutate };
}
