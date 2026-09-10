// Which counselors should be mailed a triage digest, and which left alone.
//
// PURE — no database, no clock of its own beyond what it is handed. This is the
// file to read to find out what the digest job will actually do, and the one to
// argue with if it does something you disagree with.
//
// WHY THIS EXISTS. Triage runs every day and scores the whole caseload, and
// until now a counselor only learned any of it by logging in and looking. The
// signal was being computed and then sitting there. For a professional carrying
// forty students, "check the dashboard daily just in case" is not a workflow,
// and the students who most needed surfacing were the ones nobody thought to
// look at.
//
// WHAT DECIDES A SEND IS NEWS, NOT SEVERITY. It would be easy to invent a
// severity threshold here — only mail about a 4 or a 5 — but the app already
// has a definition of who needs attention (any unresolved signal, see
// lib/counselor/overview.ts) and a second, stricter one in the mail would mean
// the email and the caseload page disagreed about the same students. So the
// digest reports exactly the set the app calls attention-worthy, and the
// question it asks before sending is whether any of it is NEW since the last
// one. Severity orders the list; it does not gate the send.
//
// WHY IT IS CAUTIOUS. Every rule below is subtractive — a reason NOT to send.
// A digest that arrives when nothing has changed is the thing that gets filtered
// into a folder, and a filtered digest is worse than none: it means the one
// week something genuinely moved, nobody read it.

/**
 * Minimum gap between two digests to the same counselor.
 *
 * Seven, so this reads as a weekly note even though the pass runs daily. The
 * cooldown rather than the schedule is what bounds the cadence, which is the
 * same construction the check-in nudge uses: running the job more often then
 * only means news is noticed sooner, never that anybody is mailed more.
 */
export const DIGEST_COOLDOWN_DAYS = 7;

/**
 * How many digests one run may send.
 *
 * A ceiling on the blast radius of a rule that turns out to be wrong. If a
 * future edit accidentally makes every counselor eligible, this caps the damage
 * at something recoverable and visible.
 */
export const MAX_DIGESTS_PER_RUN = 200;

/** How many students the mail names before it stops listing and starts counting. */
export const DIGEST_STUDENT_LIMIT = 8;

/** One student on the caseload who has at least one unresolved signal. */
export type DigestStudent = {
  /** The link, so the mail can deep-link straight to them. */
  linkId: string;
  /** What the counselor calls them. Null when the profile has no name set. */
  name: string | null;
  /** Highest unresolved severity, 1-5. Orders the list; never gates the send. */
  topSeverity: number;
  /** How many unresolved signals they have. */
  signalCount: number;
  /** The most recent unresolved signal, which is what makes them news. */
  newestSignalAt: Date;
};

export type DigestCandidate = {
  counselorAccountId: string;
  email: string;
  /** The org, for a greeting that is not a bare "Hello". */
  orgName: string | null;
  students: DigestStudent[];
  optedOutAt: Date | null;
  lastDigestAt: Date | null;
};

export type DigestDecision =
  | { send: true; students: DigestStudent[]; newSince: number }
  | {
      send: false;
      reason: "opted-out" | "nothing-to-say" | "nothing-new" | "sent-recently";
    };

const DAY_MS = 24 * 60 * 60 * 1000;

const wholeDaysBetween = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / DAY_MS);

/**
 * Most severe first, then most recent. The order the caseload page uses, so a
 * counselor who opens the app after reading the mail sees the same sequence.
 */
export function orderForDigest(students: DigestStudent[]): DigestStudent[] {
  return [...students].sort(
    (a, b) =>
      b.topSeverity - a.topSeverity ||
      b.newestSignalAt.getTime() - a.newestSignalAt.getTime(),
  );
}

/**
 * Should this counselor be mailed?
 *
 * Order matters only for which reason is reported, not for the outcome — every
 * clause is a veto. Written most-important-first so a log line says the most
 * useful thing.
 */
export function digestDecision(
  candidate: DigestCandidate,
  now: Date = new Date(),
): DigestDecision {
  // They asked us to stop. Nothing below this line can overrule it.
  if (candidate.optedOutAt) return { send: false, reason: "opted-out" };

  const students = orderForDigest(candidate.students);
  // A digest saying "nobody needs you" is a mail that teaches the reader these
  // are safe to ignore. Silence carries the same information at no cost.
  if (students.length === 0) return { send: false, reason: "nothing-to-say" };

  // News, not a restatement. A signal already covered by the last digest has
  // been reported once; sending it again weekly until the counselor resolves it
  // turns the digest into a nag about work they have already seen.
  const newSince = candidate.lastDigestAt
    ? students.filter((s) => s.newestSignalAt > candidate.lastDigestAt!).length
    : students.length;
  if (newSince === 0) return { send: false, reason: "nothing-new" };

  // Checked AFTER the news test on purpose, so the reported reason for a quiet
  // week is "nothing-new" rather than a cooldown that happens to also apply.
  if (
    candidate.lastDigestAt &&
    wholeDaysBetween(candidate.lastDigestAt, now) < DIGEST_COOLDOWN_DAYS
  ) {
    return { send: false, reason: "sent-recently" };
  }

  return { send: true, students, newSince };
}

/** Every counselor who should be mailed on this run, capped. */
export function digestsToSend(
  candidates: DigestCandidate[],
  now: Date = new Date(),
): { candidate: DigestCandidate; students: DigestStudent[]; newSince: number }[] {
  const due: {
    candidate: DigestCandidate;
    students: DigestStudent[];
    newSince: number;
  }[] = [];

  for (const candidate of candidates) {
    const decision = digestDecision(candidate, now);
    if (decision.send) {
      due.push({
        candidate,
        students: decision.students,
        newSince: decision.newSince,
      });
    }
  }

  // Most news first, so if the cap bites it keeps the caseloads where the most
  // has moved rather than an arbitrary slice.
  due.sort((a, b) => b.newSince - a.newSince);
  return due.slice(0, MAX_DIGESTS_PER_RUN);
}
