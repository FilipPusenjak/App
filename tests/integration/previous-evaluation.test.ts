// Choosing which evaluation counts as "the previous one".
//
// This feeds the anti-drift comparison, so picking the wrong row would anchor a
// real evaluation to the wrong scores. Three rules matter: most recent first,
// samples never count (their score is a hardcoded placeholder), and unreadable
// rows degrade to "no comparison" rather than throwing.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  buildDiffAgainstPrevious,
  loadPreviousContext,
} from "@/lib/evaluation/previous";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import { PROMPT_VERSION } from "@/lib/prompts/evaluation";
import { SCORE_KEYS } from "@/lib/prompts/evaluation/versions";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("prev");

function snapshot(itemTitles: string[]) {
  return buildSnapshot(
    {
      gradeLevel: "Grade 11",
      schoolName: null,
      schoolContext: null,
      curriculum: null,
      gpa: 3.8,
      gpaScale: "4.0",
      intendedMajor: "CS",
      careerGoal: null,
      testScores: [],
      resumeItems: itemTitles.map((title, n) => ({
        id: `i${n}`,
        type: "project",
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
          name: "MIT",
          country: "US",
          course: "CS",
          classification: null,
          priority: null,
          notes: null,
        },
      ],
    },
    "US",
  );
}

/** A minimal stored result good enough for parseStoredResult to accept. */
function storedResult(overall: number, gradeRelative: number, fit: number) {
  return JSON.stringify({
    overallScore: overall,
    gradeRelativeScore: gradeRelative,
    gradeContext: "context",
    headline: "h",
    summary: "s",
    strengths: [],
    weaknesses: [],
    narrativeCoherence: { score: 50, assessment: "a" },
    schoolFits: [
      {
        schoolName: "MIT",
        country: "United States",
        course: "CS",
        rubricUsed: "us-holistic",
        fitScore: fit,
        assessment: "a",
        keyRisks: [],
      },
    ],
    itemAssessments: [],
    actions: [],
    gaps: [],
    verifyThese: [],
  });
}

function createEvaluation(
  profileId: string,
  opts: {
    createdAt: Date;
    status?: string;
    isSample?: boolean;
    snapshotJson?: string | null;
    resultJson?: string | null;
    overallScore?: number | null;
    promptVersion?: string;
    model?: string | null;
  },
) {
  return prisma.evaluation.create({
    data: {
      profileId,
      status: opts.status ?? "completed",
      isSample: opts.isSample ?? false,
      inputSnapshotJson: opts.snapshotJson ?? JSON.stringify(snapshot(["Old item"])),
      resultJson: opts.resultJson ?? storedResult(40, 65, 30),
      overallScore: opts.overallScore ?? 40,
      promptVersion: opts.promptVersion,
      model: opts.model,
      createdAt: opts.createdAt,
    },
  });
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

describe.skipIf(!hasTestDb)("buildDiffAgainstPrevious", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("returns null when there is no previous evaluation", async () => {
    const { profile } = await createUserWithProfile(runTag, "first");
    await expect(
      buildDiffAgainstPrevious(profile.id, snapshot(["New item"])),
    ).resolves.toBeNull();
  });

  it("compares against the most recent real evaluation and carries its scores", async () => {
    const { profile } = await createUserWithProfile(runTag, "recent");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(120),
      resultJson: storedResult(20, 30, 10),
      overallScore: 20,
    });
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(10),
      resultJson: storedResult(45, 70, 33),
      overallScore: 45,
    });

    const diff = await buildDiffAgainstPrevious(
      profile.id,
      snapshot(["Old item", "New item"]),
    );
    expect(diff).not.toBeNull();
    // The newer of the two, not the older.
    expect(diff!.previousScores.overallScore).toBe(45);
    expect(diff!.previousScores.gradeRelativeScore).toBe(70);
    expect(diff!.previousScores.fitScores).toEqual({ MIT: 33 });
    expect(diff!.addedItems).toEqual(["New item"]);
    expect(diff!.onlyGained).toBe(true);
  });

  it("ignores samples — their score is a placeholder, not a measurement", async () => {
    const { profile } = await createUserWithProfile(runTag, "sample");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(60),
      resultJson: storedResult(45, 70, 33),
      overallScore: 45,
    });
    // A sample run afterwards must not become the anchor.
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(5),
      isSample: true,
      overallScore: 50,
      resultJson: storedResult(50, 50, 50),
    });

    const diff = await buildDiffAgainstPrevious(profile.id, snapshot(["Old item"]));
    expect(diff!.previousScores.overallScore).toBe(45);
  });

  it("ignores failed and pending runs", async () => {
    const { profile } = await createUserWithProfile(runTag, "failed");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(60),
      resultJson: storedResult(45, 70, 33),
      overallScore: 45,
    });
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(5),
      status: "failed",
      resultJson: null,
      overallScore: null,
    });
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(2),
      status: "pending",
      resultJson: null,
      overallScore: null,
    });

    const diff = await buildDiffAgainstPrevious(profile.id, snapshot(["Old item"]));
    expect(diff!.previousScores.overallScore).toBe(45);
  });

  it("never reaches another user's evaluations", async () => {
    const [mine, theirs] = await Promise.all([
      createUserWithProfile(runTag, "mine"),
      createUserWithProfile(runTag, "theirs"),
    ]);
    await createEvaluation(theirs.profile.id, {
      createdAt: minutesAgo(5),
      resultJson: storedResult(90, 90, 90),
      overallScore: 90,
    });

    // My profile has no evaluations, so there is nothing to compare against —
    // their 90 must not leak in.
    await expect(
      buildDiffAgainstPrevious(mine.profile.id, snapshot(["Old item"])),
    ).resolves.toBeNull();
  });

  it("degrades to null on a corrupt stored snapshot instead of throwing", async () => {
    const { profile } = await createUserWithProfile(runTag, "corrupt");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(5),
      snapshotJson: "{ not json at all",
    });
    await expect(
      buildDiffAgainstPrevious(profile.id, snapshot(["Old item"])),
    ).resolves.toBeNull();
  });

  it("degrades to null on a snapshot of an unexpected shape", async () => {
    const { profile } = await createUserWithProfile(runTag, "shape");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(5),
      snapshotJson: JSON.stringify({ hello: "world" }),
    });
    await expect(
      buildDiffAgainstPrevious(profile.id, snapshot(["Old item"])),
    ).resolves.toBeNull();
  });

  it("still compares when the stored result is unreadable, using overallScore", async () => {
    const { profile } = await createUserWithProfile(runTag, "partial");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(5),
      resultJson: "{ corrupt",
      overallScore: 38,
    });
    const diff = await buildDiffAgainstPrevious(
      profile.id,
      snapshot(["Old item", "New item"]),
    );
    // The denormalized column survives a corrupt result blob.
    expect(diff!.previousScores.overallScore).toBe(38);
    expect(diff!.previousScores.gradeRelativeScore).toBeNull();
    expect(diff!.addedItems).toEqual(["New item"]);
  });
});

describe.skipIf(!hasTestDb)("releasing the anchor when the scale changes", () => {
  // The renderer decides what to do with scaleChanged; this checks the wiring
  // that sets it — that the previous row's promptVersion is actually read back
  // out of the database and compared against the running one.
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("flags a previous evaluation produced by an older prompt", async () => {
    const { profile } = await createUserWithProfile(runTag, "scale-old");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(10),
      promptVersion: "evaluation/v6",
    });

    const diff = await buildDiffAgainstPrevious(profile.id, snapshot(["Old item"]));
    expect(diff).not.toBeNull();
    expect(diff!.previousScores.promptVersion).toBe("evaluation/v6");
    // v7-v9 redefined the year-relative score; overall and fit were last
    // redefined by v6 itself, so they stay anchored.
    expect(diff!.previousScores.rescoredKeys).toEqual(["gradeRelativeScore"]);
  });

  it("does NOT flag one produced by the prompt now running", async () => {
    const { profile } = await createUserWithProfile(runTag, "scale-current");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(10),
      promptVersion: PROMPT_VERSION,
    });

    const diff = await buildDiffAgainstPrevious(profile.id, snapshot(["Old item"]));
    expect(diff!.previousScores.rescoredKeys).toEqual([]);
  });

  it("treats a row with no recorded version as a different scale", async () => {
    // Safer than assuming it matches: an unknown scale is not this one.
    const { profile } = await createUserWithProfile(runTag, "scale-none");
    await createEvaluation(profile.id, { createdAt: minutesAgo(10) });

    const diff = await buildDiffAgainstPrevious(profile.id, snapshot(["Old item"]));
    expect(diff!.previousScores.rescoredKeys).toEqual([...SCORE_KEYS]);
  });
});


// ---------------------------------------------------------------------------
// What the route needs in order to pick a model.
//
// The policy itself is unit-tested; these check it is fed the truth. Getting
// this wrong is not a crashed request — it is a cheap model quietly judging a
// score it was supposed to derive from scratch, which shows up as an
// unexplained number weeks later.
// ---------------------------------------------------------------------------
describe.skipIf(!hasTestDb)("inputs to the model choice", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("releases every score when there is no previous run, so the first is a baseline", async () => {
    const { profile } = await createUserWithProfile(runTag, "mc-first");
    const ctx = await loadPreviousContext(profile.id, snapshot(["New item"]));
    expect(ctx.diff).toBeNull();
    expect(ctx.releasedScores).toEqual([...SCORE_KEYS]);
    expect(ctx.previousModel).toBeNull();
  });

  it("releases nothing when the previous run used the current prompt version", async () => {
    // The anchor is intact, so a follow-up on the cheaper model is reproducing
    // a calibration rather than inventing one.
    const { profile } = await createUserWithProfile(runTag, "mc-anchored");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(30),
      promptVersion: PROMPT_VERSION,
      model: "claude-opus-5",
    });
    const ctx = await loadPreviousContext(profile.id, snapshot(["New item"]));
    expect(ctx.diff).not.toBeNull();
    expect(ctx.releasedScores).toEqual([]);
    expect(ctx.previousModel).toBe("claude-opus-5");
  });

  it("releases the redefined scores when the previous run predates a recalibration", async () => {
    const { profile } = await createUserWithProfile(runTag, "mc-released");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(30),
      promptVersion: "evaluation/v8",
      model: "claude-opus-5",
    });
    const ctx = await loadPreviousContext(profile.id, snapshot(["New item"]));
    expect(ctx.releasedScores).toContain("gradeRelativeScore");
  });

  it("releases everything when the previous snapshot cannot be read", async () => {
    // No usable anchor, so this must not be treated as a follow-up just because
    // a row happens to exist at the current prompt version.
    const { profile } = await createUserWithProfile(runTag, "mc-corrupt");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(30),
      promptVersion: PROMPT_VERSION,
      snapshotJson: "{ not json",
      model: "claude-opus-5",
    });
    const ctx = await loadPreviousContext(profile.id, snapshot(["New item"]));
    expect(ctx.diff).toBeNull();
    expect(ctx.releasedScores).toEqual([...SCORE_KEYS]);
  });

  it("ignores a sample run when reporting the previous model", async () => {
    // Samples are placeholder text; anchoring or attributing to one would be
    // worse than having nothing.
    const { profile } = await createUserWithProfile(runTag, "mc-sample");
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(30),
      promptVersion: PROMPT_VERSION,
      model: "claude-opus-5",
    });
    await createEvaluation(profile.id, {
      createdAt: minutesAgo(5),
      isSample: true,
      model: null,
    });
    const ctx = await loadPreviousContext(profile.id, snapshot(["New item"]));
    expect(ctx.previousModel).toBe("claude-opus-5");
  });
});
