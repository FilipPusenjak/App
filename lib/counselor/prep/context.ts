// What the model is given before it drafts a session.
//
// Two things about this context are non-negotiable.
//
// THE SCORING CORE IS REUSED VERBATIM. This calls the same scoreProfile() the
// student's own screen calls, pinned to the same RUBRIC_VERSION. If a counselor
// and a student saw different readiness readings for the same profile on the
// same day, the product would be broken in the way that is hardest to recover
// from — the counselor would stop trusting the tool in front of the family.
// Nothing here recomputes, adjusts or re-bands anything.
//
// EVERY FACT CARRIES ITS NAME. The triage signals arrive with the basis that
// produced them, and the prompt requires the model to cite one on every claim.
// A counselor has to vet output before repeating it to a paying parent, and
// "the system said so" is not something a professional can repeat.
//
// Budgeted at ~8k tokens. A prep is the only per-student model cost in this
// product, and it is generated for the handful triage surfaced rather than for
// a caseload, so the budget is about keeping one prep cheap rather than about
// keeping a batch affordable.
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { scoreProfile, parseGradeLevel, RUBRIC_VERSION } from "@/lib/readiness/score";
import { findRequirementsForTargets } from "@/lib/requirements/lookup";
import { profileDigestSchema } from "@/lib/evaluation/digest";
import { RUNG_LABELS, type Rung } from "@/lib/readiness/rungs";
import { TRIAGE_LABELS, type LinkScope, type TriageKind } from "@/lib/validation/counselor";
import { estimateInputTokens } from "@/lib/cost-budget";
import type { ReadableLink } from "../access";

export const PREP_TOKEN_BUDGET = 8000;

export type PrepContext = {
  text: string;
  estimatedTokens: number;
  rubricVersion: string;
  /** The signals this prep is written against, for storing alongside it. */
  signalIds: string[];
};

/**
 * Assemble the context for one student's session prep.
 *
 * The link has already been proven readable by the caller; this respects its
 * SCOPE when loading, so a subject tutor's prep is drafted without an activity
 * portfolio the tutor is not entitled to see. A model given data the counselor
 * cannot see would write about it, and the counselor would then be reading
 * something they have no right to.
 */
export async function buildPrepContext(
  link: ReadableLink,
  now: Date = new Date(),
): Promise<PrepContext> {
  const scope = link.scope as LinkScope;
  const academics = scope === "FULL" || scope === "ACADEMIC_ONLY";
  const activities = scope === "FULL" || scope === "ACTIVITIES_ONLY";

  const [profile, signals, commitments, digestRows, priorPreps] =
    await Promise.all([
      prisma.profile.findUniqueOrThrow({
        where: { id: link.studentProfileId },
        include: {
          resumeItems: activities
            ? true
            : { where: { type: "coursework" } },
          testScores: academics ? true : { where: { id: "" } },
          targetSchools: true,
        },
      }),
      prisma.triageSignal.findMany({
        where: { caseloadLinkId: link.id, resolvedAt: null },
        orderBy: [{ severity: "desc" }, { computedAt: "asc" }],
        take: 10,
      }),
      prisma.commitment.findMany({
        where: {
          profileId: link.studentProfileId,
          status: { in: ["PROPOSED", "ACCEPTED", "IN_PROGRESS"] },
        },
        orderBy: [{ dueDate: "asc" }],
        take: 12,
      }),
      prisma.profileDigest.findMany({
        where: { profileId: link.studentProfileId },
        orderBy: { throughGrade: "asc" },
      }),
      // The previous prep AND what came of it. A counselor's own note from
      // last time is the single most valuable thing in this context: it is the
      // only input that contains something the model could not have computed.
      prisma.sessionPrep.findMany({
        where: { caseloadLinkId: link.id, narrative: { not: Prisma.DbNull } },
        orderBy: { generatedAt: "desc" },
        take: 2,
        select: {
          generatedAt: true,
          outcome: true,
          counselorNotes: true,
          narrative: true,
        },
      }),
    ]);

  const requirements = await findRequirementsForTargets(
    profile.targetSchools.map((t) => ({
      name: t.name,
      country: t.country,
      course: t.course,
    })),
  );

  // THE SAME CALL THE STUDENT'S OWN SCREEN MAKES. Same inputs, same version.
  const scored = scoreProfile({
    gradeLevel: parseGradeLevel(profile.gradeLevel),
    academics: {
      gpa: academics ? profile.gpa : null,
      gpaScale: academics ? profile.gpaScale : null,
      curriculum: profile.curriculum,
      testScores: profile.testScores.map((t) => ({
        kind: t.kind,
        label: t.label,
        score: t.score,
        predicted: t.predicted,
      })),
      subjects: profile.resumeItems
        .filter((i) => i.type === "coursework")
        .map((i) => i.title),
    },
    resumeItems: profile.resumeItems.map((i) => ({
      id: i.id,
      title: i.title,
      type: i.type,
      description: i.description,
      evidenceNotes: i.evidenceNotes,
      startDate: i.startDate,
      endDate: i.endDate,
      hoursPerWeek: i.hoursPerWeek,
    })),
    requirements: requirements.map((r) => ({
      targetName: r.targetName,
      course: r.course,
      requirements: r.requirements,
      primarySourceUrl: r.primarySourceUrl,
    })),
    previousRungs: {},
  });

  const lines: string[] = [];

  lines.push("# The student");
  lines.push(
    `- Name the counselor uses: ${profile.studentName ?? "(unnamed)"}`,
  );
  lines.push(`- Grade: ${profile.gradeLevel ?? "not set"}`);
  if (profile.graduationYear) lines.push(`- Leaves school: ${profile.graduationYear}`);
  if (profile.intendedMajor) lines.push(`- Intended major: ${profile.intendedMajor}`);
  if (profile.careerGoal) lines.push(`- Career goal: ${profile.careerGoal}`);
  if (profile.schoolContext) lines.push(`- School context: ${profile.schoolContext}`);
  if (scope !== "FULL") {
    // Stated to the model, so it does not write about what it cannot see and
    // leave the counselor wondering what they are missing.
    lines.push(
      `- YOUR VIEW IS LIMITED: this counselor has ${scope} access. ` +
        `Do not speculate about what is not shown — its absence here is a ` +
        `permission, not a fact about the student.`,
    );
  }

  /* ── Why they surfaced ───────────────────────────────────────────────── */
  lines.push("");
  lines.push("# Why this student surfaced (computed, not inferred)");
  lines.push(
    "Each line is a deterministic signal with the facts that produced it. " +
      "Cite one of these `signal` values as the `basis` on every point and " +
      "option you write.",
  );
  if (signals.length === 0) {
    lines.push("- Nothing open. This prep was requested rather than triggered.");
  }
  for (const s of signals) {
    const basis = (s.basis ?? {}) as Record<string, unknown>;
    const facts = Object.entries(basis)
      .filter(([k]) => k !== "signal")
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : String(v)}`)
      .join(", ");
    lines.push(
      `- [${basis.signal ?? s.kind}] ${TRIAGE_LABELS[s.kind as TriageKind] ?? s.kind} ` +
        `(severity ${s.severity}/5, since ${s.computedAt.toISOString().slice(0, 10)}) — ${facts}`,
    );
  }

  /* ── The standing, from the shared core ──────────────────────────────── */
  lines.push("");
  lines.push("# Standing (computed — do not recalculate or reinterpret)");
  lines.push(`- Rubric version: ${scored.rubricVersion}`);
  lines.push(`- Requirements band: ${scored.thresholdBand}`);
  lines.push(`- Differentiation band: ${scored.differentiation.band}`);
  lines.push(`- Pace: ${scored.pace.status}`);
  if (scored.monthsUntilApplication != null) {
    lines.push(`- Months until applications: ${scored.monthsUntilApplication}`);
  }

  const unmet = scored.threshold.schools.flatMap((s) =>
    (s.components ?? [])
      .filter((c) => c.state === "UNMET")
      .map((c) => `${s.school}: ${c.label}`),
  );
  if (unmet.length > 0) {
    lines.push("");
    lines.push("## Unmet requirements");
    for (const u of unmet.slice(0, 12)) lines.push(`- ${u}`);
  }

  /* ── Activities ──────────────────────────────────────────────────────── */
  if (activities) {
    const running = profile.resumeItems.filter((i) => i.type !== "coursework");
    if (running.length > 0) {
      lines.push("");
      lines.push("# Current activities (rung in brackets)");
      for (const item of running.slice(0, 20)) {
        const rung = (item.rungLevel ?? "none") as Rung;
        lines.push(
          `- ${item.title} [${rung}] (${RUNG_LABELS[rung] ?? rung})` +
            (item.hoursPerWeek ? ` — ${item.hoursPerWeek}h/wk` : ""),
        );
      }
    }
  }

  /* ── Commitments ─────────────────────────────────────────────────────── */
  lines.push("");
  lines.push("# Open commitments");
  if (commitments.length === 0) {
    lines.push("- None open.");
  }
  for (const c of commitments) {
    const due = c.dueDate
      ? ` (due ${c.dueDate.toISOString().slice(0, 10)}${c.dueDate < now ? ", OVERDUE" : ""})`
      : "";
    lines.push(`- ${c.description} — ${c.status}${due}`);
  }

  /* ── Earlier years ───────────────────────────────────────────────────── */
  const digests = digestRows
    .map((row) => {
      try {
        const parsed = profileDigestSchema.safeParse(JSON.parse(row.summaryJson));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (digests.length > 0) {
    lines.push("");
    lines.push("# Earlier years (summarised)");
    for (const d of digests) {
      const activities = d!.activities
        .slice(0, 6)
        .map((a) => `${a.title} [${a.rung}]`)
        .join("; ");
      const gpa = d!.academics.gpa != null
        ? ` GPA ${d!.academics.gpa}${d!.academics.gpaScale ? `/${d!.academics.gpaScale}` : ""}.`
        : "";
      lines.push(
        `- Through grade ${d!.throughGrade}:${gpa}` +
          (activities ? ` ${activities}` : " no activities recorded."),
      );
    }
  }

  /* ── Last time ───────────────────────────────────────────────────────── */
  //
  // The counselor's own notes are the highest-value input here and are placed
  // last so they sit closest to the task. They are the only thing in this
  // context the model could not have computed — what the student actually said,
  // whether the parents are aligned, why a grade dropped.
  if (priorPreps.length > 0) {
    lines.push("");
    lines.push("# Last session");
    for (const p of priorPreps) {
      const n = p.narrative as { headline?: string } | null;
      lines.push(
        `- ${p.generatedAt.toISOString().slice(0, 10)} (${p.outcome}): ${n?.headline ?? "(no headline)"}`,
      );
      if (p.counselorNotes) {
        lines.push(
          `  COUNSELOR'S OWN NOTE — this is what they learned in the room, ` +
            `and outranks anything computed above: ${p.counselorNotes}`,
        );
      }
    }
  }

  const text = lines.join("\n");
  return {
    text,
    estimatedTokens: estimateInputTokens(text),
    rubricVersion: RUBRIC_VERSION,
    signalIds: signals.map((s) => s.id),
  };
}
