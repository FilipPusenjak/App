// No client component may reach a module that imports the database.
//
// This is not a style rule. A `"use client"` file that imports `@/lib/db` — or
// anything that transitively imports it — pulls the Prisma adapter into the
// browser bundle, which pulls `pg`, which tries to resolve `dns` and `fs`.
// Next then fails to compile EVERY PAGE IN THE APP, not just the offending one.
//
// It happened: the developments composer imported one constant, DEVELOPMENT_MAX,
// from the module that also holds the queries. The signup page stopped
// rendering. Typecheck passed, lint passed, unit and integration tests passed —
// only a browser noticed, because the failure is in bundling rather than in any
// code path a test executes.
//
// So the fix was a split (lib/validation/developments has no server imports)
// and this is the guard that keeps it split.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["app", "components"];
const SERVER_ONLY = ["@/lib/db", "@prisma/adapter-pg", "lib/generated/prisma"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Local VALUE imports, as repo-relative paths.
 *
 * `import type` is skipped because it is erased at compile time and reaches no
 * bundle at all — counting it would flag every form that imports a server
 * action's return type.
 */
function localImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of source.matchAll(/(?:^|\n)\s*import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/g)) {
    if (m[1]) continue;
    const spec = m[2]!;
    if (spec.startsWith("@/")) found.push(spec.slice(2));
    else if (spec.startsWith(".")) {
      const abs = resolve(dirname(file), spec);
      found.push(abs.replace(`${process.cwd()}/`, ""));
    }
  }
  return found;
}

function resolveFile(base: string): string | null {
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

/** True when a module is a server-action boundary Next does not bundle across. */
function isServerActionModule(file: string): boolean {
  return /^\s*["']use server["']/.test(readFileSync(file, "utf8"));
}

/**
 * Every module reachable from `file`, following local value imports.
 *
 * Traversal STOPS at a "use server" module. That is not a loophole — it is the
 * actual boundary: Next replaces a server action with an RPC stub, so its
 * imports never enter the client bundle. Following through one would flag every
 * form in the app and make this guard useless.
 */
function reachable(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  if (isServerActionModule(file)) return seen;
  for (const spec of localImports(file)) {
    if (SERVER_ONLY.some((s) => spec === s.replace("@/", "") || spec.startsWith(s.replace("@/", "")))) {
      seen.add(spec);
      continue;
    }
    const resolved = resolveFile(spec);
    if (resolved) reachable(resolved, seen);
  }
  return seen;
}

const clientComponents = ROOTS.flatMap((r) => walk(r)).filter((f) =>
  /^\s*["']use client["']/.test(readFileSync(f, "utf8")),
);

describe("the client/server boundary", () => {
  it("finds the client components to check", () => {
    // If this ever returns nothing the whole suite is vacuous.
    expect(clientComponents.length).toBeGreaterThan(5);
  });

  for (const file of clientComponents) {
    it(`${file} does not reach the database`, () => {
      const modules = reachable(file);
      const offenders = [...modules].filter((m) =>
        SERVER_ONLY.some((s) => m === s.replace("@/", "") || m.startsWith(s.replace("@/", ""))),
      );
      expect(
        offenders,
        `${file} transitively imports ${offenders.join(", ")}. A client ` +
          `component reaching the database pulls pg into the browser bundle, ` +
          `and Next then fails to compile every page in the app — not just ` +
          `this one. Move whatever it needs (constants, Zod schemas, types) ` +
          `into a module with no server imports, as lib/validation/developments ` +
          `does for lib/developments.`,
      ).toEqual([]);
    });
  }
});
