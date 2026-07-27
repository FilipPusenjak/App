// Prisma Client singleton (PostgreSQL).
//
// Prisma 7 uses a driver adapter for SQL databases; for Postgres that is
// @prisma/adapter-pg over the `pg` connection pool.
//
// `import "dotenv/config"` ensures DATABASE_URL is present when this module is
// used outside Next.js (e.g. the tsx seed script). Next loads env files itself.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and set your Postgres connection string.",
  );
}

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    // Serverless platforms create many short-lived instances, so keep each
    // pool small. Raise this only if you move to a long-running server.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });
  return new PrismaClient({ adapter });
}

// Reuse one client across hot-reloads in dev so we don't open a new pool on
// every code change.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
