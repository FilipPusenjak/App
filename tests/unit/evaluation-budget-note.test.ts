// budgetNote — telling the model its own output ceiling, so a large profile
// gets a response that fits rather than one that hits max_tokens mid-object.
//
// Written against a real production failure: a profile assembled a
// 13,515-token prompt, left about 5,167 tokens of allowance, and the model
// wrote until it hit that ceiling — a response that parsed as nothing, on a
// run that still cost the student their credit (spent before the call, not
// after). This is the fix: tell the model the number before it starts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { budgetNote } from "@/lib/prompts/evaluation";

const ROOT = process.cwd();

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("budgetNote", () => {
  it("states the exact allowance, in tokens and in words", () => {
    const note = budgetNote(5167);
    expect(note).toContain("5,167");
    // 0.75 words/token, rounded — a coarser number closer to how the model
    // actually paces prose, not a promise the app is holding it to precisely.
    expect(note).toContain("3,875");
  });

  it("is a pure function of the allowance", () => {
    expect(budgetNote(1234)).toBe(budgetNote(1234));
    expect(budgetNote(1234)).not.toBe(budgetNote(4321));
  });

  it("tells the model there is no retry, so it should not gamble on going long", () => {
    expect(budgetNote(5000)).toMatch(/no retry/i);
  });
});

describe("the evaluate route reserves room for its own budget note", () => {
  const src = code(join(ROOT, "app", "api", "evaluate", "route.ts"));

  it("counts the note's own size before computing the allowance", () => {
    // If the reservation were dropped, the note appended later would be pure
    // upside for the model and quiet overspend for the ceiling — exactly the
    // "holds by arithmetic, not by accident" property this file is written to
    // protect everywhere else.
    const promptTokensBlock = src.slice(
      src.indexOf("const promptTokens = estimateInputTokens("),
      src.indexOf("const firstAllowance ="),
    );
    expect(promptTokensBlock).toMatch(/budgetNote\(/);
  });

  it("rebuilds the note from each attempt's own allowance, not a fixed one", () => {
    // A retry gets a SMALLER allowance than the first attempt (see
    // remainingBudget) — the note must be recomputed inside the attempt
    // closure from its own `allowance` parameter, or a retry would be handed
    // a stale, too-generous number and the whole guarantee would be theater.
    const attemptBlock = src.slice(
      src.indexOf("const attempt = async"),
      src.indexOf("const outcome = await requestEvaluation"),
    );
    expect(attemptBlock).toMatch(/budgetNote\(allowance\)/);
  });
});
