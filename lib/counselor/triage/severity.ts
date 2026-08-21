// How urgent a signal is, given who it is about and when.
//
// The single most important thing in this file: SEVERITY IS NOT A CONSTANT PER
// KIND. The same unmet prerequisite is a plan for a 9th grader and a crisis for
// a 12th grader, because the only thing that separates the two is how much time
// is left to do something about it. A fixed severity table would rank a
// freshman's missing Chemistry above a senior's overdue commitment, and a
// counselor who saw that once would stop trusting the ordering.
//
// It is also not a quality judgement, and cannot become one. Nothing here reads
// a readiness score, a differentiation band or a percentile. A student surfaces
// because something about their SITUATION needs a professional's attention, and
// the strongest student in a caseload may need the most of it.
//
// Pure: no database, no model. Every input is a fact the triage queries already
// computed, which is what lets a hundred-student caseload be triaged without an
// API call.
import { monthsUntilApplication } from "@/lib/readiness/pace";
import {
  SEVERITY_MAX,
  SEVERITY_MIN,
  type TriageKind,
} from "@/lib/validation/counselor";

/** Clamp into the 1-5 the schema and the UI both assume. */
function clamp(n: number): number {
  return Math.max(SEVERITY_MIN, Math.min(SEVERITY_MAX, Math.round(n)));
}

/**
 * How much runway is left, as a 0-1 scale where 1 means "no time at all".
 *
 * Derived from the same monthsUntilApplication the student app uses, so a
 * counselor's sense of urgency and a student's are computed from one clock.
 *
 * An unknown grade returns 0.5 rather than 0 or 1. Treating it as urgent would
 * flood the attention list with students whose grade nobody filled in; treating
 * it as relaxed would hide a senior whose profile is merely incomplete. The
 * middle is the honest answer to "we do not know how long they have".
 */
export function urgencyFromGrade(gradeLevel: number | null): number {
  const months = monthsUntilApplication(gradeLevel);
  if (months == null) return 0.5;
  // 50 months is a 9th grader at the start; 0 is a senior at the deadline.
  const MAX_RUNWAY = 50;
  return Math.max(0, Math.min(1, 1 - months / MAX_RUNWAY));
}

export type SeverityInput = {
  kind: TriageKind;
  gradeLevel: number | null;
  /** Facts the specific detector measured. Interpreted per kind below. */
  magnitude?: {
    /** Days a profile has been untouched, days a commitment is overdue, etc. */
    days?: number;
    /** Months an activity has sat at one rung. */
    months?: number;
    /** Days until a deadline. */
    daysUntil?: number;
    /** How many distinct things are affected — unmet components, say. */
    count?: number;
    /** True when the detector believes the situation is no longer reachable. */
    unreachable?: boolean;
  };
};

/**
 * The severity of one signal.
 *
 * Each kind states its own reasoning, because "why is this a 4" is a question a
 * counselor will eventually ask and a single blended formula could not answer.
 */
export function severityFor(input: SeverityInput): number {
  const urgency = urgencyFromGrade(input.gradeLevel);
  const m = input.magnitude ?? {};

  switch (input.kind) {
    /**
     * The Chemistry-HL class of problem: binary, fatal, and invisible until
     * someone checks. Highest default, and the only kind that can reach 5 on
     * time pressure alone — a requirement that has become unreachable is not
     * something a counselor can be told about next month.
     */
    case "THRESHOLD_NEWLY_BINDING": {
      const base = m.unreachable ? 4 : 3;
      return clamp(base + urgency * 2);
    }

    /**
     * A dated obligation with unmet prerequisites behind it. Scales on the
     * deadline itself rather than on the grade, because a deadline is its own
     * clock — a test registration closing in six days is urgent for anyone.
     */
    case "DEADLINE_APPROACHING": {
      const days = m.daysUntil ?? 60;
      const closeness =
        days <= 7 ? 2 : days <= 21 ? 1.4 : days <= 45 ? 0.8 : 0.3;
      return clamp(2.5 + closeness + urgency * 0.8);
    }

    /**
     * They agreed to it, and the date has passed. The signal is about
     * follow-through rather than the task, so it grows with how long it has
     * been ignored rather than with how big the task was.
     */
    case "COMMITMENT_OVERDUE": {
      const days = m.days ?? 0;
      const drift = days <= 7 ? 0 : days <= 30 ? 0.7 : days <= 90 ? 1.4 : 2;
      return clamp(1.8 + drift + urgency);
    }

    /**
     * Depth has gone backwards across two periods. Slow-moving and easy to miss
     * session-to-session, which is exactly why it is computed rather than
     * noticed — and more serious late, when there is no time to rebuild.
     */
    case "TRAJECTORY_DROP":
      return clamp(2 + urgency * 2);

    /**
     * Nothing touched in a while, scaled by grade.
     *
     * A senior going quiet in October is urgent; a freshman quiet in June is
     * a summer holiday. Both the threshold and the weight move, which is why
     * this cannot be a fixed day count with a fixed severity.
     */
    case "STALE_PROFILE": {
      const days = m.days ?? 0;
      const overdue = days / Math.max(1, staleThresholdDays(input.gradeLevel));
      return clamp(1.2 + Math.min(2, overdue) + urgency * 1.5);
    }

    /**
     * An activity at one rung past its escalation window. The least alarming
     * kind by design: standing still is normal, and only becomes interesting
     * when there is no longer time to climb.
     */
    case "RUNG_STALLED": {
      const months = m.months ?? 12;
      const stall = months >= 24 ? 1.2 : months >= 18 ? 0.8 : 0.4;
      return clamp(1.3 + stall + urgency * 1.5);
    }

    /**
     * The portfolio does not point at the stated goal.
     *
     * Deliberately mild early and serious late. In 9th grade a mismatch is a
     * student who has not chosen yet, which is not a problem. In 12th it is a
     * story that will not hold together on an application, which is.
     */
    case "GOAL_TRAJECTORY_MISMATCH":
      return clamp(1 + urgency * 3);

    /**
     * No held session in a while. The counselor's own signal about their own
     * caseload, and the only kind that says nothing about the student — so it
     * stays low and never crowds out something happening to them.
     */
    case "NO_RECENT_SESSION": {
      const days = m.days ?? 0;
      const gap = days >= 120 ? 1.5 : days >= 60 ? 0.9 : 0.4;
      // Grade carries more weight here than the gap does, and deliberately so.
      // Not having seen a senior for six weeks is a different fact from not
      // having seen a freshman for six weeks, and an earlier version damped
      // this so hard that rounding collapsed the two — grade-aware in the
      // arithmetic and constant in the output, which is the same as not being
      // grade-aware at all. The ceiling still lands below a student crisis.
      return clamp(0.8 + gap + urgency * 1.6);
    }
  }
}

/**
 * How long a profile may sit untouched before it is worth noticing.
 *
 * Grade-scaled, because "quiet" means different things at different points. A
 * senior in application season is expected to be active weekly; a freshman over
 * a summer is not, and nagging a counselor about one would train them to ignore
 * the signal that matters.
 */
export function staleThresholdDays(gradeLevel: number | null): number {
  switch (gradeLevel) {
    case 12:
      return 14;
    case 11:
      return 30;
    case 10:
      return 60;
    case 9:
      return 90;
    default:
      // Unknown grade: the middle again, for the same reason as urgency.
      return 45;
  }
}
