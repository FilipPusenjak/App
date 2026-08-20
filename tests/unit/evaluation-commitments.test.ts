// Commitments belong to the evaluation now.
//
// They were produced by a separate band-based tier, which is retired. Nothing
// else ever created a Commitment row, so without a replacement the accept and
// decline controls would have gone permanently empty and the fortnightly
// check-in would have had nothing to follow up on — the loop would still have
// been wired, with nothing moving through it.
//
// Two things have to hold for the port to be real rather than nominal, and
// they pull in opposite directions:
//
//   THE MODEL MUST PRODUCE THEM. The schema requires 2-4, and the enum they
//   carry has to be stated in the prompt or a wrong guess discards the whole
//   response after it has been billed.
//
//   OLD ROWS MUST STILL READ. Every evaluation written before v11 has none,
//   which is nearly the whole table.
import { describe, expect, it } from "vitest";
import {
  evaluationResultSchema,
  storedEvaluationResultSchema,
} from "@/lib/validation/evaluation";
import { evaluationWireSchema } from "@/lib/validation/evaluation-wire";
import { buildSampleResult } from "@/lib/evaluation/sample";
import { RUNGS } from "@/lib/readiness/rungs";

/** A complete v11 result, minus whatever a test wants to vary. */
function result(over: Record<string, unknown> = {}) {
  return {
    overallScore: 58,
    gradeRelativeScore: 81,
    gradeContext: "Two different questions.",
    stageOutlook: {
      stageLabel: "Grade 11",
      whatMattersNow: "Depth",
      onTrack: "on_track",
      assessment: "Real, if narrow.",
      reachableNow: [],
      notYetExpected: [],
    },
    systemScores: [],
    changeSinceLast: "First run.",
    headline: "A headline.",
    summary: "A summary.",
    strengths: [],
    weaknesses: [],
    narrativeCoherence: { score: 70, assessment: "Coherent." },
    schoolFits: [],
    itemAssessments: [],
    actions: [],
    gaps: [],
    verifyThese: [],
    proposedCommitments: [
      { description: "Send the write-up to a teacher", targetRung: null, dueInWeeks: 4 },
      { description: "Enter the olympiad", targetRung: "contributor", dueInWeeks: 8 },
    ],
    ...over,
  };
}

describe("what the model must return", () => {
  it("accepts a result carrying two commitments", () => {
    expect(evaluationResultSchema.safeParse(result()).success).toBe(true);
  });

  it("accepts ONE, rather than discarding a paid response over a count", () => {
    // This asserted the opposite yesterday, and the opposite was wrong.
    // Structured outputs constrain shape, not counts, so `.min(2)` here did not
    // stop the model returning one — it only made Zod throw the whole response
    // away afterwards, once it had been generated and billed. The prompt still
    // asks for two to four; the schema no longer charges for the difference.
    const one = result({
      proposedCommitments: [
        { description: "d", targetRung: null, dueInWeeks: 4 },
      ],
    });
    expect(evaluationResultSchema.safeParse(one).success).toBe(true);
  });

  it("accepts FIVE, and lets the writer trim rather than the parser reject", () => {
    const five = result({
      proposedCommitments: Array.from({ length: 5 }, () => ({
        description: "d",
        targetRung: null,
        dueInWeeks: 4,
      })),
    });
    expect(evaluationResultSchema.safeParse(five).success).toBe(true);
  });

  it("accepts an empty list rather than losing the assessment with it", () => {
    // A review with no proposals is a degraded review. A review that was
    // thrown away is no review, and the student paid for it either way.
    expect(
      evaluationResultSchema.safeParse(result({ proposedCommitments: [] })).success,
    ).toBe(true);
  });

  it("accepts a due window the server will have to clamp", () => {
    // Every one of these was a rejection yesterday. All of them are a model
    // slip around an assessment that is probably fine.
    for (const weeks of [0, -4, 200, 1.5]) {
      const parsed = evaluationResultSchema.safeParse(
        result({
          proposedCommitments: [
            { description: "a", targetRung: null, dueInWeeks: weeks },
          ],
        }),
      );
      expect(parsed.success, `dueInWeeks ${weeks} was rejected`).toBe(true);
    }
  });

  it("accepts every real rung as a target", () => {
    for (const rung of RUNGS) {
      const parsed = evaluationResultSchema.safeParse(
        result({
          proposedCommitments: [
            { description: "a", targetRung: rung, dueInWeeks: 4 },
            { description: "b", targetRung: null, dueInWeeks: 6 },
          ],
        }),
      );
      expect(parsed.success, `rung ${rung} was rejected`).toBe(true);
    }
  });

  it("still rejects the human label printed beside a rung in the context", () => {
    // Kept strict, unlike the counts above, and the difference is that an enum
    // IS expressible in the output format — the API constrains generation to
    // these values, so a wrong one means something has genuinely gone wrong
    // rather than the model having merely miscounted.
    //
    // The exact failure that cost a real check-in: the context prints
    // `contributor (Doing real work in it)` and the model emitted the gloss.
    const parsed = evaluationResultSchema.safeParse(
      result({
        proposedCommitments: [
          { description: "a", targetRung: "Doing real work in it", dueInWeeks: 4 },
          { description: "b", targetRung: null, dueInWeeks: 6 },
        ],
      }),
    );
    expect(parsed.success).toBe(false);
  });

});

describe("what the app must still be able to read", () => {
  it("reads an evaluation written before commitments existed", () => {
    // Nearly the whole table. Requiring the field on the read path would
    // refuse the entire existing history — the failure stored-shape.ts
    // documents at length, reached from the schema side.
    const old = result();
    delete (old as { proposedCommitments?: unknown }).proposedCommitments;

    const parsed = storedEvaluationResultSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.proposedCommitments).toEqual([]);
  });

  it("reads a pre-v11 row that has only ONE commitment somehow", () => {
    // The strict minimum of two must not be enforced on the way back in. A
    // stored row is history; refusing to display it fixes nothing.
    const parsed = storedEvaluationResultSchema.safeParse(
      result({
        proposedCommitments: [
          { description: "d", targetRung: null, dueInWeeks: 4 },
        ],
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("the wire envelope carries them without growing the top level", () => {
  it("puts commitments inside analysis, not beside it", () => {
    // Grammar size, not taxonomy. Top-level siblings cost 2^n states and a
    // seventh would double the whole schema — the creep that caused a 400
    // taking every evaluation down at once.
    const props = Object.keys(
      (evaluationWireSchema as unknown as { shape: Record<string, unknown> }).shape,
    );
    expect(props).not.toContain("proposedCommitments");
    expect(props).toContain("analysis");
  });
});

describe("the sample never proposes anything real", () => {
  it("still passes the strict schema, so the shape is exercised", () => {
    const sample = buildSampleResult({
      student: { gradeLevel: "11" },
      targets: [],
      resumeItems: [],
      testScores: [],
    } as never);
    expect(evaluationResultSchema.safeParse(sample).success).toBe(true);
  });

  it("labels every commitment as sample output", () => {
    // A sample runs when there is no API key, and nothing in it was assessed.
    // A student accepting one would have the app tracking work that no
    // judgement stands behind.
    const sample = buildSampleResult({
      student: { gradeLevel: "11" },
      targets: [],
      resumeItems: [],
      testScores: [],
    } as never);
    expect(sample.proposedCommitments.length).toBeGreaterThan(0);
    for (const c of sample.proposedCommitments) {
      expect(c.description).toContain("SAMPLE OUTPUT");
    }
  });
});
