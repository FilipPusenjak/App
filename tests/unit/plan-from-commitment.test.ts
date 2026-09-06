// Accepting a commitment has to put it in the plan.
//
// The bug: "I'll do this" flipped a Commitment to ACCEPTED and stopped there.
// Commitments and PlannedItems are different tables, and nothing crossed
// between them — so the student pressed the button, opened Plans, and found
// nothing. The projection reads PlannedItems, so the thing they had just
// committed to was also worth zero in the feature that prices their plan.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLAN_TITLE_MAX,
  plannedItemFromCommitment,
  shouldBeInPlan,
} from "@/lib/plans/from-commitment";

describe("which commitments belong in the plan", () => {
  it("puts an accepted one in", () => {
    expect(shouldBeInPlan("ACCEPTED")).toBe(true);
  });

  it("keeps one that has been started", () => {
    // Starting the work is not a reason to drop it off the plan.
    expect(shouldBeInPlan("IN_PROGRESS")).toBe(true);
  });

  it("leaves a proposal alone until the student says yes", () => {
    // A review suggesting something is not the student planning it.
    expect(shouldBeInPlan("PROPOSED")).toBe(false);
  });

  it("takes a finished or abandoned one back out", () => {
    // Neither is still PLANNED, and the projection prices what is planned.
    expect(shouldBeInPlan("COMPLETED")).toBe(false);
    expect(shouldBeInPlan("ABANDONED")).toBe(false);
  });

  it("does not put a superseded proposal in the plan", () => {
    // Set by a completing review on a proposal nobody ever answered.
    expect(shouldBeInPlan("SUPERSEDED")).toBe(false);
  });
});

describe("what the plan item looks like", () => {
  it("carries the commitment's own words as the title", () => {
    const item = plannedItemFromCommitment({
      description: "Read three papers on protein folding",
      dueDate: null,
    });
    expect(item.title).toBe("Read three papers on protein folding");
  });

  it("carries the due date across as the target date", () => {
    const due = new Date("2026-11-01T00:00:00.000Z");
    expect(
      plannedItemFromCommitment({ description: "x", dueDate: due }).targetDate,
    ).toEqual(due);
  });

  it("keeps the full text when the title has to be cut", () => {
    // A commitment's description is unbounded; PlannedItem.title is not.
    // Nothing the review asked for should be lost to a column width.
    const long = "a".repeat(PLAN_TITLE_MAX + 50);
    const item = plannedItemFromCommitment({ description: long, dueDate: null });

    expect(item.title.length).toBeLessThanOrEqual(PLAN_TITLE_MAX);
    expect(item.description).toBe(long);
  });

  it("does not duplicate the text when it already fits", () => {
    const item = plannedItemFromCommitment({
      description: "Short one",
      dueDate: null,
    });
    expect(item.description).toBeNull();
  });

  it("trims before measuring, so whitespace cannot pad a title", () => {
    const item = plannedItemFromCommitment({
      description: "   Join the debate team   ",
      dueDate: null,
    });
    expect(item.title).toBe("Join the debate team");
  });

  it("picks a neutral type rather than guessing a category", () => {
    // A commitment carries no category, and inferring one would be a guess
    // dressed as a fact. The student can change it on the Plans page.
    expect(plannedItemFromCommitment({ description: "x", dueDate: null }).type)
      .toBe("project");
  });
});

describe("the route actually does it", () => {
  const src = readFileSync(
    join(process.cwd(), "app/api/commitments/[id]/route.ts"),
    "utf8",
  );

  it("keeps the plan in step whenever the status changes", () => {
    expect(src).toMatch(/syncPlan\(/);
  });

  it("writes the status and the plan in one transaction", () => {
    // Half of this succeeding is the original bug with extra steps: a
    // commitment marked accepted and still nothing in the plan.
    expect(src).toMatch(/\$transaction/);
  });

  it("only ever touches items it created", () => {
    // Everything the student typed themselves has a null sourceCommitmentId
    // and must be untouchable from here.
    for (const write of src.match(/tx\.plannedItem\.\w+\(\{[\s\S]*?\n {4}\}\)/g) ??
      []) {
      expect(write).toMatch(/sourceCommitmentId/);
    }
    expect(src).toMatch(/tx\.plannedItem\.upsert/);
    expect(src).toMatch(/tx\.plannedItem\.deleteMany/);
  });
});
