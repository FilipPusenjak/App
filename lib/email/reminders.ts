// Who should be sent a check-in reminder, and who should be left alone.
//
// PURE — no database, no clock of its own beyond what it is handed. This is
// the file to read to find out what the nudge job will actually do, and the
// one to argue with if it does something you disagree with.
//
// WHY THIS EXISTS AT ALL. Of the students on the deployment when it was
// written, not one had returned on a later day than they signed up, and the
// product's whole loop is a check-in every fortnight. Nothing brought anybody
// back because nothing could: the app had no way to reach anyone.
//
// WHY IT IS CAUTIOUS. The recipients are mostly minors, and mail they did not
// ask for is the fastest way to become the thing they mute. So the rules below
// are all subtractive — every one of them is a reason NOT to send.
import { randomBytes } from "node:crypto";

/**
 * Days of silence before a reminder is warranted.
 *
 * The check-in interval on Student Plus is two days and on free it is
 * fourteen; this is deliberately longer than either. A reminder is not a
 * prompt to use the maximum allowance, it is a note that a real gap has
 * opened — and a fortnight is the cadence the product is actually built
 * around.
 */
export const REMIND_AFTER_DAYS = 14;

/**
 * Minimum gap between two reminders to the same person.
 *
 * Without it, somebody who reads the mail and does nothing gets another one on
 * the job's next run, and every run after that, forever — the definition of
 * the thing people mute. Longer than REMIND_AFTER_DAYS so a single ignored
 * reminder cannot become a fortnightly drumbeat.
 */
export const REMIND_COOLDOWN_DAYS = 21;

/**
 * How many reminders one run may send.
 *
 * A ceiling on the blast radius of a rule that turns out to be wrong. If a
 * future edit accidentally makes everyone eligible, this caps the damage at
 * something recoverable and visible rather than mailing the entire user table
 * before anybody notices.
 */
export const MAX_REMINDERS_PER_RUN = 200;

export type ReminderCandidate = {
  userId: string;
  email: string;
  name: string | null;
  /** Their most recent real run, of any kind. Null if they have never run one. */
  lastRunAt: Date | null;
  /** Whether they have a completed evaluation to check in AGAINST. */
  hasBaseline: boolean;
  /** Whether the profile could actually be evaluated right now. */
  canRun: boolean;
  optedOutAt: Date | null;
  lastRemindedAt: Date | null;
};

export type ReminderDecision =
  | { send: true; daysSince: number }
  | {
      send: false;
      reason:
        | "opted-out"
        | "no-baseline"
        | "not-evaluable"
        | "too-soon"
        | "reminded-recently";
    };

const DAY_MS = 24 * 60 * 60 * 1000;

const wholeDaysBetween = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / DAY_MS);

/**
 * Should this person be reminded?
 *
 * Order matters only for which reason is reported, not for the outcome — every
 * clause below is a veto. It is written most-important-first so a log line
 * says the most useful thing.
 */
export function reminderDecision(
  candidate: ReminderCandidate,
  now: Date = new Date(),
): ReminderDecision {
  // They asked us to stop. Nothing below this line can overrule it.
  if (candidate.optedOutAt) return { send: false, reason: "opted-out" };

  // A check-in compares against a previous evaluation. With no baseline there
  // is nothing to check in against, and the mail would be inviting somebody to
  // press a button that refuses them — see the check-in route, which needs a
  // preceding run.
  if (!candidate.hasBaseline || !candidate.lastRunAt) {
    return { send: false, reason: "no-baseline" };
  }

  // A profile that has since lost its targets, or been emptied, cannot run
  // anything. Nudging it would send somebody to a disabled button.
  if (!candidate.canRun) return { send: false, reason: "not-evaluable" };

  const daysSince = wholeDaysBetween(candidate.lastRunAt, now);
  if (daysSince < REMIND_AFTER_DAYS) return { send: false, reason: "too-soon" };

  if (
    candidate.lastRemindedAt &&
    wholeDaysBetween(candidate.lastRemindedAt, now) < REMIND_COOLDOWN_DAYS
  ) {
    return { send: false, reason: "reminded-recently" };
  }

  return { send: true, daysSince };
}

/** Everyone who should be mailed on this run, capped. */
export function remindersToSend(
  candidates: ReminderCandidate[],
  now: Date = new Date(),
): { candidate: ReminderCandidate; daysSince: number }[] {
  const due: { candidate: ReminderCandidate; daysSince: number }[] = [];
  for (const candidate of candidates) {
    const decision = reminderDecision(candidate, now);
    if (decision.send) due.push({ candidate, daysSince: decision.daysSince });
  }
  // Longest-silent first, so if the cap bites it keeps the people who have
  // been gone longest rather than an arbitrary slice.
  due.sort((a, b) => b.daysSince - a.daysSince);
  return due.slice(0, MAX_REMINDERS_PER_RUN);
}

/**
 * A fresh unsubscribe token.
 *
 * 256 bits, because it travels in a URL that ends up in mail logs, forwarded
 * messages and browser history, and the only thing standing between a guess
 * and switching off somebody's mail is how big the space is.
 */
export function mintUnsubscribeToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The link a PERSON clicks, which renders a page confirming what happened.
 */
export function unsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * The link the MAIL CLIENT uses, which must accept a POST.
 *
 * List-Unsubscribe-Post tells Gmail and friends they may unsubscribe by
 * POSTing to the header's URL without ever opening a browser — that is what
 * puts the one-click control in the client's own chrome. A Next.js page cannot
 * handle POST, so the header points at a route handler while the link in the
 * body points at the page above. Both spend the same token and do the same
 * thing; they differ only in what they render afterwards.
 */
export function oneClickUnsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}
