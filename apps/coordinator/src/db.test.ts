import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(import.meta.dirname, "../../../.env") });

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "./db.js";
import { sellers } from "./db/schema.js";

// Requires a local Postgres (docker: veritas-pg). Skipped when DATABASE_URL unset.
describe.skipIf(!process.env.DATABASE_URL)("db mirror (drizzle)", () => {
  afterAll(closeDb);

  it("creates and reads a seller", async () => {
    const db = getDb();
    const pubkey = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [created] = await db
      .insert(sellers)
      .values({
        solanaPubkey: pubkey,
        payoutAddress: "0x1111111111111111111111111111111111111111",
        name: "acme-prices",
        endpoint: "http://localhost:9101",
        price: "1000",
        category: "crypto-prices",
        coverage: ["BTC/USD"],
        schemaDesc: "{symbol, price, ts}",
        freshnessSec: 5,
      })
      .returning();
    expect(created!.reputation).toBe(500);
    expect(created!.status).toBe("ACTIVE");

    const [found] = await db
      .select()
      .from(sellers)
      .where(eq(sellers.solanaPubkey, pubkey));
    expect(found?.name).toBe("acme-prices");
    expect(found?.coverage).toEqual(["BTC/USD"]);

    await db.delete(sellers).where(eq(sellers.id, created!.id));
  });
});
