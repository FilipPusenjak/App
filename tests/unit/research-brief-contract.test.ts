// The brief and the validator have to describe the same thing.
//
// They are two halves of one contract written in two languages: the brief is
// prose a researcher reads, the validator is code that decides what survives.
// Nothing checked they agreed, and the cost of disagreement is not a bug report
// — it is a batch of real research rejected after the work is done, or worse,
// accepted into a shape that never matches a student.
//
// So this file reads the brief itself rather than restating it. A rule changed
// in one and not the other fails here, before an agent spends a day acting on
// the older half.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateRecord } from "@/lib/validation/course-requirements";
import { COUNTRIES } from "@/lib/data/countries";

const BRIEF = readFileSync(
  "lib/prompts/research/course-requirements-v3.md",
  "utf8",
);

/**
 * The example record the brief prints, lifted from the brief itself.
 *
 * Not a copy typed into this file — extracted, so it cannot drift. If the brief
 * shows a researcher something the validator refuses, that is the single most
 * expensive disagreement available: every record in the batch follows the
 * example.
 */
function briefExample(): unknown {
  const start = BRIEF.indexOf("```json");
  const end = BRIEF.indexOf("```", start + 7);
  expect(start, "the brief no longer contains a JSON example").toBeGreaterThan(-1);
  return JSON.parse(BRIEF.slice(start + 7, end));
}

describe("the brief's own example survives the validator", () => {
  it("parses as JSON at all", () => {
    // A malformed example in the brief teaches every researcher to emit
    // malformed records.
    expect(() => briefExample()).not.toThrow();
  });

  it("is accepted, exactly as printed", () => {
    const outcome = validateRecord(briefExample());
    if (!outcome.ok) {
      throw new Error(
        `The brief shows researchers a record this validator rejects:\n  ${outcome.errors.join("\n  ")}`,
      );
    }
    expect(outcome.ok).toBe(true);
  });

  it("needs no country correction — the example uses the right code", () => {
    const outcome = validateRecord(briefExample());
    expect(outcome.ok && outcome.correctedCountryFrom).toBeNull();
  });
});

describe("the brief's country list is the app's country list", () => {
  /** The fenced code block under the country rule, parsed back to codes. */
  function briefCountryCodes(): string[] {
    const heading = BRIEF.indexOf("`country` must be one of these exact codes");
    const start = BRIEF.indexOf("```", heading);
    const end = BRIEF.indexOf("```", start + 3);
    return BRIEF.slice(start + 3, end).split(/\s+/).filter(Boolean);
  }

  it("lists every code the app accepts, and nothing it does not", () => {
    // Drift in either direction is a silent failure. A code in the brief that
    // the app rejects loses good research; a code the app accepts that the
    // brief omits means a country nobody was told they could research.
    const brief = [...briefCountryCodes()].sort();
    const app = COUNTRIES.map((c) => c.code).sort();
    expect(brief).toEqual(app);
  });

  it("still warns that UK is not one of them", () => {
    // The single most damaging mistake available to a researcher, per the
    // brief. The validator now corrects it, but the brief must keep saying so —
    // a correction that fires on every record is a researcher who never learned.
    expect(BRIEF).toMatch(/`UK` is not on it/);
  });
});

describe("what the brief promises about rejection is true", () => {
  it("a record with every requirement null is rejected, as the brief says", () => {
    expect(BRIEF).toMatch(/A record where every field is null is rejected/);

    const example = briefExample() as Record<string, unknown>;
    const emptied = {
      ...example,
      requirements: Object.fromEntries(
        Object.keys(example.requirements as object).map((k) => [k, null]),
      ),
      acceptanceRate: undefined,
    };
    expect(validateRecord(emptied).ok).toBe(false);
  });

  it("a record keeps its place when only the acceptance rate is malformed", () => {
    // The brief promises acceptanceRate "can never cost you a record". That is
    // a promise about this validator, so it is checked here.
    expect(BRIEF).toMatch(/it can never cost you a record/i);

    const example = briefExample() as Record<string, unknown>;
    const outcome = validateRecord({
      ...example,
      acceptanceRate: { percent: 900, scope: "", quote: "", sourceUrl: "nope" },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.droppedAcceptanceRate).toBe(true);
  });
});
