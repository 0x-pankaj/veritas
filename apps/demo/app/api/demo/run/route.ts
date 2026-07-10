import { NextResponse } from "next/server";
import { runDemo, mockDemoResult, type DemoResult } from "../../../../src/demo/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Runs one verified purchase and returns the composed demo result. Falls back
 * to the canned mock result (so the page always renders) when DEMO_MOCK=1 or
 * the live coordinator is unreachable — with a `note` explaining the fallback.
 */
export async function POST(req: Request): Promise<NextResponse<DemoResult>> {
  const facilitatorUrl =
    process.env.VERITAS_FACILITATOR_URL ?? "http://localhost:3001";
  const mock = process.env.DEMO_MOCK === "1";

  let symbol = "BTC/USD";
  try {
    const body = (await req.json()) as { symbol?: string };
    if (body.symbol) symbol = body.symbol;
  } catch {
    /* empty body is fine */
  }

  if (mock) return NextResponse.json(mockDemoResult(symbol));

  try {
    const result = await runDemo({ facilitatorUrl, symbol });
    return NextResponse.json(result);
  } catch (err) {
    const fallback = mockDemoResult(symbol);
    fallback.note = `Live coordinator unreachable (${
      err instanceof Error ? err.message : String(err)
    }); showing a canned result.`;
    return NextResponse.json(fallback);
  }
}
