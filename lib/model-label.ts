// A model id, as a person would say it.
//
// Exists so a page can name the model that ACTUALLY produced a row rather than
// asserting one in copy. The evaluation page used to say "All evaluations are
// run on Claude Opus 5" as a fixed sentence, and it stopped being true the day
// follow-ups routed to Sonnet — then again when the default moved to Opus 5.5,
// for every row written before that. A label read from the row cannot drift.

const LABELS: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-opus-5": "Claude Opus 5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
};

/**
 * The display name for a model id, or the id itself when it is not one this
 * table knows. The raw id is the honest fallback: it is still exactly which
 * model ran, just less readable, where a guessed name could be wrong.
 */
export function modelLabel(model: string): string {
  return LABELS[model] ?? model;
}
