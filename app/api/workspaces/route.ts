import { NextRequest, NextResponse } from "next/server";
import { createWorkspace, listWorkspaces } from "@/lib/workspaces";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not manage workspaces.";
  const status = /between 1 and 120/i.test(message) ? 400 : 503;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    return NextResponse.json({ workspaces: await listWorkspaces(includeArchived) });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return NextResponse.json({ workspace: await createWorkspace({ name: body.name }) }, { status: 201 });
  } catch (error) { return failure(error); }
}
