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
} from "@/lib/prompts/tiers/check-in-v3";
import {
  PROMPT_VERSION as EVALUATION_PROMPT_VERSION,
  SYSTEM_PROMPT as EVALUATION_SYSTEM_PROMPT,
} from "@/lib/prompts/evaluation";
import { RUNGS } from "@/lib/readiness/rungs";
import { FEASIBILITY } from "@/lib/readiness/pace";

/** Every enum the tier schemas actually validate against. */
const ENUMS: Record<string, readonly string[]> = {
  rungs: RUNGS,
  feasibility: FEASIBILITY,
  checkInDirection: ["UP", "FLAT", "DOWN"],
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

describe("the check-in prompt carries it", () => {
  it("does", () => {
    expect(CHECK_IN_SYSTEM_PROMPT).toContain(OUTPUT_VOCABULARY);
  });

  it("was version-bumped, so old rows stay pinned to what produced them", () => {
    // An evaluation is immutable and pinned to its prompt version. Editing a
    // prompt without bumping would silently relabel history as having been
    // produced by instructions it never saw.
    expect(CHECK_IN_PROMPT_VERSION).toBe("check-in/v3");
  });

  it("keeps the prefix the stored-shape reader dispatches on", () => {
    // readStoredEvaluation switches on these prefixes. A rename would make
    // every row written under it unreadable.
    expect(CHECK_IN_PROMPT_VERSION.startsWith("check-in/")).toBe(true);
  });
});

// The evaluation prompt does NOT carry the shared vocabulary block — it states
// its own contract. That is fine for everything it has always emitted, and NOT
// fine by default for the one enum it gained when commitments moved onto it.
describe("the evaluation prompt states the enum it gained with commitments", () => {
  it("lists every rung, because it now emits targetRung", () => {
    // The exact shape of the failure that cost a real check-in: an enum the
    // prompt never mentions is an enum the model guesses at, and the guess is
    // only caught by Zod after the whole response has been billed. A Deep
    // Review is the most expensive run in the app to lose this way.
    for (const rung of RUNGS) {
      expect(
        EVALUATION_SYSTEM_PROMPT.includes(`"${rung}"`),
        `rung "${rung}" is not stated in the evaluation prompt, so a model ` +
          `writing a commitment has no way to know it is permitted.`,
      ).toBe(true);
    }
  });

  it("says null means null for a commitment with no single activity", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/`null` means `null`/);
  });

  it("warns that a wrong value discards the whole response, not the field", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/discards your entire\s+response/);
  });

  it("was version-bumped for the added field", () => {
    expect(EVALUATION_PROMPT_VERSION).toBe("evaluation/v11");
    expect(EVALUATION_PROMPT_VERSION.startsWith("evaluation/")).toBe(true);
  });

  it("tells the model the commitments are proposals, never agreed to", () => {
    // The rule the whole accept/decline loop rests on. A prompt that phrases
    // them as instructions would have the app putting words in a teenager's
    // mouth about work they never said yes to.
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/propose, never assume/i);
  });

  it("distinguishes a commitment from an action, or the loop tracks advice", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/NOT a restatement of/i);
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
