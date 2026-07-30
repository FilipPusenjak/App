// The staleness rule for interrupted evaluations.
//
// Getting the threshold wrong in either direction is bad: too short and a run
// that is still legitimately in progress gets marked failed underneath the
// student; too long and a dead row sits as "pending" for ages.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STALE_PENDING_MINUTES,
  isStalePending,
} from "@/lib/evaluation/stale";

/**
 * Read the route's declared ceiling out of its source.
 *
 * Next requires `maxDuration` to be a statically analyzable literal, so it
 * cannot be imported from a shared constant — and importing the route module
 * itself here would drag in Auth.js and Prisma. Reading the source keeps the
 * assertion on the value that actually ships.
 */
function routeMaxDuration(): number {
  const source = readFileSync("app/api/evaluate/route.ts", "utf8");
  const match = source.match(/export const maxDuration = (\d+)/);
  if (!match) throw new Error("maxDuration is not declared in the route");
  return Number(match[1]);
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

describe("isStalePending", () => {
  it("leaves a run that just started alone", () => {
    expect(
      isStalePending({ status: "pending", createdAt: minutesAgo(0) }),
    ).toBe(false);
  });

  it("leaves a run inside the threshold alone", () => {
    expect(
      isStalePending({
        status: "pending",
        createdAt: minutesAgo(STALE_PENDING_MINUTES - 1),
      }),
    ).toBe(false);
  });

  it("presumes a much older pending run dead", () => {
    expect(
      isStalePending({
        status: "pending",
        createdAt: minutesAgo(STALE_PENDING_MINUTES + 1),
      }),
    ).toBe(true);
  });

  it("never touches an evaluation that already finished", () => {
    const old = minutesAgo(STALE_PENDING_MINUTES + 60);
    expect(isStalePending({ status: "completed", createdAt: old })).toBe(false);
    expect(isStalePending({ status: "failed", createdAt: old })).toBe(false);
  });
});

describe("threshold vs the route's execution ceiling", () => {
  it("the route declares a ceiling at all — the whole point of the fix", () => {
    // Without this the platform default applies and long evaluations are
    // killed mid-stream in production while working fine on localhost.
    expect(routeMaxDuration()).toBeGreaterThan(0);
  });

  it("gives a run comfortably longer than the route is allowed to live", () => {
    // If the sweep could fire while the function is still running, it would
    // mark a live evaluation failed and then overwrite the real result.
    expect(STALE_PENDING_MINUTES * 60).toBeGreaterThan(routeMaxDuration() * 2);
  });
});
