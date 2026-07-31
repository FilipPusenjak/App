// The 400 that took every evaluation down at once:
//
//   {"type":"error","error":{"type":"invalid_request_error","message":"The
//   compiled grammar is too large, which would cause performance issues.
//   Simplify your tool schemas or reduce the number of strict tools."}}
//
// It is a request-time rejection of the SCHEMA, not of the profile, so it fails
// identically for every user on every run until the schema shrinks. Two things
// are tested here: that the schema is now small enough that it should not
// recur, and that if it recurs anyway the route drops the grammar instead of
// failing.
import { describe, expect, it } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  extractJsonObject,
  isGrammarTooLargeError,
  renderSchemaInstructions,
} from "@/lib/structured-output";
import { evaluationResultSchema } from "@/lib/validation/evaluation";
import {
  evaluationWireSchema,
  fromWireResult,
} from "@/lib/validation/evaluation-wire";
import { projectionResultSchema } from "@/lib/validation/projection";

/** The API's own error, verbatim, wrapped the way the SDK wraps it. */
function grammarError() {
  return Object.assign(
    new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools."},"request_id":"req_011CdZ9qcX13ygF2zk2XhzJ9"}',
    ),
    { status: 400 },
  );
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

/**
 * Rough cost of compiling a schema into a decoding grammar.
 *
 * An object whose properties may be emitted in any order needs a state per
 * subset of properties already seen, so each object costs about 2^n. This is an
 * estimate — the real limit is not published — but it captures the thing that
 * actually blew up: sibling count, not byte count.
 */
function grammarCost(schema: JsonSchema): number {
  if (!schema || typeof schema !== "object") return 0;
  let total = 0;
  if (schema.properties) {
    const keys = Object.keys(schema.properties);
    total += 2 ** keys.length;
    for (const key of keys) total += grammarCost(schema.properties[key]!);
  }
  if (schema.items) total += grammarCost(schema.items);
  return total;
}

function schemaOf(schema: unknown): JsonSchema {
  return (zodOutputFormat(schema as never) as { schema: JsonSchema }).schema;
}

describe("the schema actually sent to the model is small enough to compile", () => {
  it("keeps sibling properties well below the count that was rejected", () => {
    const flat = Object.keys(schemaOf(evaluationResultSchema).properties!);
    const wire = Object.keys(schemaOf(evaluationWireSchema).properties!);

    // 16 top-level properties is what tripped the limit.
    expect(flat.length).toBe(16);
    expect(wire.length).toBeLessThanOrEqual(10);
  });

  it("cuts the estimated grammar by more than an order of magnitude", () => {
    const before = grammarCost(schemaOf(evaluationResultSchema));
    const after = grammarCost(schemaOf(evaluationWireSchema));
    expect(after).toBeLessThan(before / 10);
    // Under the projection schema's neighbourhood, which has never been
    // rejected — a concrete ceiling rather than a relative improvement.
    expect(after).toBeLessThan(10_000);
  });

  it("guards the projection schema against the same growth", () => {
    expect(grammarCost(schemaOf(projectionResultSchema))).toBeLessThan(10_000);
  });

  it("nests rather than drops — no field was lost to make it fit", () => {
    const flat = Object.keys(schemaOf(evaluationResultSchema).properties!);
    const wireSchema = schemaOf(evaluationWireSchema);
    const wire = [
      ...Object.keys(wireSchema.properties!).filter((k) => k !== "overview"),
      ...Object.keys(wireSchema.properties!.overview!.properties!),
    ];
    expect(wire.sort()).toEqual(flat.sort());
  });
});

describe("the wire envelope round-trips to the stored shape", () => {
  const wire = {
    stageOutlook: {
      stageLabel: "Early — Grade 9-10",
      whatMattersNow: "Foundations.",
      onTrack: "on_track",
      assessment: "Real, early.",
      reachableNow: ["Sustained volunteering"],
      notYetExpected: ["Admissions test scores"],
    },
    systemScores: [
      {
        rubricId: "us-holistic",
        systemLabel: "United States — holistic review",
        readinessScore: 48,
        gradeRelativeScore: 74,
        assessment: "Breadth counts here.",
      },
    ],
    strengths: [{ title: "Sport", detail: "Six years.", relevantTo: ["all"] }],
    weaknesses: [
      { title: "No field evidence", detail: "Nothing yet.", severity: "significant" },
    ],
    schoolFits: [
      {
        schoolName: "MIT",
        country: "United States",
        course: "Computer Science",
        rubricUsed: "us-holistic",
        selectivity: "extremely_selective",
        fitScore: 30,
        classification: "reach",
        classificationReason: "Selective for any profile.",
        assessment: "Honest fit text.",
        keyRisks: ["No spike yet."],
      },
    ],
    itemAssessments: [
      {
        itemRef: "R1",
        itemTitle: "Climbing",
        helpfulness: "moderate",
        foundationalValue: "high",
        compoundsInto: "A coaching role.",
        verdict: "Real commitment.",
        howToStrengthen: "Compete or coach.",
        bestFor: ["MIT"],
      },
    ],
    actions: [
      {
        title: "Enter a CS competition",
        detail: "Biggest gap.",
        effort: "medium",
        impact: "high",
        timeframe: "this term",
        appliesTo: ["all"],
      },
    ],
    gaps: [
      { title: "No field evidence", detail: "None.", timing: "now", appliesTo: ["all"] },
    ],
    verifyThese: ["Check the course pages."],
    overview: {
      headline: "Solid foundation.",
      summary: "A short honest paragraph.",
      overallScore: 42,
      gradeRelativeScore: 71,
      gradeContext: "Strong for the year, early for the targets.",
      changeSinceLast: "First evaluation.",
      narrativeCoherence: { score: 55, assessment: "Coherent but early." },
    },
  };

  it("accepts the model's grouped output", () => {
    expect(evaluationWireSchema.safeParse(wire).success).toBe(true);
  });

  it("flattens into exactly what the database and UI already expect", () => {
    const parsed = evaluationWireSchema.parse(wire);
    const result = fromWireResult(parsed);

    // The strict stored contract, unchanged by any of this.
    expect(evaluationResultSchema.safeParse(result).success).toBe(true);
    expect(result.overallScore).toBe(42);
    expect(result.gradeRelativeScore).toBe(71);
    expect(result.narrativeCoherence.score).toBe(55);
    expect(result.stageOutlook.onTrack).toBe("on_track");
    expect("overview" in result).toBe(false);
  });

  it("still rejects output missing a required field", () => {
    const bad = { ...wire, overview: { ...wire.overview } } as Record<string, unknown>;
    delete (bad.overview as Record<string, unknown>).overallScore;
    expect(evaluationWireSchema.safeParse(bad).success).toBe(false);
  });

  it("still rejects the old flat shape, so a half-applied change fails loudly", () => {
    const flat = fromWireResult(evaluationWireSchema.parse(wire));
    expect(evaluationWireSchema.safeParse(flat).success).toBe(false);
  });
});

describe("recognizing the API's rejection of the schema", () => {
  it("matches the exact error that was reported", () => {
    expect(isGrammarTooLargeError(grammarError())).toBe(true);
  });

  it("matches it when the SDK nests the API body instead of stringifying it", () => {
    expect(
      isGrammarTooLargeError({
        status: 400,
        error: { error: { message: "The compiled grammar is too large" } },
      }),
    ).toBe(true);
  });

  it("survives a reworded message about the same limit", () => {
    expect(
      isGrammarTooLargeError({
        status: 400,
        message: "Your output schema is too complex to compile.",
      }),
    ).toBe(true);
  });

  it("does NOT swallow other bad requests", () => {
    // The fallback drops a correctness guarantee, so it must not fire for
    // anything except the schema being refused.
    expect(
      isGrammarTooLargeError(
        Object.assign(new Error("400 max_tokens: must be <= 32000"), { status: 400 }),
      ),
    ).toBe(false);
    expect(
      isGrammarTooLargeError(
        Object.assign(new Error("credit balance is too low"), { status: 400 }),
      ),
    ).toBe(false);
  });

  it("does not fire on rate limits, auth failures or server errors", () => {
    for (const status of [401, 429, 500, 529]) {
      expect(
        isGrammarTooLargeError(
          Object.assign(new Error("grammar is too large"), { status }),
        ),
      ).toBe(false);
    }
  });

  it("handles errors with nothing useful on them", () => {
    expect(isGrammarTooLargeError(null)).toBe(false);
    expect(isGrammarTooLargeError(undefined)).toBe(false);
    expect(isGrammarTooLargeError(new Error(""))).toBe(false);
    expect(isGrammarTooLargeError({})).toBe(false);
  });
});

describe("the fallback asks for the same shape in words", () => {
  const instructions = renderSchemaInstructions(schemaOf(evaluationWireSchema));

  it("carries the full schema, so nothing is left to guess", () => {
    expect(instructions).toContain("overview");
    expect(instructions).toContain("stageOutlook");
    expect(instructions).toContain("foundationalValue");
    expect(instructions).toContain("changeSinceLast");
  });

  it("spells out the constraints the grammar would have enforced", () => {
    expect(instructions).toMatch(/SINGLE JSON object and nothing else/);
    expect(instructions).toMatch(/no markdown code fences/i);
    expect(instructions).toMatch(/every property listed in "required" must be present/);
    expect(instructions).toMatch(/exactly one of those strings/);
  });
});

describe("reading JSON back out of a response", () => {
  it("passes bare JSON through untouched", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("unwraps a code fence the model was told not to add", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("drops a line of preamble", () => {
    expect(extractJsonObject('Here is the evaluation:\n{"a":1}')).toBe('{"a":1}');
  });

  it("keeps nested braces intact", () => {
    const json = '{"a":{"b":[1,2]},"c":"}"}';
    expect(JSON.parse(extractJsonObject(json)!)).toEqual(JSON.parse(json));
  });

  it("returns null when there is no object at all, rather than guessing", () => {
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject("   ")).toBeNull();
    expect(extractJsonObject("I cannot help with that.")).toBeNull();
    expect(extractJsonObject("}{")).toBeNull();
  });
});
