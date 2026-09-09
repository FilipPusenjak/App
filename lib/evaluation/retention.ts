// How long the prose lives, and what outlives it.
//
// PURE POLICY — no database, no session, for the same reason lib/billing/quota.ts
// is separate from quota-account.ts. The sweep that applies this lives in
// retention-sweep.ts.
//
// WHAT THIS IS FOR. Every assessment ever written about a student sits in this
// database in plain text, readable by anybody holding the connection string.
// Encrypting it is possible but expensive and permanent (a lost passphrase
// destroys a student's history). Deleting it after a while is neither: you
// cannot read what does not exist, and the exposure stops being "everything,
// forever" and becomes a rolling window.
//
// THE LINE THIS DRAWS. Two things are deleted and one is kept, on purpose:
//
//   inputSnapshotJson goes FIRST and soonest. It is the raw profile — essay
//   drafts, activity write-ups, the things a fourteen-year-old typed about
//   themselves. It is arguably more sensitive than the assessment of it, and
//   it is only read to diff two nearby runs, which stops being useful within
//   weeks.
//
//   resultJson goes LATER, and how much later depends on the plan. It is what a
//   student re-reads and what anchoring reuses, so on a paid plan it covers a
//   full application cycle; on the free plan it is a month.
//
//   The SCORES ARE NEVER DELETED, on any plan. Watching a readiness score move
//   across four years of secondary school is the point of the product, so the
//   numbers outlive the prose they were extracted from — see chart-point.ts.
//
// WHY THE FREE WINDOW IS SHORT, stated plainly because it is two things at once
// and only one of them is about the student. It is a reason to upgrade. It is
// also less of a teenager's self-description sitting in a database that did not
// need to hold it — and that half would be worth doing with no paid plan at all.
//
// What it must NEVER become is a way to take back the thing somebody is actually
// keeping. The chart survives on every plan, export keeps working on every plan,
// and the expiry date is shown before it passes rather than after.

/**
 * Days before the raw profile snapshot is deleted.
 *
 * 60, because its only consumer is the diff between consecutive runs and the
 * rate limits make runs weeks apart at most. Long enough that a student who
 * disappears for a month still gets an anchored follow-up; short enough that
 * the essay drafts are not sitting there a year later.
 *
 * Capped by the narrative's own window — see capBySnapshotRule.
 */
export const DEFAULT_INPUT_SNAPSHOT_DAYS = 60;

/**
 * Days before the narrative is deleted on the free plan.
 *
 * 30. Short enough to be a real reason to upgrade, and short enough that a free
 * account stops being an indefinite store of what a teenager wrote about
 * themselves. The student is told the date up front and can export before it.
 */
export const FREE_RESULT_DAYS = 30;

/**
 * Days before the narrative is deleted on a paid plan.
 *
 * 365, so a student can re-read across a whole application cycle and a
 * follow-up in September still anchors to one from the previous autumn.
 */
export const PAID_RESULT_DAYS = 365;

/**
 * Which window an account gets. Not the plan name — retention only cares
 * whether somebody is paying, so a second paid plan needs no change here.
 */
export type RetentionTier = "free" | "paid";

export type RetentionPolicy = {
  inputSnapshotDays: number;
  resultDays: number;
  /** How long before expiry the UI starts warning. Scaled to the window: 30
   *  days' notice on a 30-day window would mean warning from the moment the
   *  evaluation was written. */
  warningDays: number;
};

/**
 * The raw profile must never outlive the assessment written from it.
 *
 * It is the more sensitive of the two — essay drafts and self-description, not
 * a judgement about them — so a free account keeping the snapshot for 60 days
 * after the narrative went at 30 would invert the whole point of the policy.
 *
 * An explicit 0 on either side means "never expire" and is left alone: it is a
 * documented escape hatch for a deployment that wants to keep everything, and
 * quietly overriding it would make that setting a lie.
 */
function capBySnapshotRule(snapshotDays: number, resultDays: number): number {
  if (snapshotDays <= 0) return snapshotDays;
  if (resultDays <= 0) return snapshotDays;
  return Math.min(snapshotDays, resultDays);
}

/**
 * The configured policy for one account.
 *
 * Zero or negative on either field disables that expiry — the escape hatch for
 * a deployment that wants to keep everything, and the reason this reads the
 * environment rather than hard-coding. A malformed value falls back to the
 * default rather than to "never", because an unparseable number should not
 * silently switch retention off.
 */
export function getRetentionPolicy(tier: RetentionTier): RetentionPolicy {
  const resultDays =
    tier === "paid"
      ? days("RETENTION_RESULT_DAYS_PAID", PAID_RESULT_DAYS)
      : days("RETENTION_RESULT_DAYS_FREE", FREE_RESULT_DAYS);

  const snapshotDays = capBySnapshotRule(
    days("RETENTION_INPUT_SNAPSHOT_DAYS", DEFAULT_INPUT_SNAPSHOT_DAYS),
    resultDays,
  );

  return {
    inputSnapshotDays: snapshotDays,
    resultDays,
    // A quarter of the window, bounded at 30 days. Enough notice to export,
    // never so much that the warning is showing on the day it was written.
    warningDays:
      resultDays > 0
        ? Math.max(1, Math.min(EXPIRY_WARNING_DAYS, Math.floor(resultDays / 4)))
        : 0,
  };
}

function days(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The cutoff before which a field of this age is expired. Null = never. */
export function cutoffFor(days: number, now: Date): Date | null {
  if (days <= 0) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export type ExpiryState = {
  /** True once the raw profile snapshot has been or should be removed. */
  snapshotExpired: boolean;
  /** True once the narrative has been or should be removed. */
  resultExpired: boolean;
  /** When the narrative goes, for telling the student in advance. Null=never. */
  resultExpiresAt: Date | null;
};

/**
 * What has expired for one evaluation, and when the rest will.
 *
 * Used by the sweep to decide what to null, and by the UI to warn somebody
 * before their oldest evaluation thins out rather than after.
 */
export function expiryFor(
  createdAt: Date,
  policy: RetentionPolicy,
  now: Date,
): ExpiryState {
  const snapshotCutoff = cutoffFor(policy.inputSnapshotDays, now);
  const resultCutoff = cutoffFor(policy.resultDays, now);

  return {
    snapshotExpired: snapshotCutoff !== null && createdAt < snapshotCutoff,
    resultExpired: resultCutoff !== null && createdAt < resultCutoff,
    resultExpiresAt:
      policy.resultDays > 0
        ? new Date(createdAt.getTime() + policy.resultDays * 24 * 60 * 60 * 1000)
        : null,
  };
}

/**
 * The most notice worth giving, whatever the window.
 *
 * 30 days' notice makes "export this before it goes" actionable rather than a
 * fact stated the day it happens. It is a CEILING rather than the value itself:
 * on the free plan's 30-day window it would mean warning from the moment the
 * evaluation was written, which is noise rather than notice.
 */
export const EXPIRY_WARNING_DAYS = 30;

export function isExpiringSoon(
  expiresAt: Date | null,
  now: Date,
  warningDays: number,
): boolean {
  if (!expiresAt || warningDays <= 0) return false;
  const warnFrom = new Date(
    expiresAt.getTime() - warningDays * 24 * 60 * 60 * 1000,
  );
  return now >= warnFrom && now < expiresAt;
}
