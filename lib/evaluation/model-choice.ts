// Which model judges this run.
//
// A full evaluation on the strongest model is the expensive part of this app,
// and most runs do not need one. After a student has a baseline, a follow-up
// run is a much smaller job: the previous scores are fed back in as an anchor,
// unchanged items carry their assessments forward, and the model's task is
// "what did this change" rather than "judge this profile from nothing".
//
// SO WHY IS THIS SAFE, when swapping the judge mid-history is exactly how
// scores drift for reasons that have nothing to do with the student?
//
// Because the anchor is what pins them. A follow-up run is TOLD the previous
// numbers and told not to move them unless the profile moved — so it is
// reproducing a calibration the strong model already set, not inventing one.
// Take the anchor away and that stops being true, which is the whole of the
// rule below: the cheaper model is used only where the anchor is intact.
//
// The two places it is not intact both fall back to the baseline model:
//
//   - There is no previous real run. Nothing to anchor to; this run IS the
//     calibration every later one inherits, so it gets the strong model.
//   - A prompt version REDEFINED a score, releasing its anchor (see
//     versions.ts). That number has to be re-derived from scratch, which is
//     precisely the judgement worth paying for.
//
// Policy only — no database and no client — so the rule can be tested on its
// own. The route applies it.
import type { ScoreKey } from "@/lib/prompts/evaluation/versions";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Why a run was judged the way it was. Recorded, and shown to the student. */
export type ModelTier = "baseline" | "follow-up";

export type ModelChoice = {
  model: string;
  effort: Effort;
  tier: ModelTier;
  /** One line, in plain language — this reaches the UI. */
  reason: string;
};

export type ModelChoiceInput = {
  /** A usable previous run exists to anchor this one to. */
  hasAnchor: boolean;
  /** Scores whose definition changed since that run, so their anchor is released. */
  releasedScores: ScoreKey[];
  /** The student explicitly asked for a fresh full evaluation. */
  forceBaseline: boolean;
  /** The strong model, and the effort evaluations normally run at. */
  baselineModel: string;
  baselineEffort: Effort;
  /**
   * The cheaper model for anchored follow-ups, or null to disable the whole
   * behaviour and run every evaluation on the baseline model.
   */
  followupModel: string | null;
  followupEffort: Effort;
};

export function chooseEvaluationModel(input: ModelChoiceInput): ModelChoice {
  const baseline = (reason: string): ModelChoice => ({
    model: input.baselineModel,
    effort: input.baselineEffort,
    tier: "baseline",
    reason,
  });

  if (!input.followupModel) {
    return baseline("Every evaluation is set to run on the full model.");
  }
  if (input.forceBaseline) {
    return baseline("You asked for a full re-evaluation.");
  }
  if (!input.hasAnchor) {
    return baseline(
      "This is the first evaluation of this profile, so it runs on the full " +
        "model and sets the baseline later runs are measured against.",
    );
  }
  if (input.releasedScores.length > 0) {
    return baseline(
      "The scoring scale changed since the last run, so those scores are " +
        "worked out from scratch on the full model rather than carried over.",
    );
  }

  return {
    model: input.followupModel,
    effort: input.followupEffort,
    tier: "follow-up",
    reason:
      "A follow-up run: your previous scores anchor this one, so it uses a " +
      "faster, cheaper model. Ask for a full re-evaluation any time you want " +
      "a fresh read.",
  };
}
