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
  isStructuredOutputParseError,
  parseModelJson,
  renderRetryNote,
  renderSchemaInstructions,
  repairTruncatedJson,
  responseExcerpt,
  type ModelAttempt,
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
    expect(wire.length).toBeLessThanOrEqual(6);
  });

  it("cuts the estimated grammar by more than an order of magnitude", () => {
    const before = grammarCost(schemaOf(evaluationResultSchema));
    const after = grammarCost(schemaOf(evaluationWireSchema));
    expect(after).toBeLessThan(before / 10);
    // Under the projection schema's neighbourhood, which has never been
    // rejected — a concrete ceiling rather than a relative improvement.
    expect(after).toBeLessThan(10_000);
  });

  it("keeps real headroom under the largest size known to have worked", () => {
    // ~2,100 is the size of the schema that produced a real evaluation before
    // v6 added a field. Being merely smaller than the size that FAILED is not
    // a margin; this pins it to comfortably under what actually succeeded, so
    // the next field added does not silently re-cross the limit.
    expect(grammarCost(schemaOf(evaluationWireSchema))).toBeLessThan(1_600);
  });

  it("guards the projection schema against the same growth", () => {
    expect(grammarCost(schemaOf(projectionResultSchema))).toBeLessThan(10_000);
  });

  it("nests rather than drops — no field was lost to make it fit", () => {
    const flat = Object.keys(schemaOf(evaluationResultSchema).properties!);
    const wireSchema = schemaOf(evaluationWireSchema);
    const GROUPS = ["overview", "analysis"];
    const wire = [
      ...Object.keys(wireSchema.properties!).filter((k) => !GROUPS.includes(k)),
      ...GROUPS.flatMap((g) =>
        Object.keys(wireSchema.properties![g]!.properties!),
      ),
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
    schoolFits: [
      {
        schoolName: "MIT",
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
    analysis: {
      strengths: [{ title: "Sport", detail: "Six years.", relevantTo: ["all"] }],
      weaknesses: [
        { title: "No field evidence", detail: "Nothing yet.", severity: "significant" },
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
    },
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

  it("does NOT cut a valid response in half over backticks inside a string", () => {
    // The first version matched a code fence anywhere in the response. A
    // student asking about Computer Science gets advice containing code, and
    // this would have sliced the result apart and reported "not valid JSON".
    const json = '{"howToStrengthen":"Publish it: ```py\\nprint(1)\\n``` in a repo."}';
    expect(JSON.parse(extractJsonObject(json)!)).toEqual(JSON.parse(json));
  });

  it("stops at the end of the first object, not the last brace anywhere", () => {
    const text = '{"a":1}\n\nHope this helps! {not json}';
    expect(extractJsonObject(text)).toBe('{"a":1}');
  });

  it("is not confused by braces or escaped quotes inside strings", () => {
    const json = '{"a":"} \\" { not structure","b":{"c":1}}';
    expect(JSON.parse(extractJsonObject(json)!)).toEqual(JSON.parse(json));
  });

  it("returns null for an object that is never closed", () => {
    // A response cut off mid-generation. Better to fail loudly than to hand
    // back a fragment that parses into something half-empty.
    expect(extractJsonObject('{"a":1,"b":')).toBeNull();
  });
});

describe("turning one attempt into a result or a reason", () => {
  /** Stands in for a Zod schema: an object is valid if it has an "a". */
  const schema = {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: { a: unknown } }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } {
      if (typeof value === "object" && value !== null && "a" in value) {
        return { success: true, data: value as { a: unknown } };
      }
      return {
        success: false,
        error: { issues: [{ path: ["a"], message: "Required" }] },
      };
    },
  };

  function attempt(over: Partial<ModelAttempt> = {}): ModelAttempt {
    return { text: '{"a":1}', constrained: true, stopReason: "end_turn", ...over };
  }

  it("returns the validated value on a good response", () => {
    const out = parseModelJson(schema, attempt(), "model's response");
    expect(out.ok).toBe(true);
  });

  it("uses the SDK's own parse rather than re-deriving it from the text", () => {
    // zodOutputFormat attaches a parse method that the SDK runs inside
    // finalMessage(), so on the constrained path the response has already been
    // JSON-parsed and schema-checked. A second parser here could only disagree
    // with the first — as this text, which is not JSON at all, proves.
    const out = parseModelJson(
      schema,
      attempt({ text: "not json in the slightest", parsed: { a: 1 } }),
      "model's response",
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data).toEqual({ a: 1 });
  });

  it("still validates what the SDK handed over", () => {
    // Cheap, and nothing gets stored that this module has not checked itself.
    const out = parseModelJson(
      schema,
      attempt({ parsed: { wrong: true } }),
      "model's response",
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("a: Required");
  });

  it("carries an SDK rejection into the normal failure path", () => {
    // This used to escape finalMessage() as a raw error with no path, no stop
    // reason and no retry — it bypassed every recovery in this module.
    const out = parseModelJson(
      schema,
      {
        text: "",
        constrained: true,
        stopReason: null,
        parseError: "Failed to parse structured output: expected object",
      },
      "model's response",
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain("constrained");
      expect(out.reason).toContain("expected object");
    }
  });

  it("recognizes the SDK's rejection, and nothing else", () => {
    expect(
      isStructuredOutputParseError(
        new Error("Failed to parse structured output as JSON: Unexpected end"),
      ),
    ).toBe(true);
    expect(isStructuredOutputParseError(new Error("overloaded_error"))).toBe(false);
    expect(isStructuredOutputParseError(null)).toBe(false);
  });

  it("names the path and stop reason on every failure", () => {
    // The whole point: a failure has to say whether the schema constraint was
    // even in force, or there is nothing to debug from.
    for (const bad of [
      attempt({ text: "" }),
      attempt({ text: "sorry, no" }),
      attempt({ text: '{"b":1}' }),
    ]) {
      const out = parseModelJson(schema, bad, "model's response");
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.reason).toContain("constrained");
        expect(out.reason).toContain("stop_reason: end_turn");
      }
    }
  });

  it("says which path when the grammar had to be dropped", () => {
    const out = parseModelJson(
      schema,
      attempt({ text: "not json", constrained: false }),
      "model's response",
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("prompt-only");
  });

  it("quotes the response when the JSON itself was the problem", () => {
    const out = parseModelJson(
      schema,
      attempt({ text: "I'd rather explain this in prose." }),
      "model's response",
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("I'd rather explain this in prose.");
  });

  it("lists schema issues rather than only the first", () => {
    const out = parseModelJson(schema, attempt({ text: '{"b":1}' }), "projection");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain("projection");
      expect(out.reason).toContain("a: Required");
    }
  });
});

describe("the retry note", () => {
  it("tells the model exactly what went wrong last time", () => {
    const note = renderRetryNote("The model returned output that was not valid JSON.");
    expect(note).toContain("previous response could not be used");
    expect(note).toContain("not valid JSON");
  });

  it("restates the constraints the failed attempt broke", () => {
    const note = renderRetryNote("whatever");
    expect(note).toMatch(/ONE complete JSON object/);
    expect(note).toMatch(/no markdown code fences/);
    expect(note).toMatch(/the object must be closed/);
  });
});

describe("keeping the evidence when a response can't be used", () => {
  it("collapses whitespace so the excerpt reads on one line", () => {
    expect(responseExcerpt("  hello\n\n   world  ")).toBe("Response: hello world");
  });

  it("shows the END as well as the start", () => {
    // The head alone proved a 26,000-character response STARTED correctly and
    // left the actual break invisible. Where it stops is what identifies the
    // fault: mid-word means cut off, cleanly closed means damage in the middle.
    const excerpt = responseExcerpt(`{"a":"${"x".repeat(5000)}","last":"tail"}`, 50, 40);
    expect(excerpt).toContain('{"a":"xxx');
    expect(excerpt).toContain('"last":"tail"}');
    expect(excerpt).toContain("chars total");
  });

  it("does not split a response short enough to show whole", () => {
    expect(responseExcerpt('{"a":1}', 400, 300)).toBe('Response: {"a":1}');
  });

  it("says so plainly rather than returning nothing", () => {
    expect(responseExcerpt("")).toBe("(empty)");
    expect(responseExcerpt("   \n ")).toBe("(empty)");
  });
});

describe("salvaging a response that stops mid-JSON", () => {
  it("closes an object cut off after a complete value", () => {
    const out = repairTruncatedJson('{"a":1,"b":{"c":2}');
    expect(JSON.parse(out!)).toEqual({ a: 1, b: { c: 2 } });
  });

  it("drops a string the response stopped in the middle of", () => {
    const out = repairTruncatedJson('{"a":1,"b":"half a sente');
    expect(JSON.parse(out!)).toEqual({ a: 1 });
  });

  it("drops a key whose value never arrived", () => {
    const out = repairTruncatedJson('{"a":1,"b":');
    expect(JSON.parse(out!)).toEqual({ a: 1 });
  });

  it("closes nested arrays and objects in the right order", () => {
    const out = repairTruncatedJson('{"a":[{"b":[1,2],');
    expect(JSON.parse(out!)).toEqual({ a: [{ b: [1, 2] }] });
  });

  it("discards a trailing bare number, which may itself be cut in half", () => {
    // "25" truncated to "2" is indistinguishable from a complete 2, so the
    // last unterminated token is dropped rather than believed.
    expect(JSON.parse(repairTruncatedJson('{"a":[1,2')!)).toEqual({ a: [1] });
  });

  it("leaves a COMPLETE object alone — that is not its job", () => {
    expect(repairTruncatedJson('{"a":1}')).toBeNull();
  });

  it("refuses text that is not a truncated object", () => {
    expect(repairTruncatedJson("no braces here")).toBeNull();
    expect(repairTruncatedJson("")).toBeNull();
    // Mismatched closers are corruption, not truncation.
    expect(repairTruncatedJson('{"a":[1}')).toBeNull();
  });

  it("repairs, but never trusts — the result still has to validate", () => {
    // A cut that lost required fields must still be rejected. The repair only
    // makes the response parseable; the schema decides if it is usable.
    const schema = {
      safeParse(value: unknown) {
        const ok =
          typeof value === "object" && value !== null && "required" in value;
        return ok
          ? { success: true as const, data: value as { required: unknown } }
          : {
              success: false as const,
              error: { issues: [{ path: ["required"], message: "Required" }] },
            };
      },
    };
    const out = parseModelJson(
      schema,
      {
        text: '{"a":1,"b":"cut off here',
        constrained: false,
        stopReason: "end_turn",
      },
      "model's response",
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("required: Required");
  });

  it("rescues a response whose only fault was the missing bracket", () => {
    const schema = {
      safeParse(value: unknown) {
        return { success: true as const, data: value as { a: unknown } };
      },
    };
    const out = parseModelJson(
      schema,
      { text: '{"a":1,"b":{"c":2}', constrained: false, stopReason: "end_turn" },
      "model's response",
    );
    expect(out.ok).toBe(true);
  });
});
