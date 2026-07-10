import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@veritas/coordinator/db/schema";

export { schema };
export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let db: Db | undefined;

/**
 * Singleton read connection to the coordinator's Postgres mirror. The
 * dashboard is a read-only surface over the same DB the coordinator writes
 * (PRODUCT §3.4, §5.1) — on-chain stays the source of truth.
 */
export function getDb(): Db {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the dashboard");
  pool = new pg.Pool({ connectionString: url, max: 4 });
  db = drizzle(pool, { schema });
  return db;
}
