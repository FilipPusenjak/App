// When to stop.
//
// THIS IS THE PRODUCT. Everything else here is a score tracker with a good data
// model; this is the part no incumbent will build, because saying it shortens
// the engagement that pays for the tool.
//
// It is not a moral flourish bolted onto a scoring app. It is the direct
// application of a rule the shared core has enforced since it was written —
// lib/readiness/threshold.ts, line one of its header: A THRESHOLD CAPS AT MET.
// Exceeding a stated requirement does not accumulate. Test scores are threshold
// components. Therefore, past the band, more points buy nothing, and a tool that
// stays quiet about that is lying by omission to a family paying by the hour.
//
// Rules this file lives under, all of them asserted in tests:
//
//   PURE COMPUTATION. Zero model calls. A signal a model could decline to emit
//   is a signal that will get softened the first time someone tunes a prompt.
//
//   EVERY SIGNAL CARRIES ITS BASIS. A tutor is about to tell a parent to stop
//   paying them. They will not do that on a system's say-so, and they should
//   not have to — the numbers behind it are attached to the signal itself.
//
//   NEVER SUPPRESSED, SOFTENED, DELAYED, OR GATED BEHIND A TIER. There is no
//   entitlement check anywhere in this file and there must never be one. The
//   free tier gets this. The overdue-invoice tier gets this.
import {
  ENGAGEMENT_COMPLETE_KINDS,
  type StoppingKind,
  type TestSectionSchema,
  type CompositeRule,
} from "@/lib/validation/testprep";
import { compositeAsSchoolSeesIt, type SectionScores } from "./composite";
import type { DerivedTarget, PolicySchool } from "./target";
import type { Allocation } from "./allocation";

export type StoppingBasis = Record<string, unknown>;

export type FiredSignal = {
  kind: StoppingKind;
  basis: StoppingBasis;
  /** Plain language for the tutor's card. Never softened, never hedged. */
  summary: string;
};

export type StoppingInput = {
  target: DerivedTarget;
  schools: PolicySchool[];
  attempts: { sectionScores: SectionScores; composite: number | null }[];
  allocations: Allocation[];
  rule: CompositeRule;
  schema: TestSectionSchema;
  /**
   * One standard retake increment, in composite points.
   *
   * Not a prediction of what this student would gain — it is the granularity at
   * which the question "would another sitting change any outcome" can be asked
   * at all. Deliberately generous: if even an optimistic increment moves no
   * school, the answer is not close.
   */
  retakeIncrement: number;
};

/**
 * A generous standard increment per test.
 *
 * Generous on purpose. This number exists to answer "could another sitting
 * possibly matter", so erring high means the engine only says stop when stopping
 * is clearly right. A stingy increment would fire MARGINAL_VALUE_ZERO on
 * students who genuinely had something to gain.
 */
export function standardRetakeIncrement(rule: CompositeRule, schema: TestSectionSchema): number {
  const span =
    schema.compositeMax !== null && schema.compositeMin !== null
      ? schema.compositeMax - schema.compositeMin
      : null;
  if (span === null || span <= 0) return 0;
  // ~5% of the scale: 60 points on the 400–1600 SAT, 2 points on the 1–36 ACT.
  return Math.max(1, Math.round(span * 0.05));
}

/**
 * Which schools a given composite would satisfy.
 *
 * Per school, because each one sees a different number — a superscoring target
 * reads the best sections combined and a non-superscoring one reads the best
 * single sitting.
 */
function schoolsMetAt(
  input: StoppingInput,
  bonus: number,
): { met: string[]; unmet: string[] } {
  const met: string[] = [];
  const unmet: string[] = [];

  for (const school of input.schools) {
    if (school.policy === "BLIND") continue;
    const contribution = input.target.contributions.find(
      (c) => c.schoolId === school.schoolId,
    );
    if (!contribution || contribution.bar === null) continue;
    // A test-optional school the student is not sending to is not a bar they
    // have to clear, so it cannot hold the engagement open.
    if (school.policy === "OPTIONAL" && !contribution.contributes) continue;

    const seen = compositeAsSchoolSeesIt(
      input.attempts,
      input.rule,
      input.schema,
      school.superscores,
    );
    if (seen === null) {
      unmet.push(school.schoolId);
      continue;
    }
    if (seen + bonus >= contribution.bar) met.push(school.schoolId);
    else unmet.push(school.schoolId);
  }

  return { met, unmet };
}

/**
 * Every stopping signal that currently holds.
 *
 * Returns all of them rather than the first: SUPERSCORE_COMPLETE and
 * ALL_TARGETS_MET can both be true, and they are different facts a tutor may
 * want to cite to a different audience. The caller decides what to show; this
 * decides what is true.
 */
export function evaluateStopping(input: StoppingInput): FiredSignal[] {
  const fired: FiredSignal[] = [];
  const { target } = input;

  const now = schoolsMetAt(input, 0);
  const considered = now.met.length + now.unmet.length;

  // Nothing to say when no school on the list sets a bar at all. That is a
  // target-derivation fact, not a stopping fact, and firing here would tell a
  // student to stop studying because we happen to hold no data about their
  // schools — the worst possible reason.
  if (considered === 0) return fired;

  /* ── ALL_TARGETS_MET ──────────────────────────────────────────────────────
     The strongest form. Every non-blind school that sets a bar is cleared by
     what that school would actually see. */
  if (now.unmet.length === 0) {
    fired.push({
      kind: "ALL_TARGETS_MET",
      basis: {
        signal: "stopping.all_targets_met",
        schoolsConsidered: considered,
        schoolsMet: now.met.length,
        bindingComposite: target.bindingComposite,
        bindingSchool: target.bindingSchoolName,
        excludedBlindSchools: target.excludedBlindSchoolIds.length,
      },
      summary:
        target.bindingSchoolName !== null
          ? `Every school on this list is cleared, including ${target.bindingSchoolName}, which sets the highest bar at ${target.bindingComposite}. More points do not change any admission outcome on this list.`
          : `Every school on this list is cleared. More points do not change any admission outcome on this list.`,
    });
  }

  /* ── MARGINAL_VALUE_ZERO ──────────────────────────────────────────────────
     A gap may remain, but a full standard retake increment would not move a
     single school from unmet to met. Sitting again cannot pay for itself. */
  if (now.unmet.length > 0 && input.retakeIncrement > 0) {
    const after = schoolsMetAt(input, input.retakeIncrement);
    const wouldGain = after.met.length - now.met.length;
    if (wouldGain <= 0) {
      fired.push({
        kind: "MARGINAL_VALUE_ZERO",
        basis: {
          signal: "stopping.marginal_value_zero",
          retakeIncrement: input.retakeIncrement,
          schoolsMetNow: now.met.length,
          schoolsMetAfterIncrement: after.met.length,
          schoolsStillUnmet: after.unmet.length,
        },
        summary: `A full standard retake gain of ${input.retakeIncrement} points would move no school on this list from unmet to met. The remaining gap is not one more sitting will close.`,
      });
    }
  }

  /* ── SUPERSCORE_COMPLETE ──────────────────────────────────────────────────
     Every section is already at its ceiling, so there is no sitting that could
     improve the composed score. Distinct from ALL_TARGETS_MET: a student can be
     maxed and still short of a very high bar, and that is a different
     conversation — about the list, not about the studying. */
  const maxedOut = input.allocations.length > 0 && input.allocations.every((a) => a.headroom <= 0);
  if (maxedOut) {
    fired.push({
      kind: "SUPERSCORE_COMPLETE",
      basis: {
        signal: "stopping.superscore_complete",
        sections: input.allocations.map((a) => ({
          section: a.sectionName,
          score: a.currentScore,
          headroom: a.headroom,
        })),
      },
      summary:
        "Every section is at its maximum. No further sitting can improve the superscore.",
    });
  }

  /* ── DIMINISHING_RETURNS ──────────────────────────────────────────────────
     A gap remains and there is technically room, but it is concentrated where
     there is almost none — the student would have to move a section that is
     nearly maxed. Fires alongside a remaining gap, and says so honestly rather
     than presenting it as "nearly there". */
  if (now.unmet.length > 0 && !maxedOut) {
    const withRoom = input.allocations.filter((a) => a.headroom > 0);
    const totalHeadroom = withRoom.reduce((sum, a) => sum + a.headroom, 0);
    const seen = compositeAsSchoolSeesIt(
      input.attempts,
      input.rule,
      input.schema,
      // The binding school's own policy decides what "the gap" even is.
      input.schools.find((s) => s.schoolId === target.bindingSchoolId)?.superscores ?? false,
    );
    const gap =
      target.bindingComposite !== null && seen !== null
        ? target.bindingComposite - seen
        : null;

    // Room exists but not enough of it to close the gap, even spending all of it.
    if (gap !== null && gap > 0 && totalHeadroom > 0 && totalHeadroom < gap) {
      fired.push({
        kind: "DIMINISHING_RETURNS",
        basis: {
          signal: "stopping.diminishing_returns",
          gapToBindingSchool: gap,
          totalHeadroomRemaining: totalHeadroom,
          sectionsWithRoom: withRoom.map((a) => ({
            section: a.sectionName,
            headroom: a.headroom,
          })),
        },
        summary: `The gap to ${target.bindingSchoolName ?? "the binding school"} is ${gap} points, and only ${totalHeadroom} points of room remain across every section combined. A perfect performance would not close it.`,
      });
    }
  }

  /* ── RETAKE_NOT_INDICATED ─────────────────────────────────────────────────
     The catch-all conclusion, fired when any of the above make another sitting
     unsupported. Separated so a tutor can cite the plain recommendation without
     having to explain the arithmetic behind it. */
  if (fired.length > 0) {
    fired.push({
      kind: "RETAKE_NOT_INDICATED",
      basis: {
        signal: "stopping.retake_not_indicated",
        because: fired.map((f) => f.kind),
      },
      summary:
        "Another sitting is not supported by the gap analysis. The reasons are listed above.",
    });
  }

  return fired;
}

/**
 * Whether these signals mean the ENGAGEMENT is finished, not merely that one
 * more sitting is unwise.
 */
export function isEngagementComplete(signals: { kind: StoppingKind }[]): boolean {
  return signals.some((s) => ENGAGEMENT_COMPLETE_KINDS.includes(s.kind));
}

/**
 * The handoff, when score stops being the binding constraint.
 *
 * INFORMATION, NOT AN UPSELL. It is a true statement about where this student's
 * remaining work lies — their threshold components are satisfied and what is
 * left is differentiation, which is a different professional's job. It happens
 * to point at the counselor edition, and it would be equally true if that
 * product did not exist. Rendered as a plain paragraph, never as an
 * interstitial, and never in place of the stopping signal itself.
 */
export function handoffMessage(target: DerivedTarget): string {
  const name = target.bindingSchoolName;
  return [
    name
      ? `This student's score now clears ${name}, which set the highest bar on their list.`
      : `This student's score now clears every school on their list that sets a bar.`,
    "Their binding constraint is no longer the test. What decides the remaining outcomes is differentiation — depth, escalation and coherence across what they actually do — which is not what test preparation moves.",
    "That is worth saying to the family plainly, because it is the honest reason to stop, and it is a better answer than more points.",
  ].join(" ");
}
