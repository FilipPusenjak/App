// The currently-active evaluation prompt.
//
// v8 gives gradeRelativeScore concrete bands, and — just as importantly —
// changes the version string. The previous-evaluation anchor is only released
// when the recorded version differs from the running one, so v7's redefinition
// could never reach a student who already had a v7 score. Bumping is what
// forces the one clean re-derivation.
//
// v1-v7 are kept for attribution — evaluations record the version that produced
// them, so results from different prompts stay distinguishable.
//
// To iterate: add v9.ts and change these re-exports. Remember that a change to
// what a SCORE MEANS only takes effect for existing users if the version
// changes with it.
export { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./v8";
