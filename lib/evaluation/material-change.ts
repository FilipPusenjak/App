// Has anything happened that a check-in could honestly have something to say about?
//
// Answered deterministically, BEFORE any model is called. If the answer is no,
// no model runs and no quota is spent — the student gets their current standing,
// the next milestone, and their open commitments, and that is the whole
// response.
//
// This is a first-class outcome, not a degraded one. A weekly check-in on a
// profile nobody touched has nothing to report, and a model asked to produce
// insight anyway will produce some: it will find a nuance, reframe last week's
// advice, or invent a small urgency. Doing that every week teaches a student
// that the app's output is noise, and charges them for the lesson.
//
// Pure: no database, no model.
import type { ScoredProfile } from "@/lib/readiness/score";

export type MaterialChangeInput = {
  scored: ScoredProfile;
  /** Bands recorded on the preceding check-in, if there was one. */
  previous: {
    thresholdBand: string | null;
    differentiationBand: string | null;
    paceStatus: string | null;
    /** Rung per activity id at that point. */
    rungs: Record<string, string>;
  } | null;
  /** Profile edits since the preceding check-in. */
  changeCount: number;
  /**
   * How many things the student has reported that no check-in has read.
   *
   * Always material. A student who writes "I got the role" and is then told
   * nothing changed has been ignored by the app, which is worse than a wasted
   * run — it teaches them the box does nothing and they stop using it.
   */
  unreadDevelopments?: number;
  openCommitments: { dueDate: Date | null; status: string }[];
  now?: Date;
};

export type MaterialChangeVerdict = {
  material: boolean;
  /** Why, in the order they were checked. Empty when nothing changed. */
  reasons: string[];
};

/** A commitment coming due within this window is worth a check-in on its own. */
const DUE_SOON_DAYS = 14;

export function detectMaterialChange(
  input: MaterialChangeInput,
): MaterialChangeVerdict {
  const now = input.now ?? new Date();
  const reasons: string[] = [];

  // A first check-in always runs: there is no baseline to be unchanged from.
  if (!input.previous) {
    return { material: true, reasons: ["first check-in"] };
  }

  // Checked before anything computed: the student telling us something is the
  // strongest signal available, and it is the only one they can see themselves.
  if ((input.unreadDevelopments ?? 0) > 0) {
    reasons.push(
      `${input.unreadDevelopments} thing(s) the student reported and no check-in has answered`,
    );
  }

  if (input.changeCount > 0) {
    reasons.push(`${input.changeCount} profile change(s)`);
  }

  const p = input.previous;
  if (p.thresholdBand !== input.scored.thresholdBand) {
    reasons.push(
      `requirements band moved ${p.thresholdBand} → ${input.scored.thresholdBand}`,
    );
  }
  if (p.differentiationBand !== input.scored.differentiation.band) {
    reasons.push(
      `differentiation band moved ${p.differentiationBand} → ${input.scored.differentiation.band}`,
    );
  }
  if (p.paceStatus !== input.scored.pace.status) {
    reasons.push(`pace moved ${p.paceStatus} → ${input.scored.pace.status}`);
  }

  // A rung moving is material even when the band did not: it is the smallest
  // real progress this app can see, and missing it would tell a student who
  // just became captain that nothing happened.
  for (const activity of input.scored.differentiation.activities) {
    const before = p.rungs[activity.id];
    if (before && before !== activity.rung) {
      reasons.push(`${activity.title}: ${before} → ${activity.rung}`);
    }
  }

  const dueSoon = input.openCommitments.filter(
    (c) =>
      c.dueDate != null &&
      c.dueDate.getTime() <= now.getTime() + DUE_SOON_DAYS * 86_400_000,
  );
  if (dueSoon.length > 0) {
    reasons.push(`${dueSoon.length} commitment(s) due or overdue`);
  }

  return { material: reasons.length > 0, reasons };
}

export type NoChangeResponse = {
  materialChange: false;
  standing: {
    thresholdBand: string;
    differentiationBand: string;
    paceStatus: string;
  };
  openCommitments: { id: string; description: string; dueDate: string | null }[];
  nextMilestone: { label: string; date: string } | null;
  message: string;
};

/**
 * The templated response for "nothing changed".
 *
 * Written here rather than generated, precisely because generating it is the
 * thing being avoided. It states what is true and stops, with no manufactured
 * insight and no invented urgency.
 */
export function buildNoChangeResponse(input: {
  scored: ScoredProfile;
  openCommitments: { id: string; description: string; dueDate: Date | null }[];
  nextMilestone: { label: string; date: Date } | null;
}): NoChangeResponse {
  const open = input.openCommitments;
  const message =
    open.length > 0
      ? "Nothing has changed since your last check-in, so there's nothing new to tell you. Your open commitments are below."
      : "Nothing has changed since your last check-in. That's fine — not every fortnight has news in it.";

  return {
    materialChange: false,
    standing: {
      thresholdBand: input.scored.thresholdBand,
      differentiationBand: input.scored.differentiation.band,
      paceStatus: input.scored.pace.unknownGrade
        ? "no grade set"
        : input.scored.pace.status,
    },
    openCommitments: open.map((c) => ({
      id: c.id,
      description: c.description,
      dueDate: c.dueDate ? c.dueDate.toISOString().slice(0, 10) : null,
    })),
    nextMilestone: input.nextMilestone
      ? {
          label: input.nextMilestone.label,
          date: input.nextMilestone.date.toISOString().slice(0, 10),
        }
      : null,
    message,
  };
}
