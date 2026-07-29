// The currently-active evaluation prompt.
//
// v3 adds a stage-relative score alongside the target-readiness score, corrects
// an over-weighting toward the intended field, has the model classify each
// target itself, and uses school context when judging GPA.
//
// v1 and v2 are kept for attribution — evaluations record the version that
// produced them, so results from different prompts stay distinguishable.
//
// To iterate: add v4.ts and change these re-exports.
export { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./v3";
