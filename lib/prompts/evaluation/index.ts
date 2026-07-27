// The currently-active evaluation prompt.
//
// v2 adds per-item assessments and the prioritized action list. v1 is kept for
// reference and attribution — evaluations it produced record "evaluation/v1",
// so results from different prompt versions stay distinguishable in history.
//
// To iterate: add v3.ts and change these re-exports.
export {
  SYSTEM_PROMPT,
  buildUserPrompt,
  PROMPT_VERSION,
} from "./v2";
