import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./db/schema.js";

export type Db = NodePgDatabase<typeof schema>;

let db: Db | undefined;
let pool: pg.Pool | undefined;

/** Singleton Drizzle client (one pool per process). */
export function getDb(): Db {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not set (see .env.example)");
    pool = new pg.Pool({ connectionString });
    db = drizzle(pool, { schema });
  }
  return db;
}

/** Test/shutdown helper. */
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

export * as schema from "./db/schema.js";
