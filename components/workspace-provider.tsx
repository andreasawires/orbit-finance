"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Workspace } from "@/lib/data";

const activeWorkspaceStorageKey = "orbit-active-workspace-id";
const workspaceHeader = "X-Orbit-Workspace-Id";

type WorkspaceContextValue = {
  workspaceId: string | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
  loading: boolean;
  error: string;
  selectWorkspace: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<Workspace[]>;
  workspaceFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

async function loadWorkspaces(includeArchived = false) {
  const response = await fetch(`/api/workspaces${includeArchived ? "?includeArchived=true" : ""}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load workspaces");
  return body.workspaces as Workspace[];
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const choose = useCallback((available: Workspace[]) => {
    const stored = localStorage.getItem(activeWorkspaceStorageKey);
    const selected = available.find((workspace) => workspace.id === stored) ?? available[0] ?? null;
    setWorkspaceId(selected?.id ?? null);
    if (selected) localStorage.setItem(activeWorkspaceStorageKey, selected.id);
    else localStorage.removeItem(activeWorkspaceStorageKey);
    return selected;
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    const available = await loadWorkspaces();
    setWorkspaces(available);
    choose(available);
    setError("");
    return available;
  }, [choose]);

  useEffect(() => {
    let active = true;
    void loadWorkspaces().then((available) => {
      if (!active) return;
      setWorkspaces(available); choose(available); setError("");
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Could not load workspaces");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [choose]);

  const selectWorkspace = useCallback((id: string) => {
    if (!workspaces.some((workspace) => workspace.id === id)) return;
    localStorage.setItem(activeWorkspaceStorageKey, id);
    setWorkspaceId(id);
  }, [workspaces]);

  const workspaceFetch = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!workspaceId) throw new Error("Select a workspace before loading financial data.");
    const headers = new Headers(init.headers);
    headers.set(workspaceHeader, workspaceId);
    return fetch(input, { ...init, headers });
  }, [workspaceId]);

  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaceId, workspaces]);
  const value = useMemo(() => ({ workspaceId, workspace, workspaces, loading, error, selectWorkspace, refreshWorkspaces, workspaceFetch }),
    [workspaceId, workspace, workspaces, loading, error, selectWorkspace, refreshWorkspaces, workspaceFetch]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return context;
}
