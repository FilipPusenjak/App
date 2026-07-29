// GET /api/export — download everything this account holds, as JSON.
//
// Two jobs: it's the backup you otherwise don't have, and it's what makes
// account deletion a reasonable thing to offer — you can take your data with
// you before you erase it.
//
// Scoped to the session like every other read. No id is accepted from the
// client, so there is no way to request someone else's export.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getProfileWithRelations, getOwnedEvaluations } from "@/lib/ownership";
import { prisma } from "@/lib/db";
import { parseStoredResult } from "@/lib/validation/evaluation";

export async function GET() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const [user, profile, evaluations] = await Promise.all([
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
    getProfileWithRelations(),
    getOwnedEvaluations(),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    formatVersion: 1,
    account: user,
    profile: {
      gradeLevel: profile.gradeLevel,
      curriculum: profile.curriculum,
      gpa: profile.gpa,
      gpaScale: profile.gpaScale,
      intendedMajor: profile.intendedMajor,
      careerGoal: profile.careerGoal,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    },
    testScores: profile.testScores,
    resumeItems: profile.resumeItems,
    targetSchools: profile.targetSchools,
    evaluations: evaluations.map((e) => ({
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
