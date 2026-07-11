import { describe, expect, it } from "vitest";
import { pickSellers } from "./services/registry.js";
import type { Db } from "./db.js";

/**
 * Health-aware discovery: dead endpoints must not occupy candidate slots —
 * stale registrations with tied reputation would otherwise break quorum
 * (hit locally: two dead sellers ranked above a live one → fan-out < quorum).
 */
describe("pickSellers health filtering", () => {
  const rows = [
    { id: "dead-1", endpoint: "http://dead-1", reputation: 600 },
    { id: "live-1", endpoint: "http://live-1", reputation: 550 },
    { id: "dead-2", endpoint: "http://dead-2", reputation: 500 },
    { id: "live-2", endpoint: "http://live-2", reputation: 450 },
    { id: "live-3", endpoint: "http://live-3", reputation: 400 },
  ];
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: async () => rows }) }),
    }),
  } as unknown as Db;
  const probe = async (endpoint: string) => !endpoint.includes("dead");

  it("skips dead endpoints and keeps reputation order among the healthy", async () => {
    const picked = await pickSellers(db, "crypto-prices", "BTC/USD", 3, { probe });
    expect(picked.map((s) => s.id)).toEqual(["live-1", "live-2", "live-3"]);
  });

  it("returns fewer than k when not enough sellers are alive (quote 409s upstream)", async () => {
    const picked = await pickSellers(db, "crypto-prices", "BTC/USD", 5, { probe });
    expect(picked.map((s) => s.id)).toEqual(["live-1", "live-2", "live-3"]);
  });
});
