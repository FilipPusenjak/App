// How long the model may write in the sections that MULTIPLY.
//
// PURE — no imports, so both the prompt (which states these numbers to the
// model) and the validator (which enforces them) read the same constants and
// cannot drift.
//
// A Deep Review's output has two kinds of section. Most appear once per review:
// the summary, strengths, weaknesses, actions, gaps. Two appear once per TARGET
// and once per ITEM: school fits and item assessments. Those are where the
// length goes. A ten-target, eight-item profile — two of which exist on the
// deployment — produces eighteen three-paragraph sections, and visible output
// was measured at 4,700–7,200 tokens per review: four to five thousand words,
// to a fifteen-year-old, at $25 per million tokens of output. Nearly half of
// what a review costs is that prose.
//
// So the multiplying sections get a length, and the once-per-review sections
// do not. The summary is where the model earns its keep; the eighth item
// verdict is not.
//
// TWO NUMBERS, ON PURPOSE. The model is asked for the TARGET; the validator
// rejects only above the CEILING, set at twice that. A review that runs a
// little long is a review, not a failure — the promise this app makes is that
// an evaluation does not fail, and a hard limit at the target would spend a
// second bill on a retry every time the model wrote four sentences and a half.
// Only a response that ignored the instruction outright trips the ceiling and
// reaches the existing retry, which tells it what was wrong.
//
// The ceiling is applied at VALIDATION time, never in the schema handed to the
// API as a grammar. That schema has a size budget of its own
// (tests/unit/structured-output.test.ts) and its behaviour is proven; adding
// constraints to it would change what the API does on every review to enforce
// something the prompt already asks for.

/** Characters the model is asked to keep each multiplying prose field to. */
export const SECTION_TARGET_CHARS = 600;

/** Characters above which a multiplying prose field is rejected. */
export const SECTION_CEILING_CHARS = SECTION_TARGET_CHARS * 2;

/** Key risks the model is asked to list per school fit. */
export const KEY_RISKS_TARGET = 3;

/** Key risks above which a school fit is rejected. */
export const KEY_RISKS_CEILING = 5;

/** Roughly how many sentences the target reads as, for the prompt. */
export const SECTION_TARGET_SENTENCES = 4;

/**
 * The validator's complaint, written for the RETRY NOTE.
 *
 * It is quoted back to the model when a response trips the ceiling, so it
 * says what to do rather than what went wrong: the number to aim for, not the
 * number that was exceeded.
 */
export function tooLongMessage(field: string): string {
  return `${field} is far longer than asked for — keep it to about ${SECTION_TARGET_CHARS} characters (${SECTION_TARGET_SENTENCES} sentences).`;
}
