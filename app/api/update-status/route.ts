import { NextResponse } from "next/server";
import { getUpdateStatus } from "@/lib/update-check/checker";

export const dynamic = "force-dynamic";

// Returns the cached result of the last server-side update check. It never fetches the manifest itself.
export async function GET() {
  const status = await getUpdateStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
