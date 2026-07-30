// Loading the previous projection to anchor the next one.
//
// This is what stops a student's numbers changing when their plans didn't —
// the inconsistency they reported. Picking the wrong prior row, or leaking
// someone else's, would be worse than having no anchor at all.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildPreviousProjectionContext } from "@/lib/evaluation/projection-previous";
import { buildProjectionSnapshot } from "@/lib/evaluation/projection-snapshot";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("projprev");

const baseProfile = {
  gradeLevel: "Grade 9",
  schoolName: null,
  schoolContext: null,
  curriculum: null,
  gpa: 3.9,
  gpaScale: "4.0",
  intendedMajor: "Medicine",
  careerGoal: null,
  testScores: [],
  resumeItems: [],
  targetSchools: [
    { name: "Oxford", country: "GB", course: "Medicine", classification: null, priority: null, notes: null },
  ],
};

function plan(id: string, title: string) {
  return {
    id,
    type: "leadership",
    title,
    org: null,
    description: null,
    targetDate: null,
    hoursPerWeek: null,
  };
}

function snapshotWith(titles: string[]) {
  return buildProjectionSnapshot(
    baseProfile,
    "US",
    titles.map((t, i) => plan(`p${i}`, t)),
    {
      evaluationId: "e1",
      capturedAt: "2026-07-20T00:00:00.000Z",
      overallScore: 32,
      systemReadiness: { "uk-course-specific": 28 },
    },
  );
}

function storedProjection(projected: number, worth: Record<string, string>) {
  return JSON.stringify({
    headline: "h",
    summary: "s",
    changeSinceLastProjection: "first",
    systemProjections: [
      {
        rubricId: "uk-course-specific",
        systemLabel: "United Kingdom — course-specific admissions",
        currentReadiness: 28,
        projectedReadiness: projected,
        reasoning: "r",
      },
    ],
    planAssessments: Object.entries(worth).map(([planTitle, worthDoing]) => ({
      planRef: "P1",
      planTitle,
      worthDoing,
      verdict: "v",
      wouldMoveNeedleFor: ["Oxford"],
      makeItCount: "m",
    })),
    sequencing: [],
    cautions: [],
    verifyThese: [],
  });
}

function createProjection(
  profileId: string,
  opts: {
    createdAt: Date;
    titles: string[];
    projected?: number;
    worth?: Record<string, string>;
    status?: string;
    isSample?: boolean;
    resultJson?: string | null;
  },
) {
  return prisma.projection.create({
    data: {
      profileId,
      status: opts.status ?? "completed",
      isSample: opts.isSample ?? false,
      inputSnapshotJson: JSON.stringify(snapshotWith(opts.titles)),
      resultJson:
        opts.resultJson === undefined
          ? storedProjection(opts.projected ?? 35, opts.worth ?? { [opts.titles[0]!]: "low" })
          : opts.resultJson,
      createdAt: opts.createdAt,
    },
  });
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

describe.skipIf(!hasTestDb)("buildPreviousProjectionContext", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("returns null on the first ever projection", async () => {
    const { profile } = await createUserWithProfile(runTag, "first");
    await expect(
      buildPreviousProjectionContext(profile.id, snapshotWith(["Club"])),
    ).resolves.toBeNull();
  });

  it("reports an unchanged plan list, carrying numbers and verdicts", async () => {
    const { profile } = await createUserWithProfile(runTag, "same");
    await createProjection(profile.id, {
      createdAt: minutesAgo(30),
      titles: ["Club"],
      projected: 41,
      worth: { Club: "moderate" },
    });

    const ctx = await buildPreviousProjectionContext(
      profile.id,
      snapshotWith(["Club"]),
    );
    expect(ctx!.plansUnchanged).toBe(true);
    expect(ctx!.projectedByRubric).toEqual({ "uk-course-specific": 41 });
    expect(ctx!.worthByPlanTitle).toEqual({ Club: "moderate" });
  });

  it("detects added and removed plans", async () => {
    const { profile } = await createUserWithProfile(runTag, "diff");
    await createProjection(profile.id, {
      createdAt: minutesAgo(30),
      titles: ["Club", "Mandarin"],
    });

    const ctx = await buildPreviousProjectionContext(
      profile.id,
      snapshotWith(["Club", "UCAT prep"]),
    );
    expect(ctx!.addedPlans).toEqual(["UCAT prep"]);
    expect(ctx!.removedPlans).toEqual(["Mandarin"]);
    expect(ctx!.plansUnchanged).toBe(false);
  });

  it("uses the most recent projection, not the oldest", async () => {
    const { profile } = await createUserWithProfile(runTag, "recent");
    await createProjection(profile.id, {
      createdAt: minutesAgo(120),
      titles: ["Club"],
      projected: 20,
    });
    await createProjection(profile.id, {
      createdAt: minutesAgo(5),
      titles: ["Club"],
      projected: 44,
    });

    const ctx = await buildPreviousProjectionContext(
      profile.id,
      snapshotWith(["Club"]),
    );
    expect(ctx!.projectedByRubric["uk-course-specific"]).toBe(44);
  });

  it("ignores samples, whose numbers are placeholders", async () => {
    const { profile } = await createUserWithProfile(runTag, "sample");
    await createProjection(profile.id, {
      createdAt: minutesAgo(60),
      titles: ["Club"],
      projected: 44,
    });
    await createProjection(profile.id, {
      createdAt: minutesAgo(5),
      titles: ["Club"],
      projected: 50,
      isSample: true,
    });

    const ctx = await buildPreviousProjectionContext(
      profile.id,
      snapshotWith(["Club"]),
    );
    expect(ctx!.projectedByRubric["uk-course-specific"]).toBe(44);
  });

  it("never reaches another user's projections", async () => {
    const [mine, theirs] = await Promise.all([
      createUserWithProfile(runTag, "mine"),
      createUserWithProfile(runTag, "theirs"),
    ]);
    await createProjection(theirs.profile.id, {
      createdAt: minutesAgo(5),
      titles: ["Club"],
      projected: 99,
    });

    await expect(
      buildPreviousProjectionContext(mine.profile.id, snapshotWith(["Club"])),
    ).resolves.toBeNull();
  });

  it("degrades to null on an unreadable prior result", async () => {
    const { profile } = await createUserWithProfile(runTag, "corrupt");
    await createProjection(profile.id, {
      createdAt: minutesAgo(5),
      titles: ["Club"],
      resultJson: "{ not json",
    });
    await expect(
      buildPreviousProjectionContext(profile.id, snapshotWith(["Club"])),
    ).resolves.toBeNull();
  });
});
