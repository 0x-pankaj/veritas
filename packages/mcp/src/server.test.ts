import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { BuyParams, AvailableData } from "@veritas/agent";
import type { BuyResult } from "@veritas/core";
import { createVeritasMcpServer, type VeritasLike } from "./server.js";

/** A scripted agent SDK — no coordinator/Solana needed to test the MCP layer. */
function stubVeritas(over: Partial<VeritasLike> = {}): VeritasLike {
  return {
    buy: async (params: BuyParams): Promise<BuyResult> => ({
      queryId: "abc123",
      data: { truth: "50100", payloads: [{ symbol: params.symbol, price: "50100" }] },
      verdict: {
        queryId: "abc123",
        truth: "50100",
        winners: ["s1", "s2"],
        outliers: ["s3"],
        solanaTx: "sig-xyz",
      },
      finalCost: "10300",
    }),
    listAvailableData: async (): Promise<AvailableData[]> => [
      {
        id: "s1",
        name: "acme-prices",
        price: "5000",
        category: "crypto-prices",
        coverage: ["BTC/USD"],
        schemaDesc: "{symbol, price, ts}",
        freshnessSec: 5,
        reputation: 700,
      },
    ],
    ...over,
  };
}

/** Wire a real MCP Client to the server over a linked in-memory transport. */
async function connect(veritas: VeritasLike): Promise<Client> {
  const server = createVeritasMcpServer({ veritas });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return client;
}

describe("Veritas MCP server", () => {
  it("advertises both tools", async () => {
    const client = await connect(stubVeritas());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "buy_verified_data",
      "list_available_data",
    ]);
  });

  it("buy_verified_data returns data + verdict + proof + cost", async () => {
    const client = await connect(stubVeritas());
    const res = await client.callTool({
      name: "buy_verified_data",
      arguments: {
        category: "crypto-prices",
        symbol: "BTC/USD",
        k: 3,
        maxPrice: "20000",
      },
    });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as {
      data: { truth: string };
      verdict: { winners: string[]; outliers: string[] };
      proof: { solanaTx: string };
      cost: string;
    };
    expect(out.data.truth).toBe("50100");
    expect(out.verdict.winners).toHaveLength(2);
    expect(out.verdict.outliers).toHaveLength(1);
    expect(out.proof.solanaTx).toBe("sig-xyz");
    expect(out.cost).toBe("10300");
  });

  it("passes maxPrice through and surfaces buy errors as tool errors", async () => {
    const client = await connect(
      stubVeritas({
        buy: async () => {
          throw new Error("quote exceeds maxPrice: maxExposure 15300 > 10000");
        },
      }),
    );
    const res = await client.callTool({
      name: "buy_verified_data",
      arguments: { category: "crypto-prices", symbol: "BTC/USD", maxPrice: "10000" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    expect(text).toMatch(/exceeds maxPrice/);
  });

  it("requires maxPrice when no server default is configured", async () => {
    const client = await connect(stubVeritas());
    const res = await client.callTool({
      name: "buy_verified_data",
      arguments: { category: "crypto-prices", symbol: "BTC/USD" },
    });
    expect(res.isError).toBe(true);
  });

  it("list_available_data returns the catalog", async () => {
    const client = await connect(stubVeritas());
    const res = await client.callTool({
      name: "list_available_data",
      arguments: { category: "crypto-prices" },
    });
    const out = res.structuredContent as { listings: AvailableData[] };
    expect(out.listings[0]!.name).toBe("acme-prices");
    expect(out.listings[0]!.reputation).toBe(700);
  });
});
