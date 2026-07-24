// Prisma configuration (Prisma 7).
// `import "dotenv/config"` loads DATABASE_URL from .env for the Prisma CLI.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `prisma db seed` / `prisma migrate reset` run this.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
