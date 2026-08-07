// Is this deployment actually wired up to the model? — SERVER ONLY.
//
// Written after an evening spent working out, from the outside, whether a
// deployed instance had a working API key. The app had exactly two ways to tell
// you, and both cost a full evaluation to consult: a red 401 on a failed run
// meant the key was present and wrong, and a "this is a sample" banner meant it
// was absent. Nothing anywhere said which state you were in until you spent a
// run finding out, and the two failures need opposite fixes.
//
// So this reports the state directly. It reads configuration only — never the
// key itself, and it returns nothing derived from the key's value beyond
// whether one is set. Showing even a prefix would put a fragment of a
// credential onto a page and into any screenshot of it, and a fragment is
// enough to confirm a guess.
import { getAnthropicClient, getFollowupModel, getModel } from "@/lib/anthropic";

/** The variable the app reads. Anything else matching is a near miss. */
const EXPECTED = "ANTHROPIC_API_KEY";

export type AiStatus = {
  /** True when a key is configured and evaluations will call the model. */
  live: boolean;
  /** What a run would use. Shown so a misconfigured override is visible too. */
  baselineModel: string;
  followupModel: string | null;
  /**
   * NAMES — never values — of environment variables that look like they were
   * meant to be the key but are not it.
   *
   * This exists for a failure that is invisible from the dashboard: a variable
   * named with a trailing space, or with a zero-width character picked up by
   * copying the name out of a document, renders identically to the real thing
   * and is a different variable entirely. Reading it back as JSON, with
   * whitespace made visible, is the only way to see it.
   *
   * Names of ANTHROPIC_* variables are not sensitive; their values are, and no
   * value is ever read here.
   */
  nearMissEnvNames: string[];
  /** True when the exact expected name exists but holds nothing usable. */
  expectedNameIsEmpty: boolean;
};

export function getAiStatus(): AiStatus {
  // Anything mentioning Anthropic that is not the exact name the app reads.
  // Compared byte for byte, so "ANTHROPIC_API_KEY " with a trailing space is a
  // near miss rather than a match — which is the entire point.
  const nearMissEnvNames = Object.keys(process.env)
    .filter((name) => /anthropic/i.test(name) && name !== EXPECTED)
    .sort();

  return {
    // Deliberately the same check the evaluation route makes, rather than a
    // second opinion that could disagree with it.
    live: getAnthropicClient() !== null,
    baselineModel: getModel(),
    followupModel: getFollowupModel(),
    nearMissEnvNames,
    expectedNameIsEmpty:
      EXPECTED in process.env && !process.env[EXPECTED]?.trim(),
  };
}
