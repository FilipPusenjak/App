// The length of the sections that multiply — and everything that must NOT
// change to get it.
//
// The saving comes from asking the model for about four sentences in each
// per-target and per-item section. The risks are all in the machinery around
// that request: a ceiling in the wrong schema would stop old reviews rendering,
// a ceiling in the grammar would change what the API does on every call, and a
// prompt that states one number while the validator enforces another would
// reject reviews that did exactly as asked. Each of those is pinned here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  KEY_RISKS_CEILING,
  KEY_RISKS_TARGET,
  SECTION_CEILING_CHARS,
  SECTION_TARGET_CHARS,
  SECTION_TARGET_SENTENCES,
  tooLongMessage,
} from "@/lib/validation/evaluation-limits";
import {
  evaluationOutputSchema,
  evaluationWireSchema,
} from "@/lib/validation/evaluation-wire";
import {
  evaluationResultSchema,
  storedEvaluationResultSchema,
} from "@/lib/validation/evaluation";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/prompts/evaluation";
import { SYSTEM_PROMPT as V11_SYSTEM_PROMPT } from "@/lib/prompts/evaluation/v11";
import { VERSION_HISTORY } from "@/lib/prompts/evaluation/versions";

/** A minimal valid wire-shaped review, so each test can spoil one field. */
function wireResult(over: {
  assessment?: string;
  keyRisks?: string[];
  verdict?: string;
}) {
  return {
    systemScores: [],
    stageOutlook: {
      onTrack: "on_track",
      stageLabel: "Early",
      whatMattersNow: "x",
      assessment: "x",
      reachableNow: [],
      notYetExpected: [],
    },
    schoolFits: [
      {
        schoolName: "Example",
        course: "CS",
        rubricUsed: "us-holistic",
        selectivity: "selective",
        fitScore: 70,
        classification: "match",
        classificationReason: "fine",
        assessment: over.assessment ?? "fine",
        keyRisks: over.keyRisks ?? [],
      },
    ],
    itemAssessments: [
      {
        itemRef: "R1",
        itemTitle: "Club",
        helpfulness: "moderate",
        foundationalValue: "high",
        compoundsInto: "x",
        verdict: over.verdict ?? "fine",
        howToStrengthen: "x",
        bestFor: [],
      },
    ],
    analysis: {
      strengths: [],
      weaknesses: [],
      actions: [],
      gaps: [],
      verifyThese: [],
      proposedCommitments: [],
    },
    overview: {
      headline: "h",
      summary: "s",
      overallScore: 50,
      gradeRelativeScore: 50,
      gradeContext: "g",
      changeSinceLast: "c",
      narrativeCoherence: { score: 50, assessment: "a" },
    },
  };
}

const atTarget = "x".repeat(SECTION_TARGET_CHARS);
const overCeiling = "x".repeat(SECTION_CEILING_CHARS + 1);

describe("the two numbers", () => {
  it("rejects only well above what it asks for", () => {
    // A review that runs a little long is a review, not a failure. The gap
    // between the two is what keeps a four-and-a-half-sentence answer from
    // costing a second bill.
    expect(SECTION_CEILING_CHARS).toBeGreaterThanOrEqual(SECTION_TARGET_CHARS * 2);
    expect(KEY_RISKS_CEILING).toBeGreaterThan(KEY_RISKS_TARGET);
  });

  it("asks for something a person would call a few sentences", () => {
    expect(SECTION_TARGET_SENTENCES).toBeGreaterThanOrEqual(3);
    expect(SECTION_TARGET_SENTENCES).toBeLessThanOrEqual(5);
    // ~150 characters a sentence is ordinary English prose.
    expect(SECTION_TARGET_CHARS / SECTION_TARGET_SENTENCES).toBeGreaterThan(100);
  });
});

describe("what the validator accepts", () => {
  it("accepts a section at the target length", () => {
    const parsed = evaluationOutputSchema.safeParse(
      wireResult({ assessment: atTarget, verdict: atTarget }),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts a section between the target and the ceiling", () => {
    // The whole point of having two numbers.
    const between = "x".repeat(Math.floor((SECTION_TARGET_CHARS + SECTION_CEILING_CHARS) / 2));
    expect(
      evaluationOutputSchema.safeParse(wireResult({ assessment: between })).success,
    ).toBe(true);
  });

  it("rejects a per-target section far above the ceiling", () => {
    const parsed = evaluationOutputSchema.safeParse(
      wireResult({ assessment: overCeiling }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a per-item section far above the ceiling", () => {
    expect(
      evaluationOutputSchema.safeParse(wireResult({ verdict: overCeiling })).success,
    ).toBe(false);
  });

  it("rejects a key-risk list far longer than asked for", () => {
    const many = Array.from({ length: KEY_RISKS_CEILING + 1 }, () => "risk");
    expect(
      evaluationOutputSchema.safeParse(wireResult({ keyRisks: many })).success,
    ).toBe(false);
    const asked = Array.from({ length: KEY_RISKS_TARGET }, () => "risk");
    expect(
      evaluationOutputSchema.safeParse(wireResult({ keyRisks: asked })).success,
    ).toBe(true);
  });

  it("complains in terms the retry can act on", () => {
    // The message is quoted back to the model. It has to say the number to
    // aim for, not merely that a limit was exceeded.
    const parsed = evaluationOutputSchema.safeParse(
      wireResult({ assessment: overCeiling }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((i) => i.message).join(" ");
      expect(messages).toContain(String(SECTION_TARGET_CHARS));
      expect(messages).toContain("assessment");
    }
    expect(tooLongMessage("verdict")).toMatch(/verdict/);
    expect(tooLongMessage("verdict")).toContain(String(SECTION_TARGET_CHARS));
  });
});

describe("what must NOT have changed", () => {
  it("the grammar handed to the API carries no length constraints", () => {
    // Its behaviour on every review to date is proven, and it has a size
    // budget of its own. A ceiling there would also TRUNCATE mid-sentence
    // rather than reject and retry.
    const grammar = JSON.stringify(zodOutputFormat(evaluationWireSchema).schema);
    expect(grammar).not.toMatch(/maxLength/);
    expect(grammar).not.toMatch(/maxItems/);
  });

  it("older, longer reviews still parse as stored rows", () => {
    // storedEvaluationResultSchema extends the base. A ceiling on the base
    // would make every review written before v12 fail to render as
    // "no result was stored". They must read exactly as they always did.
    const longFit = {
      schoolName: "Example",
      course: "CS",
      rubricUsed: "us-holistic",
      selectivity: "selective",
      fitScore: 70,
      classification: "match",
      classificationReason: overCeiling,
      assessment: overCeiling,
      keyRisks: Array.from({ length: KEY_RISKS_CEILING + 4 }, () => overCeiling),
    };
    const stored = {
      systemScores: [],
      stageOutlook: {
        onTrack: "on_track",
        stageLabel: "Early",
        whatMattersNow: "x",
        assessment: "x",
        reachableNow: [],
        notYetExpected: [],
      },
      schoolFits: [longFit],
      itemAssessments: [
        {
          itemRef: "R1",
          itemTitle: "Club",
          helpfulness: "moderate",
          foundationalValue: "high",
          compoundsInto: overCeiling,
          verdict: overCeiling,
          howToStrengthen: overCeiling,
          bestFor: [],
        },
      ],
      strengths: [],
      weaknesses: [],
      actions: [],
      gaps: [],
      verifyThese: [],
      proposedCommitments: [],
      headline: "h",
      summary: "s",
      overallScore: 50,
      gradeRelativeScore: 50,
      gradeContext: "g",
      changeSinceLast: "c",
      narrativeCoherence: { score: 50, assessment: "a" },
    };
    expect(storedEvaluationResultSchema.safeParse(stored).success).toBe(true);
    expect(evaluationResultSchema.safeParse(stored).success).toBe(true);
  });

  it("the route validates with the bounded schema and builds the grammar from the unbounded one", () => {
    const src = readFileSync(
      join(process.cwd(), "app/api/evaluate/route.ts"),
      "utf8",
    );
    expect(src).toMatch(/zodOutputFormat\(evaluationWireSchema\)/);
    const parses = src.match(/parseModelJson\(\s*(\w+),/g) ?? [];
    expect(parses.length).toBeGreaterThanOrEqual(2);
    for (const call of parses) expect(call).toContain("evaluationOutputSchema");
  });
});

describe("the prompt says the same numbers the validator uses", () => {
  it("is v12, and v12 is the newest registered version", () => {
    expect(PROMPT_VERSION).toBe("evaluation/v12");
    expect(VERSION_HISTORY[VERSION_HISTORY.length - 1]?.version).toBe("evaluation/v12");
  });

  it("redefines no score, so no boundary is drawn on anybody's chart", () => {
    const v12 = VERSION_HISTORY.find((v) => v.version === "evaluation/v12");
    expect(v12?.redefined).toEqual([]);
  });

  it("states the target length and the risk count from the constants", () => {
    // No second copy of the number that could drift from what is enforced.
    expect(SYSTEM_PROMPT).toContain(`about ${SECTION_TARGET_CHARS} characters`);
    expect(SYSTEM_PROMPT).toContain(`at most ${KEY_RISKS_TARGET}`);
    expect(SYSTEM_PROMPT).toContain(`${SECTION_TARGET_SENTENCES} sentences`);
  });

  it("names exactly the fields the validator bounds", () => {
    for (const field of [
      "assessment",
      "classificationReason",
      "compoundsInto",
      "verdict",
      "howToStrengthen",
      "keyRisks",
    ]) {
      expect(SYSTEM_PROMPT).toContain(field);
    }
  });

  it("leaves the once-per-review sections explicitly unbounded", () => {
    expect(SYSTEM_PROMPT).toMatch(/summary, strengths, weaknesses,\s+actions, gaps[\s\S]*unchanged/);
  });

  it("is v11 plus an addition, nothing removed", () => {
    expect(SYSTEM_PROMPT.startsWith(V11_SYSTEM_PROMPT)).toBe(true);
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(V11_SYSTEM_PROMPT.length);
  });
});
