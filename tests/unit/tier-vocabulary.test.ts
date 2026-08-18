// The prompts must state every value the schema accepts, and no others.
//
// This is the gap that cost a real check-in. The structured-output format sent
// to the API carries the SHAPE — keys, types, what is required — but every enum
// and every length limit survives only inside a description string. The API
// does not enforce them; Zod does, after the response is generated and billed.
//
// So an enum the prompt never mentions is an enum the model guesses at, and a
// wrong guess discards the entire response. Two ways that goes wrong, both
// tested here:
//
//   - the prompt OMITS a permitted value, so the model never knows it may use
//     it and reaches for a synonym the validator refuses;
//   - the prompt STATES a value the schema does not accept, which is worse,
//     because the model is being actively instructed to fail.
import { describe, expect, it } from "vitest";
import { OUTPUT_VOCABULARY } from "@/lib/prompts/tiers/vocabulary";
import {
  CHECK_IN_PROMPT_VERSION,
  CHECK_IN_SYSTEM_PROMPT,
} from "@/lib/prompts/tiers/check-in-v2";
import {
  DEEP_REVIEW_PROMPT_VERSION,
  DEEP_REVIEW_SYSTEM_PROMPT,
} from "@/lib/prompts/tiers/deep-review-v2";
import { RUNGS } from "@/lib/readiness/rungs";
import { FEASIBILITY } from "@/lib/readiness/pace";

/** Every enum the tier schemas actually validate against. */
const ENUMS: Record<string, readonly string[]> = {
  rungs: RUNGS,
  feasibility: FEASIBILITY,
  checkInDirection: ["UP", "FLAT", "DOWN"],
  trajectoryDirection: ["STEEPENING", "STEADY", "FLATTENING"],
  selectivity: [
    "open",
    "accessible",
    "selective",
    "highly_selective",
    "extremely_selective",
  ],
  classification: ["reach", "match", "safety"],
  helpfulness: ["high", "moderate", "low", "negligible"],
  foundationalValue: ["high", "moderate", "low", "none"],
};

describe("the vocabulary block states every value the schemas accept", () => {
  for (const [name, values] of Object.entries(ENUMS)) {
    it(`lists every ${name} value`, () => {
      for (const value of values) {
        expect(
          OUTPUT_VOCABULARY.includes(`"${value}"`),
          `${name} value "${value}" is not stated in the prompt vocabulary, so ` +
            `a model has no way to know it is permitted — and the API does not ` +
            `enforce the enum, so the guess is only caught after it is billed.`,
        ).toBe(true);
      }
    });
  }

  it("is generated from the same constant the validator uses", () => {
    // Not a copy: RUNGS has seven values and the block is built from the array,
    // so a rung added to the ladder cannot leave the prompt behind.
    expect(RUNGS.length).toBeGreaterThan(0);
    for (const rung of RUNGS) expect(OUTPUT_VOCABULARY).toContain(`"${rung}"`);
  });

  it("tells the model to copy ids rather than invent them", () => {
    expect(OUTPUT_VOCABULARY).toMatch(/copied, never invented/i);
  });

  it("distinguishes the enum value from the human label printed beside it", () => {
    // The check-in context prints `contributor (Doing real work in it)`. Emitting
    // the gloss is the single most plausible way to fail this schema.
    expect(OUTPUT_VOCABULARY).toMatch(/never substitute a human-readable label/i);
  });

  it("says null means null, not an empty string", () => {
    expect(OUTPUT_VOCABULARY).toMatch(/Nullable means null/i);
  });
});

describe("both tier prompts carry it", () => {
  it("the check-in prompt does", () => {
    expect(CHECK_IN_SYSTEM_PROMPT).toContain(OUTPUT_VOCABULARY);
  });

  it("the deep review prompt does", () => {
    expect(DEEP_REVIEW_SYSTEM_PROMPT).toContain(OUTPUT_VOCABULARY);
  });

  it("both were version-bumped, so old rows stay pinned to what produced them", () => {
    // An evaluation is immutable and pinned to its prompt version. Editing a
    // prompt without bumping would silently relabel history as having been
    // produced by instructions it never saw.
    expect(CHECK_IN_PROMPT_VERSION).toBe("check-in/v2");
    expect(DEEP_REVIEW_PROMPT_VERSION).toBe("deep-review/v2");
  });

  it("keeps the prefixes the stored-shape reader dispatches on", () => {
    // readStoredEvaluation switches on these prefixes. A rename would make
    // every row written under it unreadable.
    expect(CHECK_IN_PROMPT_VERSION.startsWith("check-in/")).toBe(true);
    expect(DEEP_REVIEW_PROMPT_VERSION.startsWith("deep-review/")).toBe(true);
  });
});

describe("the check-in prompt no longer contradicts its own schema", () => {
  it("asks for the rung categories AND the concrete step", () => {
    // v1 said "the next rung is a concrete step, not a category", which reads as
    // permission to omit currentRung and targetRung — both of which the schema
    // requires whenever nextRung is present.
    expect(CHECK_IN_SYSTEM_PROMPT).toMatch(/BOTH the categories and the step/i);
    expect(CHECK_IN_SYSTEM_PROMPT).toContain("currentRung");
    expect(CHECK_IN_SYSTEM_PROMPT).toContain("targetRung");
  });

  it("still insists on exactly one action", () => {
    // The reason the tier exists. Adding schema detail must not have buried it.
    expect(CHECK_IN_SYSTEM_PROMPT).toMatch(/exactly one action/i);
  });
});
