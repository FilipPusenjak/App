// The exact strings the tier schemas accept, stated to the model.
//
// This exists because of a failure that cost real money and was invisible until
// it happened. The structured-output format sent to the API carries the shape —
// which keys, which types, which are required — but every ENUM and every length
// limit survives only as a description string. The API does not enforce them.
// Zod does, after the response has been paid for.
//
// So a model that returns `"currentRung": "Doing real work in it"` — the human
// label the context prints beside the enum value — produces a well-formed,
// fully-billed response that is then discarded whole. The first real check-in
// failed on shape, and nothing in either prompt had ever told the model what the
// permitted values were.
//
// Shared by both tiers so the two cannot drift, and generated from the same
// constants the validator uses so this file cannot state a value the schema
// rejects.
import { RUNGS } from "@/lib/readiness/rungs";

const list = (values: readonly string[]) => values.map((v) => `"${v}"`).join(" | ");

/**
 * Appended to every tier system prompt.
 *
 * Written as hard constraints rather than guidance: each line is a rule whose
 * violation discards the entire response, and the model has no way to discover
 * that from the schema it was given.
 */
export const OUTPUT_VOCABULARY = `## Exact output values — these are checked after you answer

Your response is validated against a strict schema AFTER it is generated. A
single wrong value discards the whole response — not the field, the response.
The permitted values are NOT enforced by the output format you were given, so
they are listed here and nowhere else.

**Use these strings exactly.** Lowercase where shown lowercase, uppercase where
shown uppercase. Never substitute a human-readable label, even when the context
below prints one beside the value.

- Rungs (\`currentRung\`, \`targetRung\`, \`targetRung\` on a commitment):
  ${list(RUNGS)}
  The context prints these as \`contributor (Doing real work in it)\`. The value
  is \`contributor\`. The parenthetical is a gloss for you, never an output.
- Check-in \`movement.direction\`: ${list(["UP", "FLAT", "DOWN"])}
- Deep review \`trajectory.direction\`: ${list(["STEEPENING", "STEADY", "FLATTENING"])}
- \`selectivity\`: ${list(["open", "accessible", "selective", "highly_selective", "extremely_selective"])}
- \`classification\`: ${list(["reach", "match", "safety"])}
- \`helpfulness\`: ${list(["high", "moderate", "low", "negligible"])}
- \`foundationalValue\`: ${list(["high", "moderate", "low", "none"])}
- \`feasibility\`: ${list(["FEASIBLE", "TIGHT", "TOO_LATE"])}

**Ids are copied, never invented.** \`activityId\` and \`commitmentId\` must be
the bracketed id exactly as the context prints it — \`[cm_abc123]\` means the
value is \`cm_abc123\`. If you cannot find the id for something, omit that entry
rather than describing it in the id field.

**Length limits are real and are checked.** Going over discards the response:

- a headline: 300 characters
- one action, one concrete step, one gap detail, one risk: 400 characters
- an assessment: 1500 characters

**Nullable means null, not empty.** Where a field may be null, write \`null\` —
not \`""\`, not \`"none"\`, not \`"N/A"\`. Where a list may be empty, write \`[]\`.`;
