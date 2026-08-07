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
