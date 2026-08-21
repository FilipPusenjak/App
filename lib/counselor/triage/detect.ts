// The eight detectors. Zero model calls, by construction.
//
// Each takes facts already loaded for one student and returns the signals it
// finds, with the deterministic basis that produced each. Nothing here asks a
// model anything, and nothing here can: there is no client in scope. That is
// the property that lets a hundred-student caseload be monitored for free, and
// it is a margin feature as much as a correctness one.
//
// Every returned signal carries a `basis` object naming the facts behind it,
// because a counselor has to vet output before repeating it and "the system
// said so" is not something a professional can repeat to a paying parent.
import { parseGradeLevel } from "@/lib/readiness/score";
import type { Rung } from "@/lib/readiness/rungs";
import { RUNGS } from "@/lib/readiness/rungs";
import type { TriageKind } from "@/lib/validation/counselor";
import { severityFor, staleThresholdDays } from "./severity";

export type DetectedSignal = {
  kind: TriageKind;
  severity: number;
  basis: Record<string, unknown>;
};

/** Everything one student's detectors need, loaded once by the runner. */
export type TriageFacts = {
  gradeLevel: string | null;
  /** Latest edit to anything the STUDENT owns — not counselor activity. */
  lastStudentEditAt: Date | null;
  intendedMajor: string | null;
  careerGoal: string | null;
  resumeItems: {
    id: string;
    title: string;
    type: string;
    rungLevel: string | null;
    startDate: Date | null;
    endDate: Date | null;
    updatedAt: Date;
  }[];
  targetSchools: { name: string; country: string; course: string | null }[];
  commitments: {
    id: string;
    description: string;
    status: string;
    dueDate: Date | null;
  }[];
  /**
   * Threshold components from the two most recent evaluations, so "newly
   * binding" can be computed as a CHANGE rather than a state. A component that
   * has been unmet for a year is not news; one that became unmet last week is.
   */
  thresholdNow: ThresholdComponentFact[];
  thresholdBefore: ThresholdComponentFact[] | null;
  /** Differentiation band across the two most recent evaluations. */
  differentiationNow: string | null;
  differentiationBefore: string | null;
  /** Last session actually HELD, not merely generated. */
  lastHeldSessionAt: Date | null;
  now: Date;
};

export type ThresholdComponentFact = {
  school: string;
  label: string;
  state: string;
};

const DAY_MS = 86_400_000;
const days = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);

/** Bands in order, so a drop can be told from a rise. */
const DIFFERENTIATION_ORDER = [
  "emerging",
  "developing",
  "competitive",
  "distinctive",
];

export function detectSignals(facts: TriageFacts): DetectedSignal[] {
  const grade = parseGradeLevel(facts.gradeLevel);
  const out: DetectedSignal[] = [];

  const push = (
    kind: TriageKind,
    basis: Record<string, unknown>,
    magnitude?: Parameters<typeof severityFor>[0]["magnitude"],
  ) => {
    out.push({
      kind,
      severity: severityFor({ kind, gradeLevel: grade, magnitude }),
      basis: { ...basis, gradeLevel: grade },
    });
  };

  /* ── STALE_PROFILE ─────────────────────────────────────────────────────── */
  if (facts.lastStudentEditAt) {
    const quiet = days(facts.lastStudentEditAt, facts.now);
    const threshold = staleThresholdDays(grade);
    if (quiet >= threshold) {
      push(
        "STALE_PROFILE",
        {
          signal: "profile.no_student_edits",
          daysQuiet: quiet,
          thresholdDays: threshold,
          lastEditAt: facts.lastStudentEditAt.toISOString(),
        },
        { days: quiet },
      );
    }
  }

  /* ── THRESHOLD_NEWLY_BINDING ───────────────────────────────────────────── */
  //
  // A CHANGE, not a state. Comparing against the previous evaluation is what
  // makes this "newly" binding — the whole value is catching the week it went
  // wrong, which is invisible to anyone not diffing two snapshots.
  //
  // With no previous evaluation there is nothing to compare, and every unmet
  // component would surface as new. That would bury a counselor on the day
  // they onboard a student, so a first evaluation raises nothing here.
  if (facts.thresholdBefore) {
    const wasOk = new Set(
      facts.thresholdBefore
        .filter((c) => c.state === "MET" || c.state === "PARTIAL")
        .map((c) => `${c.school}::${c.label}`),
    );
    const newlyUnmet = facts.thresholdNow.filter(
      (c) => c.state === "UNMET" && wasOk.has(`${c.school}::${c.label}`),
    );

    for (const component of newlyUnmet) {
      // Unreachable is a judgement about time, and the only one this detector
      // makes: in the final year a newly unmet requirement usually cannot be
      // fixed, and saying so changes what the counselor does about it.
      const unreachable = grade != null && grade >= 12;
      push(
        "THRESHOLD_NEWLY_BINDING",
        {
          signal: "threshold.component_newly_unmet",
          school: component.school,
          component: component.label,
          previousState: facts.thresholdBefore.find(
            (c) => c.school === component.school && c.label === component.label,
          )?.state,
          nowState: component.state,
        },
        { unreachable, count: newlyUnmet.length },
      );
    }
  }

  /* ── COMMITMENT_OVERDUE ────────────────────────────────────────────────── */
  //
  // ACCEPTED and IN_PROGRESS only. A PROPOSED commitment the student never
  // answered is not a broken promise — it is an unanswered suggestion, and
  // treating the two the same would put the app's own unread advice in front
  // of a counselor as if the student had let them down.
  for (const c of facts.commitments) {
    if (!["ACCEPTED", "IN_PROGRESS"].includes(c.status)) continue;
    if (!c.dueDate || c.dueDate >= facts.now) continue;

    const overdue = days(c.dueDate, facts.now);
    push(
      "COMMITMENT_OVERDUE",
      {
        signal: "commitment.past_due_unresolved",
        commitmentId: c.id,
        description: c.description,
        dueDate: c.dueDate.toISOString().slice(0, 10),
        daysOverdue: overdue,
        status: c.status,
      },
      { days: overdue },
    );
  }

  /* ── TRAJECTORY_DROP ───────────────────────────────────────────────────── */
  if (facts.differentiationNow && facts.differentiationBefore) {
    const nowIdx = DIFFERENTIATION_ORDER.indexOf(facts.differentiationNow);
    const beforeIdx = DIFFERENTIATION_ORDER.indexOf(facts.differentiationBefore);
    if (nowIdx >= 0 && beforeIdx >= 0 && nowIdx < beforeIdx) {
      push("TRAJECTORY_DROP", {
        signal: "differentiation.band_fell",
        from: facts.differentiationBefore,
        to: facts.differentiationNow,
      });
    }
  }

  /* ── RUNG_STALLED ──────────────────────────────────────────────────────── */
  //
  // Only for activities still running. A finished activity sitting at the rung
  // it finished on is a completed thing, not a stalled one.
  for (const item of facts.resumeItems) {
    if (item.type === "coursework") continue;
    if (item.endDate && item.endDate < facts.now) continue;
    if (!item.startDate) continue;

    const rung = (item.rungLevel ?? "none") as Rung;
    // The top rung is not a stall — there is nowhere further to climb.
    if (rung === RUNGS[RUNGS.length - 1]) continue;

    const monthsRunning = Math.floor(
      (facts.now.getTime() - item.startDate.getTime()) / (30 * DAY_MS),
    );
    const monthsSinceTouched = Math.floor(
      (facts.now.getTime() - item.updatedAt.getTime()) / (30 * DAY_MS),
    );
    // Long-running AND untouched. Either alone is ordinary: a two-year
    // commitment is what the app asks for, and a recent edit means somebody is
    // still working on it.
    if (monthsRunning >= 14 && monthsSinceTouched >= 6) {
      push(
        "RUNG_STALLED",
        {
          signal: "activity.rung_stalled",
          activityId: item.id,
          activity: item.title,
          rung,
          monthsRunning,
          monthsSinceUpdated: monthsSinceTouched,
        },
        { months: monthsRunning },
      );
    }
  }

  /* ── GOAL_TRAJECTORY_MISMATCH ──────────────────────────────────────────── */
  //
  // Computed STRUCTURALLY, before any model sees it, from the distribution of
  // activity categories against the stated goal. Deliberately crude: it asks
  // whether anything at all points at the stated direction, not whether the
  // portfolio is well-composed. A subtler measure would be a judgement, and a
  // judgement is the counselor's to make.
  const goal = [facts.intendedMajor, facts.careerGoal]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const activities = facts.resumeItems.filter((i) => i.type !== "coursework");
  if (goal.length > 2 && activities.length >= 3) {
    const goalWords = goal
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w));
    if (goalWords.length > 0) {
      const aligned = activities.filter((i) => {
        const text = i.title.toLowerCase();
        return goalWords.some((w) => text.includes(w));
      });
      if (aligned.length === 0) {
        push("GOAL_TRAJECTORY_MISMATCH", {
          signal: "portfolio.no_activity_matches_stated_goal",
          statedGoal: [facts.intendedMajor, facts.careerGoal]
            .filter(Boolean)
            .join(" / "),
          activityCount: activities.length,
          matchedTerms: goalWords,
          // Named so the counselor can see instantly whether the miss is real
          // or an artefact of how things were titled.
          activityTitles: activities.slice(0, 8).map((i) => i.title),
        });
      }
    }
  }

  /* ── DEADLINE_APPROACHING ──────────────────────────────────────────────── */
  //
  // Derived from the application cycle rather than a deadlines table this app
  // does not have, and raised ONLY when something is actually unmet — a
  // deadline with everything in order is a date, not a signal.
  const unmetNow = facts.thresholdNow.filter((c) => c.state === "UNMET");
  if (grade === 12 && unmetNow.length > 0) {
    const deadline = applicationDeadlineFor(facts.now);
    const until = days(facts.now, deadline);
    if (until >= 0 && until <= 90) {
      push(
        "DEADLINE_APPROACHING",
        {
          signal: "cycle.application_deadline_with_unmet_components",
          daysUntil: until,
          deadline: deadline.toISOString().slice(0, 10),
          unmetCount: unmetNow.length,
          unmet: unmetNow.slice(0, 6).map((c) => `${c.school}: ${c.label}`),
        },
        { daysUntil: until, count: unmetNow.length },
      );
    }
  }

  /* ── NO_RECENT_SESSION ─────────────────────────────────────────────────── */
  //
  // Measured from the last HELD session, not the last generated prep. Prep that
  // was generated and never used is the opposite of contact.
  const sessionGapDays = facts.lastHeldSessionAt
    ? days(facts.lastHeldSessionAt, facts.now)
    : null;
  const sessionThreshold = grade != null && grade >= 12 ? 45 : 90;
  if (sessionGapDays == null || sessionGapDays >= sessionThreshold) {
    push(
      "NO_RECENT_SESSION",
      {
        signal: "session.none_held_recently",
        daysSinceLastHeld: sessionGapDays,
        thresholdDays: sessionThreshold,
        everHeld: facts.lastHeldSessionAt != null,
      },
      { days: sessionGapDays ?? 365 },
    );
  }

  return out;
}

/**
 * The next 1 November, the date most of this app's target systems converge on.
 *
 * An approximation and labelled as one in the basis, because this app holds no
 * per-programme deadline table. It is honest enough for "a deadline is close
 * and things are unmet", which is all this signal claims.
 */
function applicationDeadlineFor(now: Date): Date {
  const year = now.getUTCFullYear();
  const thisYear = new Date(Date.UTC(year, 10, 1));
  return now <= thisYear ? thisYear : new Date(Date.UTC(year + 1, 10, 1));
}

/** Words too common to mean anything when matching a goal to an activity. */
const STOPWORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "studies",
  "study",
  "science",
  "sciences",
  "engineering",
  "work",
  "career",
  "want",
  "become",
  "working",
]);
