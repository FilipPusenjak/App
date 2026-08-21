// The nightly triage pass.
//
// Runs over every ACTIVE, fully-consented link and writes TriageSignal rows.
// Zero model calls — see detect.ts, which has no client in scope and cannot
// acquire one. That is what makes monitoring a large caseload free, and it is
// deliberately a margin property as well as a correctness one: the counselor
// generates prep for the eight students triage surfaced, not for all forty.
//
// The whole caseload is loaded in a bounded number of queries rather than one
// per student. A hundred students at four queries each is four hundred round
// trips to a serverless Postgres, which is how a nightly job becomes a nightly
// timeout.
import { prisma } from "@/lib/db";
import { detectSignals, type ThresholdComponentFact, type TriageFacts } from "./detect";

/** Signals older than this are pruned when they are no longer produced. */
const RESOLVE_MISSING = true;

export type TriageRunResult = {
  linksExamined: number;
  signalsWritten: number;
  signalsResolved: number;
  modelCalls: 0;
  ranForMs: number;
};

/**
 * Recompute triage for one counselor, or for every counselor when omitted.
 *
 * Returns counts rather than logging, so the scheduled job, a test and an admin
 * screen can all use the same function and say their own thing about it.
 */
export async function runTriage(input?: {
  counselorAccountId?: string;
  now?: Date;
}): Promise<TriageRunResult> {
  const startedAt = Date.now();
  const now = input?.now ?? new Date();

  const links = await prisma.caseloadLink.findMany({
    where: {
      status: "ACTIVE",
      endedAt: null,
      // Triage reads student data, so it obeys the same consent gate every
      // other read does. A link awaiting a guardian is not monitored.
      studentConsentAt: { not: null },
      guardianConsentAt: { not: null },
      ...(input?.counselorAccountId
        ? { counselorAccountId: input.counselorAccountId }
        : {}),
    },
    select: {
      id: true,
      counselorAccountId: true,
      studentProfileId: true,
      scope: true,
    },
  });

  if (links.length === 0) {
    return {
      linksExamined: 0,
      signalsWritten: 0,
      signalsResolved: 0,
      modelCalls: 0,
      ranForMs: Date.now() - startedAt,
    };
  }

  const profileIds = [...new Set(links.map((l) => l.studentProfileId))];
  const facts = await loadFactsForProfiles(profileIds, now);

  let signalsWritten = 0;
  let signalsResolved = 0;

  for (const link of links) {
    const f = facts.get(link.studentProfileId);
    if (!f) continue;

    const detected = detectSignals(f);

    // Resolve what is no longer true before writing what is. A signal that has
    // stopped being produced has stopped being the case, and leaving it open
    // would have the attention list describing a problem someone already fixed.
    const open = await prisma.triageSignal.findMany({
      where: { caseloadLinkId: link.id, resolvedAt: null },
      select: { id: true, kind: true, basis: true, severity: true },
    });

    const detectedKeys = new Set(detected.map(signalKey));
    const stale = open.filter(
      (o) =>
        !detectedKeys.has(
          signalKey({
            kind: o.kind,
            basis: (o.basis ?? {}) as Record<string, unknown>,
          }),
        ),
    );
    if (RESOLVE_MISSING && stale.length > 0) {
      const { count } = await prisma.triageSignal.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { resolvedAt: now },
      });
      signalsResolved += count;
    }

    // Anything already open and still true is left alone rather than rewritten,
    // so computedAt keeps meaning "when this first became true" — which is what
    // a counselor reads it as.
    const openKeys = new Set(
      open
        .filter((o) => !stale.some((s) => s.id === o.id))
        .map((o) =>
          signalKey({
            kind: o.kind,
            basis: (o.basis ?? {}) as Record<string, unknown>,
          }),
        ),
    );
    const fresh = detected.filter((d) => !openKeys.has(signalKey(d)));

    if (fresh.length > 0) {
      await prisma.triageSignal.createMany({
        data: fresh.map((d) => ({
          caseloadLinkId: link.id,
          counselorAccountId: link.counselorAccountId,
          kind: d.kind,
          severity: d.severity,
          basis: d.basis as object,
          computedAt: now,
        })),
      });
      signalsWritten += fresh.length;
    }
  }

  return {
    linksExamined: links.length,
    signalsWritten,
    signalsResolved,
    modelCalls: 0,
    ranForMs: Date.now() - startedAt,
  };
}

/**
 * Identity of a signal, for telling "still the same problem" from "a new one".
 *
 * Keyed on kind plus the identifying part of the basis, NOT on severity or on
 * the whole basis. Severity moves as a student ages and a day count grows; if
 * either were in the key, every overdue commitment would close and reopen
 * nightly and the attention list would report a fortnight-old problem as new
 * every morning.
 */
function signalKey(d: {
  kind: string;
  basis: Record<string, unknown>;
}): string {
  const b = d.basis ?? {};
  const identity =
    b.commitmentId ?? b.activityId ?? `${b.school ?? ""}::${b.component ?? ""}`;
  return `${d.kind}::${identity}`;
}

/**
 * Every fact every detector needs, for many profiles, in a fixed query count.
 *
 * Five queries regardless of caseload size. The alternative — per-student loads
 * — is what turns a nightly job into a nightly timeout somewhere around the
 * fortieth student.
 */
async function loadFactsForProfiles(
  profileIds: string[],
  now: Date,
): Promise<Map<string, TriageFacts>> {
  const [profiles, items, targets, commitments, evaluations, heldSessions] =
    await Promise.all([
      prisma.profile.findMany({
        where: { id: { in: profileIds } },
        select: {
          id: true,
          gradeLevel: true,
          intendedMajor: true,
          careerGoal: true,
          updatedAt: true,
        },
      }),
      prisma.resumeItem.findMany({
        where: { profileId: { in: profileIds } },
        select: {
          id: true,
          profileId: true,
          title: true,
          type: true,
          rungLevel: true,
          startDate: true,
          endDate: true,
          updatedAt: true,
        },
      }),
      prisma.targetSchool.findMany({
        where: { profileId: { in: profileIds } },
        select: { profileId: true, name: true, country: true, course: true, updatedAt: true },
      }),
      prisma.commitment.findMany({
        where: { profileId: { in: profileIds } },
        select: {
          id: true,
          profileId: true,
          description: true,
          status: true,
          dueDate: true,
        },
      }),
      // Two most recent completed evaluations per profile, taken as one query
      // and grouped in memory. "Newly binding" is a diff, so one snapshot is
      // not enough.
      prisma.evaluation.findMany({
        where: {
          profileId: { in: profileIds },
          status: "completed",
          isSample: false,
          thresholdSnapshotJson: { not: null },
        },
        orderBy: { createdAt: "desc" },
        select: {
          profileId: true,
          createdAt: true,
          thresholdSnapshotJson: true,
          differentiationSnapshotJson: true,
        },
      }),
      prisma.sessionPrep.findMany({
        where: {
          outcome: "HELD",
          caseloadLink: { studentProfileId: { in: profileIds } },
        },
        orderBy: { generatedAt: "desc" },
        select: {
          generatedAt: true,
          caseloadLink: { select: { studentProfileId: true } },
        },
      }),
    ]);

  const by = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return m;
  };

  const itemsBy = by(items, (i) => i.profileId);
  const targetsBy = by(targets, (t) => t.profileId);
  const commitmentsBy = by(commitments, (c) => c.profileId);
  const evalsBy = by(evaluations, (e) => e.profileId);
  const heldBy = by(heldSessions, (s) => s.caseloadLink.studentProfileId);

  const out = new Map<string, TriageFacts>();
  for (const p of profiles) {
    const profileItems = itemsBy.get(p.id) ?? [];
    const profileTargets = targetsBy.get(p.id) ?? [];
    const evals = evalsBy.get(p.id) ?? [];

    // The last time the STUDENT changed something, which is what "stale" is
    // about. A counselor reading the profile every day must not make it look
    // active — that would silence the signal exactly when it is most needed.
    const lastStudentEditAt = [
      p.updatedAt,
      ...profileItems.map((i) => i.updatedAt),
      ...profileTargets.map((t) => t.updatedAt),
    ]
      .filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    out.set(p.id, {
      gradeLevel: p.gradeLevel,
      lastStudentEditAt,
      intendedMajor: p.intendedMajor,
      careerGoal: p.careerGoal,
      resumeItems: profileItems.map((i) => ({
        id: i.id,
        title: i.title,
        type: i.type,
        rungLevel: i.rungLevel,
        startDate: i.startDate,
        endDate: i.endDate,
        updatedAt: i.updatedAt,
      })),
      targetSchools: profileTargets.map((t) => ({
        name: t.name,
        country: t.country,
        course: t.course,
      })),
      commitments: commitmentsBy.get(p.id) ?? [],
      thresholdNow: readComponents(evals[0]?.thresholdSnapshotJson ?? null),
      thresholdBefore: evals[1]
        ? readComponents(evals[1].thresholdSnapshotJson)
        : null,
      differentiationNow: readBand(evals[0]?.differentiationSnapshotJson ?? null),
      differentiationBefore: readBand(
        evals[1]?.differentiationSnapshotJson ?? null,
      ),
      lastHeldSessionAt: heldBy.get(p.id)?.[0]?.generatedAt ?? null,
      now,
    });
  }
  return out;
}

/** Threshold components out of a stored snapshot, flattened per school. */
function readComponents(json: string | null): ThresholdComponentFact[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as {
      schools?: {
        targetName?: string;
        school?: string;
        components?: { label?: string; state?: string }[];
      }[];
    };
    const out: ThresholdComponentFact[] = [];
    for (const school of parsed.schools ?? []) {
      const name = school.targetName ?? school.school ?? "(unnamed target)";
      for (const c of school.components ?? []) {
        if (!c.label || !c.state) continue;
        out.push({ school: name, label: c.label, state: c.state });
      }
    }
    return out;
  } catch {
    // A snapshot that will not parse produces no signals rather than a crash.
    // Triage is a monitoring pass; one bad row must not stop the caseload.
    return [];
  }
}

function readBand(json: string | null): string | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { band?: unknown };
    return typeof parsed.band === "string" ? parsed.band : null;
  } catch {
    return null;
  }
}
