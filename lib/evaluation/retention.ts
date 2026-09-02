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
//   resultJson goes LATER. It is what a student re-reads and what anchoring
//   reuses, so it needs to cover an application cycle rather than a month.
//
//   The SCORES ARE NEVER DELETED. Watching a readiness score move across four
//   years of secondary school is the point of the product, so the numbers
//   outlive the prose they were extracted from — see chart-point.ts.

/**
 * Days before the raw profile snapshot is deleted.
 *
 * 60, because its only consumer is the diff between consecutive runs and the
 * rate limits make runs weeks apart at most. Long enough that a student who
 * disappears for a month still gets an anchored follow-up; short enough that
 * the essay drafts are not sitting there a year later.
 */
export const DEFAULT_INPUT_SNAPSHOT_DAYS = 60;

/**
 * Days before the evaluation narrative is deleted.
 *
 * 365, so a student can re-read across a whole application cycle and a
 * follow-up in September still anchors to one from the previous autumn.
 */
export const DEFAULT_RESULT_DAYS = 365;

export type RetentionPolicy = {
  inputSnapshotDays: number;
  resultDays: number;
};

/**
 * The configured policy.
 *
 * Zero or negative on either field disables that expiry — the escape hatch for
 * a deployment that wants to keep everything, and the reason this reads the
 * environment rather than hard-coding. A malformed value falls back to the
 * default rather than to "never", because an unparseable number should not
 * silently switch retention off.
 */
export function getRetentionPolicy(): RetentionPolicy {
  return {
    inputSnapshotDays: days(
      "RETENTION_INPUT_SNAPSHOT_DAYS",
      DEFAULT_INPUT_SNAPSHOT_DAYS,
    ),
    resultDays: days("RETENTION_RESULT_DAYS", DEFAULT_RESULT_DAYS),
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
 * Whether an evaluation is close enough to losing its narrative to say so.
 *
 * 30 days' notice, so "export this before it goes" is actionable rather than a
 * fact stated the day it happens.
 */
export const EXPIRY_WARNING_DAYS = 30;

export function isExpiringSoon(
  expiresAt: Date | null,
  now: Date,
): boolean {
  if (!expiresAt) return false;
  const warnFrom = new Date(
    expiresAt.getTime() - EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000,
  );
  return now >= warnFrom && now < expiresAt;
}
