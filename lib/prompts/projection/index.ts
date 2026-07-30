// The currently-active projection prompt.
//
// To iterate: add v2.ts and change these re-exports. Projections record the
// version that produced them, same as evaluations.
export { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./v1";
