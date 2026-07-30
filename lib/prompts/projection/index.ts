// The currently-active projection prompt.
//
// v3 adds the stage model (judge plans by what they compound into, never fault
// a student for gaps that are gated at their stage) and makes readiness a
// percentile, matching the evaluation.
//
// v1 and v2 are kept for attribution — projections record the version that
// produced them. To iterate: add v4.ts and change these re-exports.
export { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./v3";
