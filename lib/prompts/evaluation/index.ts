// The currently-active evaluation prompt.
//
// v7 fixes gradeRelativeScore: its comparison pool was underspecified, the page
// described a different one, and it was absorbing a stage penalty that every
// student in the year is subject to equally. It also forbids the prose and the
// number from contradicting each other — "best possible foundation" beside a
// mid-range percentile is what prompted the fix.
//
// v1-v6 are kept for attribution — evaluations record the version that produced
// them, so results from different prompts stay distinguishable.
//
// To iterate: add v8.ts and change these re-exports.
export { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./v7";
