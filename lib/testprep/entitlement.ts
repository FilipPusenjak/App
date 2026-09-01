// Caseload bands, and why exceeding one never breaks anything.
//
// SOFT ENFORCEMENT IS THE DESIGN, not a leniency we might tighten later. A tutor
// discovers they are over the band in the middle of a Tuesday session, with a
// student and sometimes a parent sitting there. Refusing the request at that
// moment punishes the person least able to act on it, to collect $20 a month.
// So: notify, let them choose, never auto-upgrade, and never interrupt work in
// progress.
//
// THE STOPPING SIGNAL IS NOT SUBJECT TO ANY OF THIS. There is no entitlement
// check in lib/testprep/stopping.ts and there must never be one — a product
// whose central honesty claim is gated behind a payment tier does not have the
// claim. An over-band, unpaid, expired account still gets told when to stop.
import { prisma } from "@/lib/db";
import { effectivePlanFor } from "@/lib/billing/subscription";

/**
 * The bands, web-only and billed through Stripe.
 *
 * Deliberately NOT routed through App Store IAP: caseload work is desktop work,
 * and surrendering a platform commission on a B2B subscription would be paying
 * 15-30% for a distribution channel these customers do not use.
 */
export const CASELOAD_BANDS = [
  { students: 20, monthlyUsd: 29, code: "TUTOR_20" },
  { students: 50, monthlyUsd: 49, code: "TUTOR_50" },
] as const;

export type CaseloadBand = (typeof CASELOAD_BANDS)[number];

/** The band a given limit corresponds to, for naming it on screen. */
export function bandForLimit(limit: number): CaseloadBand | null {
  return CASELOAD_BANDS.find((b) => b.students === limit) ?? null;
}

/** The next band up, or null when already on the largest. */
export function nextBandAbove(active: number): CaseloadBand | null {
  return CASELOAD_BANDS.find((b) => b.students >= active) ?? null;
}

export type CaseloadStanding = {
  active: number;
  limit: number;
  overBand: boolean;
  /** Null when inside the band. Never an interruption — copy for a notice. */
  message: string | null;
  suggested: CaseloadBand | null;
};

/**
 * Where this tutor stands against their band.
 *
 * Counts ACTIVE links only. A paused or ended link is not a student being
 * worked with, and charging for one would be charging for a row.
 */
export async function caseloadStanding(
  counselorAccountId: string,
): Promise<CaseloadStanding> {
  const [account, active] = await Promise.all([
    prisma.counselorAccount.findUniqueOrThrow({
      where: { id: counselorAccountId },
      select: { caseloadLimit: true, userId: true },
    }),
    prisma.caseloadLink.count({
      where: {
        counselorAccountId,
        status: "ACTIVE",
        endedAt: null,
        scope: "TEST_PREP_ONLY",
      },
    }),
  ]);

  // A purchased band DERIVES the limit rather than being copied onto the
  // account. One source of truth, so there is no sync step to go wrong, and a
  // band that lapses reverts on its own instead of leaving a paid-for ceiling
  // behind. The stored caseloadLimit remains the floor for accounts set up by
  // hand, which is how every existing account works today.
  const purchased = await purchasedCaseloadLimit(account.userId);
  const limit = Math.max(account.caseloadLimit, purchased ?? 0);

  const overBand = active > limit;
  const suggested = overBand ? nextBandAbove(active) : null;

  return {
    active,
    limit,
    overBand,
    message: overBand
      ? suggested
        ? `You have ${active} active students and your plan covers ${limit}. The ${suggested.students}-student plan is $${suggested.monthlyUsd} a month. Nothing is interrupted in the meantime — move when it suits you.`
        : `You have ${active} active students, above the largest standard plan. Get in touch and we will sort out something that fits.`
      : null,
    suggested,
  };
}

/**
 * The caseload ceiling a paid band grants, or null when none is in force.
 *
 * Isolated in its own function so the read stays a read: nothing here writes,
 * disables, or auto-selects a band. Going over is still only ever a sentence on
 * a screen — see this file's header.
 */
async function purchasedCaseloadLimit(userId: string): Promise<number | null> {
  const plan = await effectivePlanFor(userId, "TUTOR");
  return plan?.caseloadLimit ?? null;
}

/**
 * June, when a graduating cohort should stop being billable.
 *
 * Auto-archiving exists so a tutor is not manually ending links every summer to
 * avoid a tier charge — a chore that punishes them for the calendar and quietly
 * pushes them to end links early, taking a student's own access with it.
 *
 * ARCHIVING IS NOT DELETION and not revocation. The link ends, the tutor stops
 * seeing the student, and the student keeps every score they entered plus their
 * own free-tier access. See the note on the student side below.
 */
export function isGraduated(graduationYear: number | null, now: Date): boolean {
  if (graduationYear === null) return false;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed; 5 is June.
  // A 2026 leaver is done once June 2026 arrives. Before June, they are still
  // mid-cycle and may well be sitting a summer test.
  return year > graduationYear || (year === graduationYear && month >= 5);
}

/**
 * End links for students who have graduated.
 *
 * Returns what it did rather than logging, so a caller (a cron route, or an
 * operator) can report it. Ending a link DOWNGRADES the student rather than
 * cutting them off: their profile, their scores and their own access are theirs
 * and survive the tutor's subscription entirely.
 */
export async function archiveGraduatedStudents(input: {
  counselorAccountId?: string;
  now?: Date;
}): Promise<{ examined: number; archived: number }> {
  const now = input.now ?? new Date();

  const links = await prisma.caseloadLink.findMany({
    where: {
      ...(input.counselorAccountId
        ? { counselorAccountId: input.counselorAccountId }
        : {}),
      status: "ACTIVE",
      endedAt: null,
      scope: "TEST_PREP_ONLY",
    },
    select: {
      id: true,
      studentProfile: { select: { graduationYear: true } },
    },
  });

  const due = links.filter((l) => isGraduated(l.studentProfile.graduationYear, now));
  if (due.length > 0) {
    await prisma.caseloadLink.updateMany({
      where: { id: { in: due.map((l) => l.id) } },
      data: { status: "ENDED", endedAt: now },
    });
  }

  return { examined: links.length, archived: due.length };
}
