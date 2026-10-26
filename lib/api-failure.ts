import "server-only";
import { NextResponse } from "next/server";
import { workspaceRequestFailure } from "@/lib/workspace-request";

export function apiFailure(error: unknown) {
  console.error(error);
  const message = error instanceof Error ? error.message : "Unknown database error";
  const workspace = workspaceRequestFailure(error);
  if (workspace.status !== 503) return NextResponse.json({ error: workspace.message }, { status: workspace.status });
  if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
  if (/confirmation does not match|valid timezone|must be an ISO timestamp|is invalid\.|must be greater than zero|Choose both|two different accounts|at least one transaction|^Invalid (date range|type filter|account filter|cost center filter|sort|page|granularity|transaction or account id)/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
  return NextResponse.json({ error: `Database unavailable: ${message}` }, { status: 503 });
}
