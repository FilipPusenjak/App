// The currently-active evaluation prompt.
//
// v10 carries unchanged items' assessments forward instead of paying to have
// them re-judged, and reconciles "assess EVERY item" with that. It changes no
// score definition, so no anchor is released.
//
// v1-v9 are kept for attribution — evaluations record the version that produced
// them, so results from different prompts stay distinguishable.
//
// To iterate: add v11.ts and change these re-exports. Remember that a change to
// what a SCORE MEANS only takes effect for existing users if the version
// changes with it.
export {
  SYSTEM_PROMPT,
  buildUserPrompt,
  buildUserPromptParts,
  PROMPT_VERSION,
} from "./v10";
