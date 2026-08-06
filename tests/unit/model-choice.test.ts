// Which model judges a run.
//
// The saving here comes from running follow-ups on a cheaper model. The danger
// is that swapping the judge mid-history moves scores for reasons that have
// nothing to do with the student — the exact failure this app has spent ten
// prompt versions stamping out.
//
// What makes it safe is the anchor: a follow-up is told the previous numbers
// and told not to move them unless the profile moved, so it reproduces a
// calibration the strong model set rather than inventing its own. These tests
// pin the rule that keeps the cheap model strictly inside that guarantee.
import { describe, expect, it } from "vitest";
import {
  chooseEvaluationModel,
  type ModelChoiceInput,
} from "@/lib/evaluation/model-choice";

const BASE: ModelChoiceInput = {
  hasAnchor: true,
  releasedScores: [],
  forceBaseline: false,
  baselineModel: "claude-opus-5",
  baselineEffort: "medium",
  followupModel: "claude-sonnet-5",
  followupEffort: "medium",
};

describe("choosing the model for an evaluation", () => {
  it("uses the cheaper model for an anchored follow-up", () => {
    const choice = chooseEvaluationModel({ ...BASE });
    expect(choice.model).toBe("claude-sonnet-5");
    expect(choice.tier).toBe("follow-up");
  });

  it("uses the full model for the first evaluation of a profile", () => {
    // Nothing to anchor to. This run IS the calibration every later one
    // inherits, so it is the one worth paying for.
    const choice = chooseEvaluationModel({ ...BASE, hasAnchor: false });
    expect(choice.model).toBe("claude-opus-5");
    expect(choice.tier).toBe("baseline");
  });

  it("uses the full model when a score's anchor has been released", () => {
    // A prompt version redefined gradeRelativeScore, so that number has to be
    // worked out from scratch. Handing that to the cheaper model is precisely
    // the unanchored judgement this rule exists to prevent.
    const choice = chooseEvaluationModel({
      ...BASE,
      releasedScores: ["gradeRelativeScore"],
    });
    expect(choice.model).toBe("claude-opus-5");
    expect(choice.tier).toBe("baseline");
  });

  it("uses the full model when the student asks for one", () => {
    const choice = chooseEvaluationModel({ ...BASE, forceBaseline: true });
    expect(choice.model).toBe("claude-opus-5");
    expect(choice.tier).toBe("baseline");
  });

  it("runs everything on the full model when follow-ups are disabled", () => {
    const choice = chooseEvaluationModel({ ...BASE, followupModel: null });
    expect(choice.model).toBe("claude-opus-5");
    expect(choice.tier).toBe("baseline");
  });

  it("never picks the cheaper model without an anchor, whatever else is true", () => {
    // The load-bearing invariant, stated once over the whole input space rather
    // than trusting the four cases above to have covered it.
    for (const hasAnchor of [true, false]) {
      for (const released of [[], ["overallScore"], ["fitScore"]] as const) {
        for (const forceBaseline of [true, false]) {
          const choice = chooseEvaluationModel({
            ...BASE,
            hasAnchor,
            releasedScores: [...released],
            forceBaseline,
          });
          const anchored = hasAnchor && released.length === 0;
          if (choice.tier === "follow-up") {
            expect(anchored).toBe(true);
            expect(forceBaseline).toBe(false);
          }
        }
      }
    }
  });

  it("carries the matching effort with whichever model it picked", () => {
    const choice = chooseEvaluationModel({
      ...BASE,
      baselineEffort: "high",
      followupEffort: "low",
    });
    expect(choice.effort).toBe("low");
    expect(chooseEvaluationModel({
      ...BASE,
      hasAnchor: false,
      baselineEffort: "high",
      followupEffort: "low",
    }).effort).toBe("high");
  });

  it("explains itself in language a student could read", () => {
    // The reason reaches the UI, so it must not be a debug string.
    for (const input of [
      { ...BASE },
      { ...BASE, hasAnchor: false },
      { ...BASE, releasedScores: ["overallScore"] as const },
      { ...BASE, forceBaseline: true },
    ]) {
      const { reason } = chooseEvaluationModel({
        ...input,
        releasedScores: [...input.releasedScores],
      });
      expect(reason.length).toBeGreaterThan(20);
      expect(reason).toMatch(/[.!]$/);
      expect(reason).not.toMatch(/claude-|undefined|null/);
    }
  });
});
