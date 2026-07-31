// The currently-active evaluation prompt.
//
// v6 defines fitScore — v5 never did, so it degenerated into the headline
// percentile repeated once per school, and a 4.0 student was told they were a
// 58 for a university that admits most qualified applicants. Fit is now the
// student measured against a named selectivity tier, and a low headline with a
// high fit at an accessible school is stated to be the correct answer.
//
// v1-v5 are kept for attribution — evaluations record the version that produced
// them, so results from different prompts stay distinguishable.
//
// To iterate: add v7.ts and change these re-exports.
export { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./v6";
