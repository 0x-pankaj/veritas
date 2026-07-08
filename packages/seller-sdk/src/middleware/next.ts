import { build402, handleServe, type SellerMiddlewareOpts } from "./core.js";

/**
 * Next.js App Router adapter (PRODUCT §3.2). Uses the Web `Request`/`Response`
 * types, so it needs no `next` dependency. Wire into route handlers:
 *
 *   // app/veritas/serve/route.ts
 *   export const POST = veritasServe(opts);
 *   // app/veritas/402/route.ts
 *   export const GET = veritas402(opts);
 */
export function veritasServe(
  opts: SellerMiddlewareOpts,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
    const outcome = await handleServe(
      opts,
      req.headers.get("x-veritas-coordinator") ?? undefined,
      body,
    );
    return Response.json(outcome.body, { status: outcome.status });
  };
}

export function veritas402(
  opts: SellerMiddlewareOpts,
): () => Response {
  return () => {
    const outcome = build402(opts);
    return Response.json(outcome.body, { status: outcome.status });
  };
}
