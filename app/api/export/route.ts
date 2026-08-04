// GET /api/export — download everything this account holds, as JSON.
//
// Two jobs: it's the backup you otherwise don't have, and it's what makes
// account deletion a reasonable thing to offer — you can take your data with
// you before you erase it.
//
// Scoped to the session like every other read. No id is accepted from the
// client, so there is no way to request someone else's export.
//
// EVERY student, not the selected one. An account can hold several, deleting
// the account erases all of them, and an export that quietly covered only the
// one currently on screen would be a backup that silently isn't.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getOwnedProfiles } from "@/lib/ownership";
import { prisma } from "@/lib/db";
import { parseStoredResult } from "@/lib/validation/evaluation";
import { parseStoredProjection } from "@/lib/validation/projection";

export async function GET() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const [user, owned] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: sessionUser.id },
      // Explicit select: never let the password hash into an export.
      select: {
        email: true,
        name: true,
        countryOfOrigin: true,
        createdAt: true,
      },
    }),
    getOwnedProfiles(),
  ]);

  // One query per relation across all of this account's profiles, rather than
  // one query per profile: an agency with thirty students would otherwise make
  // a hundred round trips to build one file.
  const profileIds = owned.map((p) => p.id);
  const [full, evaluations, plannedItems, projections] = await Promise.all([
    prisma.profile.findMany({
      where: { id: { in: profileIds } },
      include: {
        testScores: { orderBy: { createdAt: "asc" } },
        resumeItems: { orderBy: [{ startDate: "desc" }, { createdAt: "desc" }] },
        targetSchools: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.evaluation.findMany({
      where: { profileId: { in: profileIds } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.plannedItem.findMany({
      where: { profileId: { in: profileIds } },
      orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.projection.findMany({
      where: { profileId: { in: profileIds } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const by = <T extends { profileId: string }>(rows: T[], id: string) =>
    rows.filter((r) => r.profileId === id);

  const students = full.map((profile) => ({
    id: profile.id,
    studentName: profile.studentName,
    profile: {
      gradeLevel: profile.gradeLevel,
      schoolName: profile.schoolName,
      schoolContext: profile.schoolContext,
      curriculum: profile.curriculum,
      gpa: profile.gpa,
      gpaScale: profile.gpaScale,
      intendedMajor: profile.intendedMajor,
      careerGoal: profile.careerGoal,
      countryOfOrigin: profile.countryOfOrigin,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    },
    testScores: profile.testScores,
    resumeItems: profile.resumeItems,
    targetSchools: profile.targetSchools,
    plannedItems: by(plannedItems, profile.id),
    projections: by(projections, profile.id).map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      completedAt: p.completedAt,
      status: p.status,
      isSample: p.isSample,
      model: p.model,
      promptVersion: p.promptVersion,
      baseEvaluationId: p.baseEvaluationId,
      error: p.error,
      result: parseStoredProjection(p.resultJson),
      inputSnapshot: p.inputSnapshotJson
        ? (JSON.parse(p.inputSnapshotJson) as unknown)
        : null,
    })),
    evaluations: by(evaluations, profile.id).map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      completedAt: e.completedAt,
      status: e.status,
      isSample: e.isSample,
      model: e.model,
      promptVersion: e.promptVersion,
      overallScore: e.overallScore,
      error: e.error,
      // Parsed back to real JSON so the export is readable rather than a
      // string containing escaped JSON.
      result: parseStoredResult(e.resultJson),
      inputSnapshot: e.inputSnapshotJson
        ? (JSON.parse(e.inputSnapshotJson) as unknown)
        : null,
    })),
  }));

  const payload = {
    exportedAt: new Date().toISOString(),
    // Bumped from 1: the top level is now a list of students rather than one
    // profile's fields. Anything reading an old export would otherwise find
    // the keys it expects simply missing.
    formatVersion: 2,
    account: user,
    students,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="application-profile-${stamp}.json"`,
      // Never let a proxy or the browser cache a file full of personal data.
      "Cache-Control": "no-store, private",
    },
  });
}
