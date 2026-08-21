// The caseload, as an attention list rather than a directory.
//
// The default screen answers "who needs me this week", which is an
// attention-allocation question. It is NOT "who is doing well", and the
// difference is the whole product: a counselor's scarce resource is attention,
// not information, and they already know more about admissions than the model
// does.
//
// WHAT THIS FILE MUST NEVER PRODUCE, in any form:
//
//   A ranking of students by readiness, differentiation, or promise. It is
//   professionally toxic — a leaderboard of a counselor's own children — and
//   useless, because the strongest student may need the most attention.
//
//   A caseload-wide average or distribution. It invites exactly the comparison
//   above, tells the counselor nothing they can act on, and would be the first
//   screenshot to leak.
//
// There is no readiness number anywhere in this module. Not hidden, not
// computed and discarded — absent. A test reads this file to keep it that way.
import { prisma } from "@/lib/db";
import {
  TRIAGE_LABELS,
  type LinkScope,
  type TriageKind,
} from "@/lib/validation/counselor";
import { requireCounselorAccount, readableLinkWhere } from "./access";

export type AttentionRow = {
  linkId: string;
  studentProfileId: string;
  /** What the counselor calls this student. */
  studentName: string;
  gradeLevel: string | null;
  scope: LinkScope;
  /**
   * The single highest severity among this student's open signals.
   *
   * The list is ordered by this, and it is a measure of NEED. A 5 does not mean
   * a weak student; it means something is happening that a professional should
   * look at before Saturday.
   */
  topSeverity: number;
  signals: {
    id: string;
    kind: TriageKind;
    label: string;
    severity: number;
    computedAt: Date;
    basis: Record<string, unknown>;
  }[];
  /** When a prep was last actually HELD, for the "we haven't met" reading. */
  lastHeldAt: Date | null;
};

export type CaseloadAttention = {
  needsAttention: AttentionRow[];
  /**
   * How many students have no open signals at all.
   *
   * Stated rather than hidden, and load-bearing. "22 of 31 students have
   * nothing requiring attention this week" is the sentence that lets a
   * professional stop worrying about the rest of the caseload and spend
   * Saturday on the nine who need it. A quiet list with no denominator reads as
   * a broken screen.
   */
  quietCount: number;
  totalActive: number;
};

/**
 * This week's attention list.
 *
 * Ordered by top severity, then by how long the most severe signal has been
 * open — a problem that has been sitting for three weeks outranks one raised
 * last night at the same severity, because the older one has already been
 * missed once.
 */
export async function loadCaseloadAttention(): Promise<CaseloadAttention> {
  const account = await requireCounselorAccount();

  const links = await prisma.caseloadLink.findMany({
    where: readableLinkWhere(account.id),
    select: {
      id: true,
      scope: true,
      studentProfileId: true,
      studentProfile: {
        // Deliberately narrow. The attention list needs a name and a year; it
        // does not need — and must not display — anything that could be read
        // as a measure of the student.
        select: { id: true, studentName: true, gradeLevel: true },
      },
      signals: {
        where: { resolvedAt: null },
        orderBy: [{ severity: "desc" }, { computedAt: "asc" }],
        select: {
          id: true,
          kind: true,
          severity: true,
          computedAt: true,
          basis: true,
        },
      },
      sessionPreps: {
        where: { outcome: "HELD" },
        orderBy: { generatedAt: "desc" },
        take: 1,
        select: { generatedAt: true },
      },
    },
  });

  const rows: AttentionRow[] = links
    .filter((l) => l.signals.length > 0)
    .map((l) => ({
      linkId: l.id,
      studentProfileId: l.studentProfileId,
      studentName: l.studentProfile.studentName ?? "Unnamed student",
      gradeLevel: l.studentProfile.gradeLevel,
      scope: l.scope as LinkScope,
      topSeverity: l.signals[0]?.severity ?? 0,
      signals: l.signals.map((s) => ({
        id: s.id,
        kind: s.kind as TriageKind,
        label: TRIAGE_LABELS[s.kind as TriageKind] ?? s.kind,
        severity: s.severity,
        computedAt: s.computedAt,
        basis: (s.basis ?? {}) as Record<string, unknown>,
      })),
      lastHeldAt: l.sessionPreps[0]?.generatedAt ?? null,
    }))
    .sort((a, b) => {
      if (b.topSeverity !== a.topSeverity) return b.topSeverity - a.topSeverity;
      // Older first at equal severity: it has already been missed once.
      const aOldest = a.signals[0]?.computedAt.getTime() ?? 0;
      const bOldest = b.signals[0]?.computedAt.getTime() ?? 0;
      return aOldest - bOldest;
    });

  return {
    needsAttention: rows,
    quietCount: links.length - rows.length,
    totalActive: links.length,
  };
}

export type DirectoryRow = {
  linkId: string;
  studentName: string;
  gradeLevel: string | null;
  scope: LinkScope;
  openSignalCount: number;
  lastHeldAt: Date | null;
  startedAt: Date | null;
};

/**
 * The student directory — SECONDARY navigation, never the default screen.
 *
 * Ordered by name, deliberately. Any other ordering here would be a ranking by
 * something, and the only orderings a caseload directory could plausibly take
 * are the ones this product refuses to compute.
 */
export async function loadCaseloadDirectory(): Promise<DirectoryRow[]> {
  const account = await requireCounselorAccount();

  const links = await prisma.caseloadLink.findMany({
    where: readableLinkWhere(account.id),
    select: {
      id: true,
      scope: true,
      startedAt: true,
      studentProfile: { select: { studentName: true, gradeLevel: true } },
      _count: { select: { signals: { where: { resolvedAt: null } } } },
      sessionPreps: {
        where: { outcome: "HELD" },
        orderBy: { generatedAt: "desc" },
        take: 1,
        select: { generatedAt: true },
      },
    },
  });

  return links
    .map((l) => ({
      linkId: l.id,
      studentName: l.studentProfile.studentName ?? "Unnamed student",
      gradeLevel: l.studentProfile.gradeLevel,
      scope: l.scope as LinkScope,
      openSignalCount: l._count.signals,
      lastHeldAt: l.sessionPreps[0]?.generatedAt ?? null,
      startedAt: l.startedAt,
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

/**
 * How a signal's basis reads to a professional in a hurry.
 *
 * Rendered beside every signal as INSPECTABLE rather than hidden behind a
 * disclosure, because the counselor has to vet what they are about to repeat.
 * Returns the raw pairs rather than prose: a counselor reading
 * `daysOverdue: 40` can check it against what they remember, where a sentence
 * saying "significantly overdue" gives them nothing to check.
 */
export function describeBasis(
  basis: Record<string, unknown>,
): { key: string; value: string }[] {
  const SKIP = new Set(["signal"]);
  return Object.entries(basis)
    .filter(([k, v]) => !SKIP.has(k) && v != null && v !== "")
    .map(([key, value]) => ({
      key: key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase())
        .trim(),
      value: Array.isArray(value) ? value.join(", ") : String(value),
    }));
}
