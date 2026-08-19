// The currently-active evaluation prompt.
//
// v11 asks for proposed commitments, which the retired Deep Review tier used to
// produce and nothing else did. It changes no score definition, so no anchor is
// released.
//
// v1-v10 are kept for attribution — evaluations record the version that produced
// them, so results from different prompts stay distinguishable.
//
// To iterate: add v12.ts and change these re-exports. Remember that a change to
// what a SCORE MEANS only takes effect for existing users if the version
// changes with it.
export {
  SYSTEM_PROMPT,
  buildUserPrompt,
  buildUserPromptParts,
  PROMPT_VERSION,
} from "./v11";
