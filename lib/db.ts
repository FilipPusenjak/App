// Prisma Client singleton.
//
// Prisma 7 uses a driver adapter for SQL databases; for SQLite that is
// @prisma/adapter-better-sqlite3. Swapping to Postgres later means changing the
// adapter here (and the datasource provider in schema.prisma) — nothing else.
//
// `import "dotenv/config"` ensures DATABASE_URL is present when this module is
// used outside Next.js (e.g. the tsx seed script). Next loads env files itself.
import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/lib/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and set DATABASE_URL.",
  );
}

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
}

// Reuse one client across hot-reloads in dev so we don't open a new SQLite
// connection on every change.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
