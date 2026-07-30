// The currently-active evaluation prompt.
//
// v4 anchors scores to defined bands, feeds the previous evaluation back in so
// the number can't drift (or fall when the student adds work), stops treating
// weekly hours as a commitment score, and scores each admissions system
// separately instead of averaging US and UK into one figure.
//
// v1-v3 are kept for attribution — evaluations record the version that
// produced them, so results from different prompts stay distinguishable.
//
// To iterate: add v5.ts and change these re-exports.
export { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./v4";
