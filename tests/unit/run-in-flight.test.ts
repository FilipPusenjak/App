// The rules behind the "still running" banner.
//
// The bug this came from: run state lived in the button that started the run,
// so leaving the page took the only sign of a minute-long, credit-costing
// operation with it. Moving that state up is a React change and not much to
// test — but the two rules underneath it are worth pinning, because both fail
// silently and both fail toward lying to a student.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUN_LABELS,
  RUN_TIMEOUT_SECONDS,
  isStale,
  resultHref,
  runningLabel,
  type RunKind,
} from "@/lib/runs/in-flight";

const KINDS: RunKind[] = ["DEEP_REVIEW", "CHECK_IN", "PROJECTION"];

/** Where each kind's route declares how long it may take. */
const ROUTE_FOR: Record<RunKind, string> = {
  DEEP_REVIEW: "app/api/evaluate/route.ts",
  CHECK_IN: "app/api/evaluations/check-in/route.ts",
  PROJECTION: "app/api/project/route.ts",
};

function declaredMaxDuration(file: string): number {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  const match = src.match(/export const maxDuration\s*=\s*(\d+)/);
  if (!match) throw new Error(`no maxDuration in ${file}`);
  return Number(match[1]);
}

describe("giving up on a run that cannot still be going", () => {
  it("keeps showing a run that is within its time", () => {
    const startedAt = Date.now() - 30_000;
    for (const kind of KINDS) {
      expect(isStale({ kind, startedAt })).toBe(false);
    }
  });

  it("stops showing one that has outlived what its route allows", () => {
    for (const kind of KINDS) {
      const startedAt = Date.now() - (RUN_TIMEOUT_SECONDS[kind] + 1) * 1000;
      expect(isStale({ kind, startedAt })).toBe(true);
    }
  });

  it("gives a check-in less rope than a full review", () => {
    // Not cosmetic: a crashed serverless function leaves its row pending
    // forever, and this number is the only thing that ever clears it. Too
    // generous and a student stares at a spinner for a run that died.
    expect(RUN_TIMEOUT_SECONDS.CHECK_IN).toBeLessThan(
      RUN_TIMEOUT_SECONDS.DEEP_REVIEW,
    );
  });

  it("never gives up before the route itself would have", () => {
    // The failure this prevents: somebody raises maxDuration, and the banner
    // starts declaring runs dead while they are still working perfectly.
    for (const kind of KINDS) {
      expect(RUN_TIMEOUT_SECONDS[kind]).toBeGreaterThanOrEqual(
        declaredMaxDuration(ROUTE_FOR[kind]),
      );
    }
  });

  it("leaves a margin over the route's ceiling, not an exact match", () => {
    // The row is written before the model call and updated after it; a run
    // that used its whole budget still needs to get that write in.
    for (const kind of KINDS) {
      expect(RUN_TIMEOUT_SECONDS[kind]).toBeGreaterThan(
        declaredMaxDuration(ROUTE_FOR[kind]),
      );
    }
  });
});

describe("what the student is told", () => {
  it("sends each finished run to the page that renders it", () => {
    expect(resultHref("PROJECTION", "abc")).toBe("/projections/abc");
    expect(resultHref("DEEP_REVIEW", "abc")).toBe("/evaluations/abc");
    // A check-in IS an evaluation row, and is read on the same page.
    expect(resultHref("CHECK_IN", "abc")).toBe("/evaluations/abc");
  });

  it("warns about the wait only for the runs that have one", () => {
    expect(runningLabel("DEEP_REVIEW")).toMatch(/minute/);
    expect(runningLabel("PROJECTION")).toMatch(/minute/);
    // The cheap tier, and often free — promising a minute would be wrong.
    expect(runningLabel("CHECK_IN")).not.toMatch(/minute/);
  });

  it("names every kind, in the words the rest of the app uses", () => {
    for (const kind of KINDS) {
      expect(RUN_LABELS[kind].length).toBeGreaterThan(0);
      expect(runningLabel(kind)).not.toBe("");
    }
    expect(RUN_LABELS.DEEP_REVIEW).toBe("Deep Review");
    expect(RUN_LABELS.CHECK_IN).toBe("Check-In");
  });
});

describe("the buttons no longer own the run", () => {
  // The regression that started this: state in the component that unmounts.
  const buttons = [
    "app/(app)/evaluations/run-evaluation-button.tsx",
    "app/(app)/plans/run-projection-button.tsx",
  ];

  it("neither run button holds its own running state", () => {
    for (const file of buttons) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src).toMatch(/useRunProgress\(\)/);
      expect(src).not.toMatch(/useState/);
    }
  });

  it("neither run button navigates on its own", () => {
    // router.push from a component that may have unmounted is how a student
    // got yanked off the page they had walked to.
    for (const file of buttons) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/router\.push/);
    }
  });

  it("both disable while ANY run is going, not just their own", () => {
    for (const file of buttons) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src).toMatch(/disabled=\{busy/);
    }
  });
});

describe("deciding whether the student walked away", () => {
  // Caught in a browser, not in review, and worth pinning because the broken
  // version LOOKS right: the fetch that asks this question was started a
  // minute ago, so the `pathname` its closure captured is where the student
  // was STANDING WHEN THEY PRESSED THE BUTTON. Comparing that against the
  // launch path compares a value to itself — always equal, always "they never
  // moved" — and the student gets yanked onto an evaluation page mid-sentence
  // on whatever page they had walked to. Which is half the bug this file
  // exists to fix.
  const src = readFileSync(
    join(process.cwd(), "app/(app)/run-progress.tsx"),
    "utf8",
  );

  it("reads the live path from a ref, not the captured one", () => {
    expect(src).toMatch(/launchedFrom\.current === currentPath\.current/);
  });

  it("keeps that ref up to date as the student navigates", () => {
    expect(src).toMatch(/currentPath\.current = pathname/);
  });

  it("never compares against the closure's own pathname", () => {
    expect(src).not.toMatch(/launchedFrom\.current === pathname/);
  });
});
