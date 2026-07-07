import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Falls back to the repo-root .env for local dev.
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/veritas",
  },
});
