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
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "@/lib/prompts/evaluation";
import { buildDiff } from "@/lib/evaluation/diff";
import {
  SCORE_KEYS,
  VERSION_HISTORY,
  scoresRedefinedSince,
} from "@/lib/prompts/evaluation/versions";
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
    promptVersion: PROMPT_VERSION,
    rescoredKeys: [],
  });
}

/** Same profile, but every score has been redefined since that run. */
function scaleChanged() {
  return buildDiff(snapshot(), snapshot(), {
    ...SCORES,
    promptVersion: "evaluation/v1",
    rescoredKeys: [...SCORE_KEYS],
  });
}

describe("the version string is what releases the anchor", () => {
  it("gives every archived prompt a version matching its filename", async () => {
    // The release compares version STRINGS, so a prompt file copied without
    // bumping its version would leave the anchor welded shut and a
    // recalibration silently inert — which is exactly what happened with v7.
    const files = fs
      .readdirSync(new URL("../../lib/prompts/evaluation/", import.meta.url))
      .filter((f) => /^v\d+\.ts$/.test(f))
      .sort();

    expect(files.length).toBeGreaterThan(1);
    const seen = new Set<string>();
    for (const file of files) {
      const mod = (await import(`@/lib/prompts/evaluation/${file.replace(/\.ts$/, "")}`)) as {
        PROMPT_VERSION: string;
      };
      expect(mod.PROMPT_VERSION).toBe(`evaluation/${file.replace(/\.ts$/, "")}`);
      expect(seen.has(mod.PROMPT_VERSION)).toBe(false);
      seen.add(mod.PROMPT_VERSION);
    }
  });

  it("ships the newest prompt as the active one", () => {
    const files = fs
      .readdirSync(new URL("../../lib/prompts/evaluation/", import.meta.url))
      .filter((f) => /^v\d+\.ts$/.test(f))
      .map((f) => Number(f.match(/^v(\d+)\.ts$/)![1]));
    expect(PROMPT_VERSION).toBe(`evaluation/v${Math.max(...files)}`);
  });
});

describe("when the definition of a score has changed", () => {
  const text = renderPreviousContext(scaleChanged())!;

  it("says outright that the old numbers are not a baseline", () => {
    expect(text).toMatch(/HAS CHANGED SINCE THAT EVALUATION/);
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
      /If the right answer under the current definitions is far from the old one, that IS the right answer/,
    );
    expect(text).toMatch(/Those numbers measured something else/);
  });

  it("marks each redefined number where it is printed", () => {
    expect(text).toMatch(/overallScore: 35\s+\[REDEFINED — not a baseline\]/);
  });

  it("still reports what the student actually changed", () => {
    // Releasing the score anchor must not throw away the profile diff.
    const changed = renderPreviousContext(
      buildDiff(snapshot(["Chemistry Club"]), snapshot(["Chemistry Club", "Debate"]), {
        ...SCORES,
        promptVersion: "evaluation/v1",
        rescoredKeys: [...SCORE_KEYS],
      }),
    )!;
    expect(changed).toMatch(/ADDED resume items: Debate/);
  });

  it("still requires the change to be explained to the student", () => {
    expect(text).toMatch(/say plainly that the way those scores are defined has changed/);
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
    expect(text).not.toMatch(/HAS CHANGED SINCE THAT EVALUATION/);
    expect(text).not.toMatch(/REDEFINED/);
  });

  it("keeps the rule that a score may not fall when work was only added", () => {
    const gained = renderPreviousContext(
      buildDiff(snapshot(["Chemistry Club"]), snapshot(["Chemistry Club", "Debate"]), {
        ...SCORES,
        promptVersion: PROMPT_VERSION,
        rescoredKeys: [],
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

// ── The bug this file's per-score release exists to fix ─────────────────────
//
// v9 redefined gradeRelativeScore and nothing else. Releasing every anchor
// together let the student's READINESS score fall eight points with no change
// to their profile and no change to what that number means — drift with
// nothing behind it, which is exactly what the anchor is for.
describe("releasing one score does not release the others", () => {
  const diff = buildDiff(snapshot(), snapshot(), {
    ...SCORES,
    promptVersion: "evaluation/v8",
    rescoredKeys: scoresRedefinedSince("evaluation/v8"),
  });
  const text = renderPreviousContext(diff)!;

  it("knows v9 changed only the year-relative score", () => {
    expect(scoresRedefinedSince("evaluation/v8")).toEqual(["gradeRelativeScore"]);
  });

  it("releases the redefined score", () => {
    expect(text).toMatch(/GRADERELATIVESCORE \(FOR YOUR YEAR\) HAS CHANGED/);
    expect(text).toMatch(/gradeRelativeScore: 60\s+\[REDEFINED/);
  });

  it("keeps readiness and fit anchored, and says so", () => {
    expect(text).toMatch(/ARE DEFINED EXACTLY AS BEFORE/);
    expect(text).toMatch(
      /a redefinition elsewhere is not a reason for them to move/,
    );
    expect(text).not.toMatch(/overallScore: 35\s+\[REDEFINED/);
  });

  it("still applies the stability rule, scoped to the unchanged scores", () => {
    expect(text).toMatch(/THE PROFILE IS UNCHANGED/);
    expect(text).toMatch(/This applies to overallScore \(readiness\) and fitScore/);
  });
});

describe("which scores each version redefined", () => {
  it("returns nothing when the previous run used the current prompt", () => {
    expect(scoresRedefinedSince(PROMPT_VERSION)).toEqual([]);
  });

  it("accumulates across several versions", () => {
    // v6 redefined overall and fit; v7-v9 redefined the year-relative score.
    expect(scoresRedefinedSince("evaluation/v5")).toEqual([
      "overallScore",
      "gradeRelativeScore",
      "fitScore",
    ]);
  });

  it("treats an unknown or missing version as an unknown scale", () => {
    // Safer than assuming it matches: pinning to a number whose provenance
    // cannot be established is how the old calibration survives.
    expect(scoresRedefinedSince(null)).toEqual([...SCORE_KEYS]);
    expect(scoresRedefinedSince("evaluation/v99")).toEqual([...SCORE_KEYS]);
  });

  it("lists every shipped prompt version, so a new one cannot be forgotten", () => {
    const files = fs
      .readdirSync(new URL("../../lib/prompts/evaluation/", import.meta.url))
      .filter((f) => /^v\d+\.ts$/.test(f))
      .map((f) => `evaluation/${f.replace(/\.ts$/, "")}`)
      .sort();
    expect(VERSION_HISTORY.map((v) => v.version).sort()).toEqual(files);
  });

  it("gives a reason for every redefinition", () => {
    for (const entry of VERSION_HISTORY) {
      expect(entry.why.length).toBeGreaterThan(10);
    }
  });
});
