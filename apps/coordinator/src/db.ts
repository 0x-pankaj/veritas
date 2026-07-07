import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

let prisma: PrismaClient | undefined;

/** Singleton Prisma client (Prisma 7 driver-adapter style; one pool per process). */
export function getDb(): PrismaClient {
  if (!prisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not set (see .env.example)");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }
  return prisma;
}

/** Test/shutdown helper. */
export async function closeDb(): Promise<void> {
  await prisma?.$disconnect();
  prisma = undefined;
}
