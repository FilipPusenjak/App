// The currently-active evaluation prompt.
//
// To iterate on rubric quality: add v2.ts, then change these re-exports. Old
// evaluations keep the promptVersion string that produced them, so results from
// different prompt versions stay distinguishable in the history view.
export {
  SYSTEM_PROMPT,
  buildUserPrompt,
  PROMPT_VERSION,
} from "./v1";
