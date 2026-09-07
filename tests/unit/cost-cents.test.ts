// Every run that spends money books what it cost, in cents, on its own row.
//
// The two most expensive routes in the app — Deep Review and projection —
// stored token counts and never the cost. Evaluation had the column from the
// start and the route never wrote it; Projection had no column at all. Cost
// was therefore visible per run only on the cheaper tiers, and the per-user
// figure the retention economics rest on could not be read off the table.
//
// The rounding is unit-tested. That every writer goes through it, and that
// both routes write it on the completed AND the failed path, is asserted
// against the source, since the model is mocked away in every runtime test.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { costCentsFor, estimateCost } from "@/lib/cost";

describe("costCentsFor", () => {
  const usage = {
    inputTokens: 20_000,
    outputTokens: 8_000,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };

  it("is the estimate in whole cents, rounded not truncated", () => {
    const usd = estimateCost(usage, "claude-opus-5")!;
    expect(costCentsFor(usage, "claude-opus-5")).toBe(Math.round(usd * 100));
    // 0.005 USD is half a cent, which rounds up; a truncation would book 0.
    expect(
      costCentsFor(
        { inputTokens: 1000, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
        "claude-opus-5",
      ),
    ).toBe(1);
  });

  it("books a run with nothing recorded at zero, not null", () => {
    // Null on the row means "not recorded", and a run that genuinely used no
    // tokens is a different fact from a run nobody counted.
    expect(
      costCentsFor(
        { inputTokens: null, outputTokens: null, cacheWriteTokens: null, cacheReadTokens: null },
        "claude-opus-5",
      ),
    ).toBe(0);
  });

  it("prices by the model that ran, not a fixed one", () => {
    expect(costCentsFor(usage, "claude-sonnet-5")).toBeLessThan(
      costCentsFor(usage, "claude-opus-5"),
    );
  });
});

describe.each([
  ["app/api/evaluate/route.ts", "choice.model"],
  ["app/api/project/route.ts", "getProjectionModel()"],
])("%s books the cost on its row", (file, model) => {
  const source = readFileSync(file, "utf8");

  it("on the completed path and on the failed path", () => {
    const writes = source.match(/costCents: costCentsFor\(usage, [^)]*\)?\)/g) ?? [];
    expect(
      writes,
      "a route that records tokens on both outcomes has to record cost on both, " +
        "or a failed run — the one somebody chasing a bill is looking for — is " +
        "the one without a figure",
    ).toHaveLength(2);
    for (const write of writes) expect(write).toContain(model);
  });

  it("beside the token counts it is computed from", () => {
    // Each cost write sits directly after the usage spread it prices. The
    // alternative — a cost written in one place and the tokens in another —
    // is how the two drift apart.
    const pairs = source.match(/\.\.\.usage,\s*(?:\/\/[^\n]*\n\s*)*costCents:/g) ?? [];
    expect(pairs).toHaveLength(2);
  });
});

describe("every costCents write goes through the one helper", () => {
  // Rounding in two places is two figures for one run. The pending row a
  // check-in opens before calling the model is the one legitimate literal:
  // nothing has been spent yet, and 0 says so.
  const files = [
    "app/api/evaluate/route.ts",
    "app/api/project/route.ts",
    "app/api/evaluations/check-in/route.ts",
    "app/api/counselor/prep/route.ts",
    "app/api/tutor/artifact/route.ts",
    "lib/evaluation/record-failure.ts",
  ];

  for (const file of files) {
    it(file, () => {
      const source = readFileSync(file, "utf8");
      const writes = source.match(/costCents: [^\n]*/g) ?? [];
      expect(writes.length).toBeGreaterThan(0);
      for (const write of writes) {
        expect(
          /costCents: (costCentsFor\(|0,)/.test(write),
          `${file}: ${write}`,
        ).toBe(true);
      }
      expect(source).not.toContain("Math.round((estimateCost(");
    });
  }
});

describe("the projection row can hold it", () => {
  it("Projection has a costCents column like Evaluation's", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const projection = schema.match(/^model Projection \{[\s\S]*?^\}/m)![0];
    expect(projection).toMatch(/^\s+costCents\s+Int\?/m);
  });
});
