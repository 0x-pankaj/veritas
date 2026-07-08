import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CATEGORIES } from "@veritas/core";
import type { Veritas } from "@veritas/agent";

/** The parts of the agent SDK the MCP tools use (injectable for tests). */
export type VeritasLike = Pick<Veritas, "buy" | "listAvailableData">;

export interface VeritasMcpOpts {
  veritas: VeritasLike;
  /** Default budget cap when a call omits maxPrice (USDC base units). */
  defaultMaxPrice?: string;
}

const buyInputShape = {
  category: z.enum(CATEGORIES).describe("Data category from the fixed taxonomy"),
  symbol: z
    .string()
    .min(1)
    .describe('Coverage key sellers are matched on, e.g. "BTC/USD"'),
  query: z
    .string()
    .optional()
    .describe("Human-readable question (informational; routing uses symbol)"),
  mode: z
    .enum(["fast", "verified"])
    .optional()
    .describe('"verified" = K-seller consensus (default); "fast" = single seller'),
  k: z.number().int().min(3).max(7).optional().describe("Consensus fan-out width"),
  maxPrice: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .describe("Budget cap on total exposure (winners + fee), USDC base units"),
};

const listInputShape = {
  category: z.enum(CATEGORIES).optional().describe("Filter by category"),
  symbol: z.string().optional().describe("Filter by coverage key"),
};

/**
 * Build the Veritas MCP server (PRODUCT §4.3). Exposes two tools that wrap the
 * agent SDK so any MCP client — Claude Code, or any agent — can buy verified
 * data natively:
 *   - `buy_verified_data`   → consensus purchase; returns data + verdict + cost.
 *   - `list_available_data` → browse the verified-data catalog before buying.
 * This is the primary distribution channel (mirrors `circle services pay`).
 */
export function createVeritasMcpServer(opts: VeritasMcpOpts): McpServer {
  const server = new McpServer({ name: "veritas", version: "0.1.0" });

  server.registerTool(
    "buy_verified_data",
    {
      title: "Buy verified data",
      description:
        "Buy data that is provably correct: fan out to K independent sellers, " +
        "verify agreement on Solana, pay only the sellers that matched the truth. " +
        "Returns the verified answer, the on-chain verdict (winners/outliers/tx), " +
        "and the actual USDC cost. You only pay for correct data.",
      inputSchema: buyInputShape,
    },
    async (args) => {
      const maxPrice = args.maxPrice ?? opts.defaultMaxPrice;
      if (!maxPrice) {
        return errorResult(
          "maxPrice is required (no server default configured)",
        );
      }
      try {
        const r = await opts.veritas.buy({
          category: args.category,
          symbol: args.symbol,
          ...(args.query ? { query: args.query } : {}),
          ...(args.mode ? { mode: args.mode } : {}),
          ...(args.k ? { k: args.k } : {}),
          maxPrice,
        });
        const payload = {
          data: r.data,
          verdict: r.verdict,
          proof: { queryId: r.queryId, solanaTx: r.verdict.solanaTx },
          cost: r.finalCost,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "list_available_data",
    {
      title: "List available verified data",
      description:
        "Browse the Veritas catalog of verified-data sellers by category and " +
        "coverage, ranked by on-chain reputation. Use this before buying to see " +
        "what data is available and at what price.",
      inputSchema: listInputShape,
    },
    async (args) => {
      try {
        const listings = await opts.veritas.listAvailableData({
          ...(args.category ? { category: args.category } : {}),
          ...(args.symbol ? { symbol: args.symbol } : {}),
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(listings, null, 2) },
          ],
          structuredContent: { listings },
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  return server;
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}
