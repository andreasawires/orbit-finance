import "server-only";

import type { PoolClient } from "pg";
import { db } from "@/lib/database";
import { ensureDatabaseSchema } from "@/lib/db";
import { IMPORT_STORAGE_ADVISORY_LOCK } from "@/lib/imports/locks";
import { deleteStoredFile } from "@/lib/imports/storage";
import type { Workspace } from "@/lib/data";

export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;

function date(value: unknown) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function workspaceFromRow(row: Row): Workspace {
  return {
    id: String(row.id),
    name: String(row.name),
    archivedAt: date(row.archived_at),
    createdAt: date(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: date(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function workspaceName(value: unknown) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 120) throw new Error("Workspace names must be between 1 and 120 characters.");
  return name;
}

export function assertWorkspaceId(value: string) {
  if (!uuid.test(value)) throw new Error("A valid workspace id is required.");
  return value;
}

export async function listWorkspaces(includeArchived = false) {
  await ensureDatabaseSchema();
  const result = await db.query(`SELECT w.*
    FROM workspaces w
    JOIN workspace_memberships m ON m.workspace_id = w.id
    WHERE m.user_id = $1 ${includeArchived ? "" : "AND w.archived_at IS NULL"}
    ORDER BY w.archived_at NULLS FIRST, w.created_at, w.name`, [LOCAL_USER_ID]);
  return result.rows.map(workspaceFromRow);
}

export async function getWorkspace(workspaceId: string, options: { includeArchived?: boolean } = {}) {
  await ensureDatabaseSchema();
  assertWorkspaceId(workspaceId);
  const result = await db.query(`SELECT w.*
    FROM workspaces w
    JOIN workspace_memberships m ON m.workspace_id = w.id
    WHERE w.id = $1 AND m.user_id = $2 ${options.includeArchived ? "" : "AND w.archived_at IS NULL"}`,
  [workspaceId, LOCAL_USER_ID]);
  return result.rowCount ? workspaceFromRow(result.rows[0]) : null;
}

export async function requireActiveWorkspace(workspaceId: string) {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error("Workspace not found.");
  return workspace;
}

export async function createWorkspace(input: { name: string }) {
  await ensureDatabaseSchema();
  const name = workspaceName(input.name);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query("INSERT INTO workspaces (name) VALUES ($1) RETURNING *", [name]);
    const workspace = workspaceFromRow(created.rows[0]);
    await client.query("INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [workspace.id, LOCAL_USER_ID]);
    await client.query("INSERT INTO currencies (workspace_id, code, name, symbol) VALUES ($1, 'USD', 'US Dollar', '$')", [workspace.id]);
    await client.query(`INSERT INTO workspace_preferences (workspace_id, currency, timezone, locale, price_format)
      VALUES ($1, 'USD', 'UTC', 'en-US', 'symbol')`, [workspace.id]);
    await client.query("COMMIT");
    return workspace;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function renameWorkspace(workspaceId: string, input: { name: string }) {
  await ensureDatabaseSchema();
  assertWorkspaceId(workspaceId);
  const name = workspaceName(input.name);
  const result = await db.query(`UPDATE workspaces w SET name = $1, updated_at = now()
    FROM workspace_memberships m
    WHERE w.id = $2 AND m.workspace_id = w.id AND m.user_id = $3
    RETURNING w.*`, [name, workspaceId, LOCAL_USER_ID]);
  if (!result.rowCount) throw new Error("Workspace not found.");
  return workspaceFromRow(result.rows[0]);
}

async function activeWorkspaceCount(client: PoolClient) {
  const count = await client.query<{ count: string }>(`SELECT count(*)::text AS count
    FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id
    WHERE m.user_id = $1 AND w.archived_at IS NULL`, [LOCAL_USER_ID]);
  return Number(count.rows[0]?.count ?? 0);
}

export async function archiveWorkspace(workspaceId: string) {
  await ensureDatabaseSchema();
  assertWorkspaceId(workspaceId);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(`SELECT w.* FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id
      WHERE w.id = $1 AND m.user_id = $2 FOR UPDATE`, [workspaceId, LOCAL_USER_ID]);
    if (!current.rowCount) throw new Error("Workspace not found.");
    if (current.rows[0].archived_at == null) {
      const count = await activeWorkspaceCount(client);
      if (count <= 1) throw new Error("Create another workspace before archiving the last active workspace.");
    }
    const result = await client.query("UPDATE workspaces SET archived_at = COALESCE(archived_at, now()), updated_at = now() WHERE id = $1 RETURNING *", [workspaceId]);
    await client.query("COMMIT");
    return workspaceFromRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function restoreWorkspace(workspaceId: string) {
  await ensureDatabaseSchema();
  assertWorkspaceId(workspaceId);
  const result = await db.query(`UPDATE workspaces w SET archived_at = NULL, updated_at = now()
    FROM workspace_memberships m
    WHERE w.id = $1 AND m.workspace_id = w.id AND m.user_id = $2
    RETURNING w.*`, [workspaceId, LOCAL_USER_ID]);
  if (!result.rowCount) throw new Error("Workspace not found.");
  return workspaceFromRow(result.rows[0]);
}

export async function permanentlyDeleteWorkspace(workspaceId: string, confirmationName: string) {
  await ensureDatabaseSchema();
  assertWorkspaceId(workspaceId);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [IMPORT_STORAGE_ADVISORY_LOCK]);
    const current = await client.query(`SELECT w.* FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id
      WHERE w.id = $1 AND m.user_id = $2 FOR UPDATE`, [workspaceId, LOCAL_USER_ID]);
    if (!current.rowCount) throw new Error("Workspace not found.");
    const workspace = workspaceFromRow(current.rows[0]);
    if (workspace.name !== confirmationName) throw new Error("Workspace name confirmation does not match.");
    if (!workspace.archivedAt && await activeWorkspaceCount(client) <= 1) {
      throw new Error("Create another workspace before deleting the last active workspace.");
    }
    const files = await client.query<{ storage_key: string }>("SELECT storage_key FROM import_documents WHERE workspace_id = $1", [workspaceId]);
    for (const file of files.rows) await deleteStoredFile(String(file.storage_key));
    await client.query("DELETE FROM transactions WHERE workspace_id = $1", [workspaceId]);
    await client.query("DELETE FROM import_documents WHERE workspace_id = $1", [workspaceId]);
    await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    await client.query("COMMIT");
    return workspace;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
