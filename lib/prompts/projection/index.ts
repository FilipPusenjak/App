// The currently-active projection prompt.
//
// v2 defines score bands, feeds the previous projection back in so repeat runs
// on the same plans stay stable, stops the model inventing a baseline when the
// evaluation recorded one, and forbids rubric ids leaking into student-facing
// fields.
//
// v1 is kept for attribution — projections record the version that produced
// them. To iterate: add v3.ts and change these re-exports.
export { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./v2";
