// The currently-active evaluation prompt.
//
// v9 makes the gradeRelativeScore bands stage-relative. They described
// accumulated evidence — "years-long commitments" — which a student three
// months into secondary school cannot have, so the upper bands were
// unreachable for reasons unrelated to the student, in a pool where every
// member has had the same number of months.
//
// v1-v8 are kept for attribution — evaluations record the version that produced
// them, so results from different prompts stay distinguishable.
//
// To iterate: add v10.ts and change these re-exports. Remember that a change to
// what a SCORE MEANS only takes effect for existing users if the version
// changes with it.
export { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./v9";
