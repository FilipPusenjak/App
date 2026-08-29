// The practice dashboard — what this caseload looks like as WORK.
//
// A dashboard is where a ranking of children would appear if one were ever
// going to, so the rule from caseload.ts applies here verbatim and harder:
//
//   NO ranking of students by readiness, differentiation or promise.
//   NO caseload-wide average or distribution OF STUDENTS.
//
// The distinction this file rests on is between a distribution of STUDENTS and
// a distribution of WORK. "Six of your nine open signals are overdue
// commitments" is a fact about the counselor's week — it names no student,
// orders nobody, and changes what they do on Saturday. "Your caseload averages
// 62nd percentile" is a fact about children, tells the counselor nothing they
// can act on, and is the screenshot that ends a professional relationship.
//
// Every panel below is of the first kind. The unit of every count is a signal,
// a session, a grade band or a consent scope — never a measure of a student.
// Nothing here is sorted by anything about how a student is doing, because
// nothing here knows anything about how a student is doing.
import { prisma } from "@/lib/db";
import {
  TRIAGE_LABELS,
  type LinkScope,
  type TriageKind,
} from "@/lib/validation/counselor";
import { requireCounselorPage, readableLinkWhere } from "./access";

/** How many weeks of session history the activity panel covers. */
const ACTIVITY_WEEKS = 8;

export type SignalKindCount = {
  kind: TriageKind;
  label: string;
  count: number;
  /** The highest severity currently open under this kind, for ordering. */
  topSeverity: number;
};

export type WeekActivity = {
  weekStart: Date;
  /** Preps generated in this week, whatever became of them. */
  generated: number;
  /** Preps whose session was actually marked held. */
  held: number;
};

export type CaseloadOverview = {
  totalActive: number;
  needsAttention: number;
  quiet: number;
  openSignals: number;
  /** Links invited but not yet consented by both parties. */
  pendingInvites: number;
  caseloadLimit: number;
  signalsByKind: SignalKindCount[];
  /** Grade bands present in the caseload. Descriptive, not evaluative. */
  gradeComposition: { label: string; count: number }[];
  scopeComposition: { scope: LinkScope; label: string; count: number }[];
  activity: WeekActivity[];
  /** Sessions actually held across the whole activity window. */
  heldInWindow: number;
};

/**
 * Everything the overview screen renders, in one pass.
 *
 * Scoped through readableLinkWhere like every other counselor read, so a
 * dashboard can never become the one surface that forgot dual consent.
 */
export async function loadCaseloadOverview(): Promise<CaseloadOverview> {
  const account = await requireCounselorPage();

  const since = startOfWeek(new Date());
  since.setUTCDate(since.getUTCDate() - 7 * (ACTIVITY_WEEKS - 1));

  const [links, pendingInvites, preps] = await Promise.all([
    prisma.caseloadLink.findMany({
      where: readableLinkWhere(account.id),
      select: {
        id: true,
        scope: true,
        // A name is deliberately NOT selected. Nothing on this screen names a
        // student, so nothing on this screen needs to load one.
        studentProfile: { select: { gradeLevel: true } },
        signals: {
          where: { resolvedAt: null },
          select: { kind: true, severity: true },
        },
      },
    }),
    prisma.caseloadLink.count({
      where: { counselorAccountId: account.id, status: "PENDING", endedAt: null },
    }),
    prisma.sessionPrep.findMany({
      where: { counselorAccountId: account.id, generatedAt: { gte: since } },
      select: { generatedAt: true, outcome: true },
    }),
  ]);

  const needsAttention = links.filter((l) => l.signals.length > 0).length;
  const openSignals = links.reduce((n, l) => n + l.signals.length, 0);

  // ── Signals by kind ──────────────────────────────────────────────────────
  // The most useful panel here, and the reason it is about kinds rather than
  // students: a counselor seeing that most of their week is overdue
  // commitments learns something about their practice. The same nine signals
  // attributed to nine named children would just be the attention list again,
  // sorted worse.
  const byKind = new Map<TriageKind, { count: number; topSeverity: number }>();
  for (const link of links) {
    for (const signal of link.signals) {
      const kind = signal.kind as TriageKind;
      const seen = byKind.get(kind);
      if (seen) {
        seen.count += 1;
        seen.topSeverity = Math.max(seen.topSeverity, signal.severity);
      } else {
        byKind.set(kind, { count: 1, topSeverity: signal.severity });
      }
    }
  }
  const signalsByKind: SignalKindCount[] = [...byKind.entries()]
    .map(([kind, v]) => ({
      kind,
      label: TRIAGE_LABELS[kind] ?? kind,
      count: v.count,
      topSeverity: v.topSeverity,
    }))
    // By how much work each kind represents, then by how soon it wants looking
    // at. Both are facts about the queue; neither is a fact about a child.
    .sort((a, b) => b.count - a.count || b.topSeverity - a.topSeverity);

  // ── Composition ──────────────────────────────────────────────────────────
  const grades = new Map<string, number>();
  for (const link of links) {
    const label = link.studentProfile.gradeLevel ?? "Grade not set";
    grades.set(label, (grades.get(label) ?? 0) + 1);
  }
  const gradeComposition = [...grades.entries()]
    .map(([label, count]) => ({ label, count }))
    // Numeric-aware, so "Grade 9" precedes "Grade 10" instead of sorting to the
    // bottom the way a plain string compare puts it.
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );

  const SCOPE_LABELS: Record<LinkScope, string> = {
    FULL: "Full profile",
    ACADEMIC_ONLY: "Academic records only",
    ACTIVITIES_ONLY: "Activities only",
    TEST_PREP_ONLY: "Test scores only",
  };
  const scopes = new Map<LinkScope, number>();
  for (const link of links) {
    const scope = link.scope as LinkScope;
    scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
  }
  const scopeComposition = [...scopes.entries()]
    .map(([scope, count]) => ({
      scope,
      label: SCOPE_LABELS[scope] ?? scope,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // ── Session activity ─────────────────────────────────────────────────────
  // The counselor's own work over time. A run of generated-but-never-held
  // preps is worth seeing, and it is a fact about them, not about anybody's
  // child — which is why this is the one time series on the screen.
  const weeks: WeekActivity[] = [];
  for (let i = 0; i < ACTIVITY_WEEKS; i += 1) {
    const weekStart = new Date(since);
    weekStart.setUTCDate(weekStart.getUTCDate() + 7 * i);
    weeks.push({ weekStart, generated: 0, held: 0 });
  }
  for (const prep of preps) {
    const index = Math.floor(
      (startOfWeek(prep.generatedAt).getTime() - since.getTime()) /
        (7 * 24 * 60 * 60 * 1000),
    );
    const week = weeks[index];
    if (!week) continue;
    week.generated += 1;
    if (prep.outcome === "HELD") week.held += 1;
  }

  return {
    totalActive: links.length,
    needsAttention,
    quiet: links.length - needsAttention,
    openSignals,
    pendingInvites,
    caseloadLimit: account.caseloadLimit,
    signalsByKind,
    gradeComposition,
    scopeComposition,
    activity: weeks,
    heldInWindow: weeks.reduce((n, w) => n + w.held, 0),
  };
}

/** Monday 00:00 UTC of the week a date falls in. */
function startOfWeek(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay is 0 for Sunday, which belongs to the week that began six days
  // earlier rather than the one starting tomorrow.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}
