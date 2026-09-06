// What a profile needs before it can be evaluated, and the two surfaces that
// have to agree about it.
//
// Written against the real shape of the problem: of sixteen profiles on the
// deployment, six could not run anything, and three of those had added a
// target school and then stopped. Each case below is one of those states.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockingReason,
  canRunEvaluation,
  firstRunSteps,
  type ProfileCounts,
} from "@/lib/evaluation/prerequisites";

const empty: ProfileCounts = { targets: 0, resumeItems: 0, testScores: 0 };
const counts = (over: Partial<ProfileCounts>): ProfileCounts => ({
  ...empty,
  ...over,
});

describe("whether a profile can be evaluated at all", () => {
  it("needs a target and something to assess", () => {
    expect(canRunEvaluation(counts({ targets: 1, resumeItems: 1 }))).toBe(true);
    expect(canRunEvaluation(counts({ targets: 1, testScores: 1 }))).toBe(true);
  });

  it("refuses an empty profile", () => {
    expect(canRunEvaluation(empty)).toBe(false);
  });

  it("refuses a profile with a target and nothing in it", () => {
    // The three-profile case: real intent, then stopped.
    expect(canRunEvaluation(counts({ targets: 2 }))).toBe(false);
  });

  it("refuses a full profile aimed at nowhere", () => {
    // No target means no rubric — not a weaker evaluation, no evaluation.
    expect(
      canRunEvaluation(counts({ resumeItems: 9, testScores: 3 })),
    ).toBe(false);
  });

  it("takes one activity OR one score, never both", () => {
    expect(canRunEvaluation(counts({ targets: 1, resumeItems: 1 }))).toBe(true);
    expect(canRunEvaluation(counts({ targets: 1, testScores: 1 }))).toBe(true);
  });
});

describe("the checklist a student is shown", () => {
  it("shows both steps even when neither is done", () => {
    // Revealing the second requirement only after the first is met reads as
    // moving goalposts to somebody deciding whether to spend ten minutes.
    expect(firstRunSteps(empty)).toHaveLength(2);
  });

  it("still shows both steps when one is done, and marks it", () => {
    const steps = firstRunSteps(counts({ targets: 1 }));
    expect(steps).toHaveLength(2);
    expect(steps.find((s) => s.id === "targets")?.done).toBe(true);
    expect(steps.find((s) => s.id === "content")?.done).toBe(false);
  });

  it("marks everything done once the profile is ready", () => {
    const steps = firstRunSteps(counts({ targets: 1, testScores: 1 }));
    expect(steps.every((s) => s.done)).toBe(true);
    expect(canRunEvaluation(counts({ targets: 1, testScores: 1 }))).toBe(true);
  });

  it("points each unfinished step at the page that fixes it", () => {
    const steps = firstRunSteps(empty);
    expect(steps.find((s) => s.id === "targets")?.href).toBe("/targets");
    expect(steps.find((s) => s.id === "content")?.href).toBe("/profile");
  });

  it("says why each step is needed, not just what it is", () => {
    for (const step of firstRunSteps(empty)) {
      expect(step.detail.length).toBeGreaterThan(20);
      expect(step.detail).not.toBe(step.label);
    }
  });
});

describe("the checklist and the disabled button agree", () => {
  it("names targets first when both are missing", () => {
    // Both surfaces must not disagree about which thing to do next.
    expect(blockingReason(empty)).toMatch(/target/i);
    expect(firstRunSteps(empty)[0]!.id).toBe("targets");
  });

  it("moves on to content once a target exists", () => {
    expect(blockingReason(counts({ targets: 1 }))).toMatch(/resume|score/i);
  });

  it("gives no reason at all once the profile is ready", () => {
    // Undefined so a caller can pass it straight to a disabled prop.
    expect(blockingReason(counts({ targets: 1, resumeItems: 1 }))).toBeUndefined();
  });

  it("is the ONE copy of the rule — the Evaluations page reads it", () => {
    // It used to be written inline there and nowhere else, which is why the
    // dashboard could not tell anybody what was missing.
    const src = readFileSync(
      join(process.cwd(), "app/(app)/evaluations/page.tsx"),
      "utf8",
    );
    expect(src).toMatch(/blockingReason\(/);
    // And no second, driftable copy of the sentence left behind.
    expect(src).not.toMatch(/Add a target school first —/);
  });
});
