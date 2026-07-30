// The currently-active evaluation prompt.
//
// v5 makes both scores percentiles ("90 = stronger than about 90% of the pool")
// and makes stage a first-class concept: the rubrics carry a stage ladder, gaps
// carry timing, and items are judged both for what they are worth today and for
// what they are worth to build on.
//
// v1-v4 are kept for attribution — evaluations record the version that produced
// them, so results from different prompts stay distinguishable.
//
// To iterate: add v6.ts and change these re-exports.
export { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./v5";
