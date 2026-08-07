// Prisma configuration (Prisma 7).
// `import "dotenv/config"` loads DATABASE_URL from .env for the Prisma CLI.
import "dotenv/config";
import { defineConfig } from "prisma/config";

// NOTE: there is no `directUrl` here on purpose. @prisma/config 7.9.0 types
// datasource as `{ url?, shadowDatabaseUrl? }` — `directUrl` is not a field it
// has, and adding it is a type error rather than a working setting, whatever
// a guide written against another version says. Migrations get their direct
// connection from scripts/migrate-deploy.mjs instead.
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
