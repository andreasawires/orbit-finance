import { NextRequest, NextResponse } from "next/server";
import { loadLatestFxRates, normalizeCurrencyCode, normalizeCurrencyCodes } from "@/lib/fx";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const base = normalizeCurrencyCode(request.nextUrl.searchParams.get("base") ?? "");
    const quotes = normalizeCurrencyCodes((request.nextUrl.searchParams.get("quotes") ?? "").split(",").filter(Boolean));
    if (!quotes.length) return NextResponse.json({ error: "At least one source currency is required." }, { status: 400 });
    const data = await loadLatestFxRates(base, quotes);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Current exchange rates are unavailable.";
    const status = /three-letter|source currency/i.test(message) ? 400 : 503;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
