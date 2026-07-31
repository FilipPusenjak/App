// Why a recalibration had no effect on the person who asked for it.
//
// v7 redefined gradeRelativeScore against a much broader pool, which should
// have moved a strong student's number up substantially. It moved it not at
// all. The reason was not the new wording — it was that the new wording was
// arguing with an older instruction that had a number attached to it.
//
// Every run is handed the previous evaluation's scores, and when the profile
// has not changed it is told: "Your scores must therefore stay essentially the
// same as last time (within a point or two)." Against that, an abstract new
// definition loses. So consistency anchoring quietly cancelled the fix — and
// would have cancelled every future one, for exactly the students with the
// most history and the most miscalibrated numbers.
//
// Consistency and recalibration are opposites. The anchor has to be released
// when the meaning of the number changes, and only then.
import { describe, expect, it } from "vitest";
import { buildDiff } from "@/lib/evaluation/diff";
import { renderPreviousContext } from "@/lib/prompts/evaluation/render";
import { buildSnapshot } from "@/lib/evaluation/snapshot";

function snapshot(items: string[] = ["Chemistry Club"]) {
  return buildSnapshot(
    {
      gradeLevel: "Grade 9",
      schoolName: "Some School",
      schoolContext: null,
      curriculum: "ib",
      gpa: 96,
      gpaScale: "100",
      intendedMajor: "Medicine",
      careerGoal: null,
      testScores: [],
      resumeItems: items.map((title, n) => ({
        id: `item-${n}`,
        type: "extracurricular",
        title,
        org: null,
        description: null,
        startDate: null,
        endDate: null,
        hoursPerWeek: null,
        evidenceNotes: null,
      })),
      targetSchools: [
        {
          name: "Oxford",
          country: "GB",
          course: "Medicine",
          classification: null,
          priority: null,
          notes: null,
        },
      ],
    },
    "CA",
  );
}

const SCORES = {
  overallScore: 35,
  gradeRelativeScore: 60,
  fitScores: { Oxford: 30 },
};

/** Same profile, same prompt version: the ordinary consistency case. */
function sameScale() {
  return buildDiff(snapshot(), snapshot(), {
    ...SCORES,
    promptVersion: "evaluation/v7",
    scaleChanged: false,
  });
}

/** Same profile, but the previous run used an older prompt. */
function scaleChanged() {
  return buildDiff(snapshot(), snapshot(), {
    ...SCORES,
    promptVersion: "evaluation/v6",
    scaleChanged: true,
  });
}

describe("when the definition of a score has changed", () => {
  const text = renderPreviousContext(scaleChanged())!;

  it("says outright that the old numbers are not a baseline", () => {
    expect(text).toMatch(/THE SCORING DEFINITIONS HAVE CHANGED/);
    expect(text).toMatch(/They are NOT a baseline/);
  });

  it("removes the instruction that was cancelling the fix", () => {
    // This is the whole bug. With the profile unchanged, the old build said
    // "your scores must stay essentially the same" — which pins the new
    // definition to a measurement of the old one.
    expect(text).not.toMatch(/must therefore stay essentially the same/);
    expect(text).not.toMatch(/within a point or two/);
  });

  it("tells the model to re-derive rather than to justify a difference", () => {
    expect(text).toMatch(/as if scoring this profile for the first time/);
    expect(text).toMatch(/do NOT treat a difference as drift needing justification/i);
  });

  it("says a large move is the CORRECT answer, not an error", () => {
    expect(text).toMatch(
      /If the correct number under the current definitions is far from the old one, that IS the correct answer/,
    );
    expect(text).toMatch(/the old number was measuring something else/);
  });

  it("labels the old scores as context so they are not read as targets", () => {
    expect(text).toMatch(/FOR CONTEXT ONLY/);
  });

  it("still reports what the student actually changed", () => {
    // Releasing the score anchor must not throw away the profile diff.
    const changed = renderPreviousContext(
      buildDiff(snapshot(["Chemistry Club"]), snapshot(["Chemistry Club", "Debate"]), {
        ...SCORES,
        promptVersion: "evaluation/v6",
        scaleChanged: true,
      }),
    )!;
    expect(changed).toMatch(/ADDED resume items: Debate/);
  });

  it("still requires the change to be explained to the student", () => {
    expect(text).toMatch(/say plainly that the way these scores are defined has changed/);
    expect(text).toMatch(/a change in the measurement rather than a change in them/);
    expect(text).toMatch(/Use changeSinceLast/);
  });
});

describe("when the definition has NOT changed, nothing is loosened", () => {
  const text = renderPreviousContext(sameScale())!;

  it("keeps the stability rule that stops scores drifting on identical input", () => {
    expect(text).toMatch(/THE PROFILE IS UNCHANGED/);
    expect(text).toMatch(/must therefore stay essentially the same/);
  });

  it("does not mention a scale change", () => {
    expect(text).not.toMatch(/SCORING DEFINITIONS HAVE CHANGED/);
    expect(text).not.toMatch(/FOR CONTEXT ONLY/);
  });

  it("keeps the rule that a score may not fall when work was only added", () => {
    const gained = renderPreviousContext(
      buildDiff(snapshot(["Chemistry Club"]), snapshot(["Chemistry Club", "Debate"]), {
        ...SCORES,
        promptVersion: "evaluation/v7",
        scaleChanged: false,
      }),
    )!;
    expect(gained).toMatch(/MUST NOT FALL/);
  });

  it("treats an absent flag as no change, so older callers behave as before", () => {
    const legacy = renderPreviousContext(buildDiff(snapshot(), snapshot(), SCORES))!;
    expect(legacy).toMatch(/THE PROFILE IS UNCHANGED/);
    expect(legacy).not.toMatch(/SCORING DEFINITIONS HAVE CHANGED/);
  });
});
