// A preview build must not migrate the production database.
//
// scripts/migrate-deploy.mjs runs from `build`, and on Vercel `build` runs for
// every deployment — previews included. Preview and production resolve the
// same DATABASE_URL unless somebody has deliberately split them, so without
// the guard a branch push applies migrations to real data before review,
// before merge, and without anybody deciding to deploy. That happened.
//
// Executed rather than grepped: the claim is about what the script DOES, and
// the skip path exits before spawning anything, so this needs no database and
// no network.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "migrate-deploy.mjs");

function run(env: Record<string, string | undefined>) {
  return spawnSync("node", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      // A URL that would fail loudly if the script ever tried to use it, so a
      // regression cannot pass by quietly connecting to something real.
      DATABASE_URL: "postgresql://nobody@127.0.0.1:1/should-never-be-used",
      DIRECT_URL: undefined,
      DATABASE_URL_UNPOOLED: undefined,
      POSTGRES_URL_NON_POOLING: undefined,
      MIGRATE_ON_PREVIEW: undefined,
      ...env,
    },
  });
}

describe("migrations only run for a production deploy", () => {
  it("skips on a preview build, successfully", () => {
    const result = run({ VERCEL_ENV: "preview" });
    // Exit 0, not a failure: the build must carry on and deploy the preview.
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Skipping migrations/);
    // The thing that must not have happened.
    expect(result.stdout).not.toMatch(/migrations found/);
    expect(result.stdout).not.toMatch(/applied/i);
  });

  it("skips on Vercel's development environment too", () => {
    const result = run({ VERCEL_ENV: "development" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Skipping migrations/);
  });

  it("says which variable re-opens it, rather than inviting an edit", () => {
    // Giving previews their own database is the real fix; when somebody does
    // that, previews SHOULD migrate again. A variable survives a rebase in a
    // way a deleted guard does not.
    expect(run({ VERCEL_ENV: "preview" }).stdout).toMatch(/MIGRATE_ON_PREVIEW/);
  });

  it("does NOT skip once previews have a database of their own", () => {
    const result = run({ VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "1" });
    expect(result.stdout).not.toMatch(/Skipping migrations/);
  });

  it("does NOT skip off Vercel, where VERCEL_ENV is unset", () => {
    // A local build, CI, or any other host has to keep working exactly as it
    // did — this guard narrows one platform's behaviour, not everyone's.
    const result = run({ VERCEL_ENV: undefined });
    expect(result.stdout).not.toMatch(/Skipping migrations/);
  });

  it("does NOT skip a production deploy", () => {
    const result = run({ VERCEL_ENV: "production" });
    expect(result.stdout).not.toMatch(/Skipping migrations/);
  });
});
