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

export type AiStatus = {
  /** True when a key is configured and evaluations will call the model. */
  live: boolean;
  /** What a run would use. Shown so a misconfigured override is visible too. */
  baselineModel: string;
  followupModel: string | null;
};

export function getAiStatus(): AiStatus {
  return {
    // Deliberately the same check the evaluation route makes, rather than a
    // second opinion that could disagree with it.
    live: getAnthropicClient() !== null,
    baselineModel: getModel(),
    followupModel: getFollowupModel(),
  };
}
