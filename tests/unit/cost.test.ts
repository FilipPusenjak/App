// Reporting what a run cost.
//
// This exists because "it feels like it's costing more each time" was the only
// evidence anyone had, and it is not something you can act on. The API reports
// exactly what it billed; storing and showing it turns a guess into a number.
//
// The cache columns are separated on purpose. A write costs 2x base input and
// a read 0.1x, so a run that only ever WRITES the cache is more expensive than
// one with no caching at all — and lumped into a single "cache tokens" figure
// that is indistinguishable from a saving.
import { describe, expect, it } from "vitest";
import { cacheVerdict, estimateCost, formatUsd } from "@/lib/cost";

const NONE = {
  inputTokens: null,
  outputTokens: null,
  cacheWriteTokens: null,
  cacheReadTokens: null,
};

describe("estimating what a run cost", () => {
  it("prices input and output at the model's own rates", () => {
    // Opus 5: $5/M in, $25/M out.
    const cost = estimateCost(
      { ...NONE, inputTokens: 1_000_000, outputTokens: 1_000_000 },
      "claude-opus-5",
    );
    expect(cost).toBeCloseTo(30, 5);
  });

  it("prices a cheaper model differently", () => {
    // Sonnet 5: $3/M in, $15/M out — the projection route's model.
    const cost = estimateCost(
      { ...NONE, inputTokens: 1_000_000, outputTokens: 1_000_000 },
      "claude-sonnet-5",
    );
    expect(cost).toBeCloseTo(18, 5);
  });

  it("charges a cache WRITE more than plain input, not less", () => {
    const write = estimateCost({ ...NONE, cacheWriteTokens: 1_000_000 }, "claude-opus-5")!;
    const plain = estimateCost({ ...NONE, inputTokens: 1_000_000 }, "claude-opus-5")!;
    expect(write).toBeGreaterThan(plain);
    expect(write).toBeCloseTo(plain * 2, 5);
  });

  it("charges a cache READ a fraction of plain input", () => {
    const read = estimateCost({ ...NONE, cacheReadTokens: 1_000_000 }, "claude-opus-5")!;
    const plain = estimateCost({ ...NONE, inputTokens: 1_000_000 }, "claude-opus-5")!;
    expect(read).toBeCloseTo(plain * 0.1, 5);
  });

  it("returns null when nothing was recorded, rather than a confident $0.00", () => {
    // Older rows predate the usage columns; showing them as free would be a lie.
    expect(estimateCost(NONE, "claude-opus-5")).toBeNull();
  });

  it("still prices a run whose model is unknown", () => {
    expect(estimateCost({ ...NONE, inputTokens: 1000 }, null)).toBeGreaterThan(0);
  });
});

describe("what caching actually did to a run", () => {
  it("reports a genuine hit as a saving", () => {
    const v = cacheVerdict({ ...NONE, cacheReadTokens: 12_000 });
    expect(v.state).toBe("hit");
    expect(v.savedUsd!).toBeGreaterThan(0);
  });

  it("reports a write with no read as a LOSS, not a saving", () => {
    // The failure this whole change is about: paying 2x for an entry that
    // expires before anyone reads it.
    const v = cacheVerdict({ ...NONE, cacheWriteTokens: 12_000 });
    expect(v.state).toBe("write-only");
    expect(v.savedUsd!).toBeLessThan(0);
  });

  it("says nothing happened when caching was not used", () => {
    const v = cacheVerdict({ ...NONE, inputTokens: 12_000 });
    expect(v.state).toBe("none");
    expect(v.savedUsd).toBeNull();
  });

  it("treats a run that both wrote and read as a hit", () => {
    // A partial hit still read something back, which is the useful signal.
    expect(
      cacheVerdict({ ...NONE, cacheWriteTokens: 500, cacheReadTokens: 12_000 })
        .state,
    ).toBe("hit");
  });
});

describe("formatting", () => {
  it("does not round a real cost down to $0.00", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
  });

  it("shows a loss as negative", () => {
    expect(formatUsd(-0.06)).toBe("-$0.06");
  });

  it("shows nothing when there is nothing to show", () => {
    expect(formatUsd(null)).toBeNull();
  });

  it("formats an ordinary run", () => {
    expect(formatUsd(0.3712)).toBe("$0.37");
  });
});
