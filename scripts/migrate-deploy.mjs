// Apply migrations over a DIRECT database connection.
//
// `prisma migrate deploy` takes a Postgres advisory lock so two deployments
// cannot apply migrations at once. An advisory lock is SESSION-scoped, and a
// transaction-mode connection pooler — Neon's `-pooler` endpoint, PgBouncer,
// Supabase's pooled port — hands out a different backend per transaction. The
// lock gets taken on one connection and looked for on another, so it never
// arrives and the build dies with:
//
//     P1002 ... Timed out trying to acquire a postgres advisory lock
//
// The app WANTS the pooled connection at runtime; it is migrations, and only
// migrations, that need a direct one. Prisma solves this with `directUrl`, but
// that field does not exist in @prisma/config 7.9.0 — its datasource type is
// `{ url?, shadowDatabaseUrl? }` and nothing else, so setting it is a type
// error rather than a working configuration. (Verified against the installed
// types, not assumed; a guide describing `directUrl` in prisma.config.ts is
// describing a different version.) So the override happens here instead.
//
// Hosts publish the direct URL under their own names, so those are accepted in
// order and nothing has to be configured by hand on the common setups.
import { spawnSync } from "node:child_process";

// PRODUCTION DEPLOYS ONLY, ON VERCEL.
//
// This script runs from `build`, and on Vercel `build` runs for EVERY
// deployment — previews included. Preview and production resolve the same
// DATABASE_URL unless somebody has deliberately split them, so without this
// guard every branch push migrates the production database: a schema change
// reaches real data on `git push`, before review, before merge, and without
// anybody deciding to deploy it. That was observed, not theorised — an
// additive migration landed in production from a preview build.
//
// Additive columns survive that. A destructive migration on a branch still
// being iterated on does not, and there is no undo.
//
// VERCEL_ENV is "production" | "preview" | "development" and is UNSET off
// Vercel, so a local `npm run build`, CI, and any other host keep migrating
// exactly as before — the guard narrows one platform's behaviour, it does not
// change what a migration means everywhere else.
//
// MIGRATE_ON_PREVIEW re-opens it for the setup that makes previews safe:
// giving Preview its own DATABASE_URL (a Neon branch, say). At that point
// preview builds SHOULD migrate, because the database they would migrate is
// their own — so this is a variable to set, not a line to delete.
const vercelEnv = process.env.VERCEL_ENV;
if (
  vercelEnv &&
  vercelEnv !== "production" &&
  !process.env.MIGRATE_ON_PREVIEW?.trim()
) {
  console.log(
    `Skipping migrations: VERCEL_ENV is "${vercelEnv}", not "production". ` +
      `This deployment shares the production database, and a preview build ` +
      `has no business changing its schema. Set MIGRATE_ON_PREVIEW=1 once ` +
      `previews have a database of their own.`,
  );
  process.exit(0);
}

const CANDIDATES = [
  // Set this yourself to override everything below.
  "DIRECT_URL",
  // Neon, including Vercel's Neon integration.
  "DATABASE_URL_UNPOOLED",
  // Vercel Postgres.
  "POSTGRES_URL_NON_POOLING",
];

const source = CANDIDATES.find((name) => process.env[name]?.trim());

// Falling back to DATABASE_URL keeps a single-connection setup — a local
// Postgres, or any host without a pooler — working with nothing configured.
const url = source ? process.env[source] : process.env.DATABASE_URL;

if (source) {
  console.log(`Applying migrations over ${source} (direct connection).`);
}

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy"],
  {
    stdio: "inherit",
    // Only DATABASE_URL is overridden, and only for this child process, so the
    // app's own runtime configuration is untouched.
    env: { ...process.env, DATABASE_URL: url },
  },
);

process.exit(result.status ?? 1);
