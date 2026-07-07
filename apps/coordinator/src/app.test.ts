import { describe, expect, it } from "vitest";
import { testClient } from "hono/testing";
import { buildApp } from "./app.js";

describe("coordinator app", () => {
  it("GET /health responds ok via the TYPED client", async () => {
    const client = testClient(buildApp());
    const res = await client.health.$get();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Compile-time proof of typed RPC: body.ok is `true`, not `boolean`.
    expect(body.ok).toBe(true);
    expect(body.service).toBe("veritas-coordinator");
  });
});
