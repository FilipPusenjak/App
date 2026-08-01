// Carrying per-item assessments forward instead of paying to rewrite them.
//
// Per-item assessments are the largest single part of the output, and output
// is around 80% of what a run costs. A student who adds one activity to a list
// of twelve pays for all twelve to be judged again — and eleven of those
// answers should be identical, because eleven of the items did not change.
//
// The danger is that a wrong reuse is INVISIBLE: a stale verdict looks exactly
// like a fresh one. So most of what follows is about what must NOT be reused.
import { describe, expect, it } from "vitest";
import {
  findReusableItemAssessments,
  mergeItemAssessments,
  renderItemReuse,
  NO_REUSE,
} from "@/lib/evaluation/item-reuse";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import type { ItemAssessment } from "@/lib/validation/evaluation";

const VERSION = "evaluation/v10";

function snapshot(opts: {
  items?: { id: string; title: string; hours?: number | null }[];
  grade?: string;
  major?: string;
  targets?: { name: string; country: string; course: string }[];
} = {}) {
  return buildSnapshot(
    {
      gradeLevel: opts.grade ?? "Grade 9",
      schoolName: "A School",
      schoolContext: null,
      curriculum: "ib",
      gpa: 96,
      gpaScale: "100",
      intendedMajor: opts.major ?? "Medicine",
      careerGoal: "Doctor",
      testScores: [],
      resumeItems: (
        opts.items ?? [
          { id: "a", title: "Chemistry Club" },
          { id: "b", title: "Volunteering" },
        ]
      ).map((i) => ({
        id: i.id,
        type: "extracurricular",
        title: i.title,
        org: null,
        description: null,
        startDate: null,
        endDate: null,
        hoursPerWeek: i.hours ?? null,
        evidenceNotes: null,
      })),
      targetSchools: (
        opts.targets ?? [{ name: "Oxford", country: "GB", course: "Medicine" }]
      ).map((t) => ({ ...t, classification: null, priority: null, notes: null })),
    },
    "CA",
  );
}

function assessment(ref: string, title: string): ItemAssessment {
  return {
    itemRef: ref,
    itemTitle: title,
    helpfulness: "moderate",
    foundationalValue: "high",
    compoundsInto: "A leadership role.",
    verdict: "Real commitment.",
    howToStrengthen: "Take on a role.",
    bestFor: ["Oxford"],
  };
}

const PREVIOUS = [assessment("R1", "Chemistry Club"), assessment("R2", "Volunteering")];

describe("what can be carried over", () => {
  it("reuses items that are byte-identical", () => {
    const reuse = findReusableItemAssessments(
      snapshot(),
      PREVIOUS,
      snapshot(),
      VERSION,
      VERSION,
    );
    expect(reuse.skipRefs).toEqual(["R1", "R2"]);
    expect(reuse.byRef.R1!.verdict).toBe("Real commitment.");
  });

  it("assesses only the new item when one is added", () => {
    const after = snapshot({
      items: [
        { id: "a", title: "Chemistry Club" },
        { id: "b", title: "Volunteering" },
        { id: "c", title: "Debate" },
      ],
    });
    const reuse = findReusableItemAssessments(snapshot(), PREVIOUS, after, VERSION, VERSION);
    expect(reuse.skipRefs).toEqual(["R1", "R2"]);
    expect(reuse.byRef.R3).toBeUndefined();
  });

  it("follows an item whose position moved, rather than its ref", () => {
    // Refs are positional, so deleting the first item shifts every other one.
    // Matching by ref instead of content would hand R1's verdict to R2's item.
    const after = snapshot({ items: [{ id: "b", title: "Volunteering" }] });
    const reuse = findReusableItemAssessments(snapshot(), PREVIOUS, after, VERSION, VERSION);
    expect(reuse.skipRefs).toEqual(["R1"]);
    expect(reuse.byRef.R1!.itemTitle).toBe("Volunteering");
    expect(reuse.byRef.R1!.itemRef).toBe("R1");
  });
});

describe("what must NOT be carried over", () => {
  it("drops an item whose content changed at all", () => {
    const after = snapshot({
      items: [
        { id: "a", title: "Chemistry Club", hours: 3 },
        { id: "b", title: "Volunteering" },
      ],
    });
    const reuse = findReusableItemAssessments(snapshot(), PREVIOUS, after, VERSION, VERSION);
    expect(reuse.skipRefs).toEqual(["R2"]);
  });

  it("reuses nothing when the prompt version changed", () => {
    // A new version may have redefined what these fields mean, and mixing two
    // definitions inside one list is worse than paying for the re-assessment.
    expect(
      findReusableItemAssessments(snapshot(), PREVIOUS, snapshot(), "evaluation/v9", VERSION),
    ).toEqual(NO_REUSE);
    expect(
      findReusableItemAssessments(snapshot(), PREVIOUS, snapshot(), null, VERSION),
    ).toEqual(NO_REUSE);
  });

  it("reuses nothing when the student changed year", () => {
    // foundationalValue is a judgement about stage: the same club is worth
    // something different in Grade 9 and in Grade 12.
    expect(
      findReusableItemAssessments(
        snapshot(),
        PREVIOUS,
        snapshot({ grade: "Grade 12" }),
        VERSION,
        VERSION,
      ),
    ).toEqual(NO_REUSE);
  });

  it("reuses nothing when the intended subject changed", () => {
    expect(
      findReusableItemAssessments(
        snapshot(),
        PREVIOUS,
        snapshot({ major: "History" }),
        VERSION,
        VERSION,
      ),
    ).toEqual(NO_REUSE);
  });

  it("reuses nothing when the target list changed", () => {
    // helpfulness and bestFor are stated per target, so adding a school makes
    // every previous verdict an answer to a different question.
    expect(
      findReusableItemAssessments(
        snapshot(),
        PREVIOUS,
        snapshot({
          targets: [
            { name: "Oxford", country: "GB", course: "Medicine" },
            { name: "Cornell", country: "US", course: "Biology" },
          ],
        }),
        VERSION,
        VERSION,
      ),
    ).toEqual(NO_REUSE);
  });

  it("drops an assessment missing fields the current contract requires", () => {
    // A row from before foundationalValue existed would carry it forward as
    // undefined and fail validation at the end of the run.
    const old = [{ ...assessment("R1", "Chemistry Club"), foundationalValue: undefined }];
    const reuse = findReusableItemAssessments(snapshot(), old, snapshot(), VERSION, VERSION);
    expect(reuse.skipRefs).toEqual([]);
  });
});

describe("merging the model's answer with what was carried over", () => {
  const snap = snapshot({
    items: [
      { id: "a", title: "Chemistry Club" },
      { id: "b", title: "Volunteering" },
      { id: "c", title: "Debate" },
    ],
  });
  const reuse = findReusableItemAssessments(snapshot(), PREVIOUS, snap, VERSION, VERSION);

  it("produces one assessment per item, in snapshot order", () => {
    const merged = mergeItemAssessments(snap, [assessment("R3", "Debate")], reuse);
    expect(merged.map((a) => a.itemRef)).toEqual(["R1", "R2", "R3"]);
    expect(merged.map((a) => a.itemTitle)).toEqual([
      "Chemistry Club",
      "Volunteering",
      "Debate",
    ]);
  });

  it("prefers a fresh assessment over a stored one", () => {
    const fresh = { ...assessment("R1", "Chemistry Club"), verdict: "Reconsidered." };
    const merged = mergeItemAssessments(snap, [fresh], reuse);
    expect(merged.find((a) => a.itemRef === "R1")!.verdict).toBe("Reconsidered.");
  });

  it("drops a ref that does not exist in this snapshot", () => {
    // A hallucinated ref should not reach the student's results page.
    const merged = mergeItemAssessments(snap, [assessment("R9", "Invented")], reuse);
    expect(merged.map((a) => a.itemRef)).toEqual(["R1", "R2"]);
  });

  it("returns exactly the model's output when nothing is reused", () => {
    const merged = mergeItemAssessments(
      snap,
      [assessment("R1", "Chemistry Club"), assessment("R2", "Volunteering")],
      NO_REUSE,
    );
    expect(merged).toHaveLength(2);
  });
});

describe("what the model is told", () => {
  const snap = snapshot({
    items: [
      { id: "a", title: "Chemistry Club" },
      { id: "b", title: "Volunteering" },
      { id: "c", title: "Debate" },
    ],
  });
  const reuse = findReusableItemAssessments(snapshot(), PREVIOUS, snap, VERSION, VERSION);
  const text = renderItemReuse(reuse, snap)!;

  it("names what to skip and what is left", () => {
    expect(text).toContain("R1, R2");
    expect(text).toMatch(/Assess ONLY these, which are new or changed: R3/);
    expect(text).toMatch(/DO NOT include them in itemAssessments/);
  });

  it("says the carried-over items still count towards everything else", () => {
    // They are part of the profile; only their per-item write-up is skipped.
    expect(text).toMatch(/count towards every score, every strength and weakness/);
  });

  it("asks for an empty array when nothing changed at all", () => {
    const all = findReusableItemAssessments(snapshot(), PREVIOUS, snapshot(), VERSION, VERSION);
    expect(renderItemReuse(all, snapshot())).toMatch(
      /Every item is unchanged, so itemAssessments must be an empty array/,
    );
  });

  it("says nothing at all when there is nothing to reuse", () => {
    expect(renderItemReuse(NO_REUSE, snap)).toBeNull();
  });
});
