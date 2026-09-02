// Retention: what goes, what stays, and the thing that must never break.
//
// The headline promise is that a student can watch a readiness score move
// across four years of secondary school. Retention deletes the prose those
// scores were originally read out of, so the single most important test in this
// file is that a four-year chart survives an evaluation losing its narrative.
// Everything else is detail.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUT_SNAPSHOT_DAYS,
  DEFAULT_RESULT_DAYS,
  EXPIRY_WARNING_DAYS,
  cutoffFor,
  expiryFor,
  isExpiringSoon,
  type RetentionPolicy,
} from "@/lib/evaluation/retention";
import {
  parseChartPoint,
  serializeChartPoint,
  toChartPoint,
} from "@/lib/evaluation/chart-point";
import { buildProgress } from "@/lib/evaluation/progress";
import { legacyResult } from "./fixtures/legacy-result";

const POLICY: RetentionPolicy = {
  inputSnapshotDays: DEFAULT_INPUT_SNAPSHOT_DAYS,
  resultDays: DEFAULT_RESULT_DAYS,
};

const NOW = new Date("2028-06-01T00:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

/**
 * A result in the shape the chart reads out of a narrative.
 *
 * Built on the real fixture rather than hand-written: the stored shape is
 * Zod-validated on read, so a minimal object reads as "unrecognised" and the
 * fallback path would be tested without ever being exercised.
 */
function result(overall: number, narrative: number, schools: [string, number][]) {
  return {
    ...legacyResult,
    overallScore: overall,
    narrativeCoherence: { ...legacyResult.narrativeCoherence, score: narrative },
    schoolFits: schools.map(([schoolName, fitScore]) => ({
      ...legacyResult.schoolFits[0],
      schoolName,
      fitScore,
    })),
  };
}

describe("a four-year chart survives the prose being deleted", () => {
  /**
   * THE test. A student who started in year 9 and is now applying should see
   * the whole arc — including the earliest points, whose write-ups are long
   * gone. Before chartPointJson existed, buildProgress skipped any row whose
   * resultJson would not parse, so retention would have silently truncated the
   * chart to the last twelve months.
   */
  it("plots evaluations whose narrative has been deleted", () => {
    const rows = [
      // Year 9 and 10: narrative expired, only the denormalized point remains.
      {
        id: "e1",
        status: "completed",
        isSample: false,
        overallScore: 31,
        resultJson: null,
        chartPointJson: serializeChartPoint(
          toChartPoint(result(31, 28, [["Duke", 22]]), 31),
        ),
        promptVersion: "evaluation/v10",
        createdAt: daysAgo(1400),
      },
      {
        id: "e2",
        status: "completed",
        isSample: false,
        overallScore: 44,
        resultJson: null,
        chartPointJson: serializeChartPoint(
          toChartPoint(result(44, 41, [["Duke", 35]]), 44),
        ),
        promptVersion: "evaluation/v10",
        createdAt: daysAgo(1000),
      },
      // This year: narrative still present.
      {
        id: "e3",
        status: "completed",
        isSample: false,
        overallScore: 67,
        resultJson: JSON.stringify(result(67, 63, [["Duke", 58]])),
        chartPointJson: null,
        promptVersion: "evaluation/v10",
        createdAt: daysAgo(20),
      },
    ];

    const progress = buildProgress(rows);

    expect(progress.points.map((p) => p.overall)).toEqual([31, 44, 67]);
    // And the per-school series is intact across the whole span, which is the
    // part that lived entirely inside the narrative before this.
    expect(progress.points.map((p) => p.schools[0]?.score)).toEqual([22, 35, 58]);
    expect(progress.schools).toEqual(["Duke"]);
  });

  it("still reads a narrative when no point has been backfilled yet", () => {
    // Rows written before this existed must keep working unchanged.
    const progress = buildProgress([
      {
        id: "old",
        status: "completed",
        isSample: false,
        overallScore: 52,
        resultJson: JSON.stringify(result(52, 49, [["MIT", 40]])),
        chartPointJson: null,
        promptVersion: "evaluation/v10",
        createdAt: daysAgo(900),
      },
    ]);
    expect(progress.points).toHaveLength(1);
    expect(progress.points[0]?.narrative).toBe(49);
  });

  it("drops an evaluation that has neither a point nor a narrative", () => {
    // Nothing to plot is not the same as plotting a zero.
    const progress = buildProgress([
      {
        id: "empty",
        status: "completed",
        isSample: false,
        overallScore: null,
        resultJson: null,
        chartPointJson: null,
        promptVersion: "evaluation/v10",
        createdAt: daysAgo(900),
      },
    ]);
    expect(progress.points).toEqual([]);
  });
});

describe("the chart point carries numbers and nothing else", () => {
  it("keeps scores and school names, and no prose", () => {
    const point = toChartPoint(
      result(67, 63, [["Duke", 58.4], ["MIT", 41.6]]),
      67,
    );
    expect(point).toEqual({
      v: 1,
      overall: 67,
      narrative: 63,
      schools: [
        { name: "Duke", score: 58 },
        { name: "MIT", score: 42 },
      ],
    });
    // Nothing resembling an assessment survives into the stored form.
    const stored = serializeChartPoint(point)!;
    expect(stored).not.toMatch(/assessment|summary|narrativeText|reasoning/i);
  });

  it("prefers the column over the narrative for the headline", () => {
    // Two records of the same number; the column is what every other percentile
    // surface reads, so a disagreement resolves the same way everywhere.
    expect(toChartPoint(result(50, 40, []), 67).overall).toBe(67);
  });

  it("round-trips through storage", () => {
    const point = toChartPoint(result(67, 63, [["Duke", 58]]), 67);
    expect(parseChartPoint(serializeChartPoint(point))).toEqual(point);
  });

  it("stores nothing for a point that would plot nothing", () => {
    expect(serializeChartPoint(toChartPoint(null, null))).toBeNull();
  });

  it("survives a corrupted stored value without throwing", () => {
    for (const bad of ["", "{", "null", '{"v":99}', "[]"]) {
      expect(parseChartPoint(bad)).toBeNull();
    }
  });
});

describe("what expires, and when", () => {
  it("takes the raw profile snapshot before the write-up", () => {
    // The snapshot is essays and activity write-ups a teenager typed about
    // themselves — arguably more sensitive than the assessment of them, and
    // needed for less time.
    expect(DEFAULT_INPUT_SNAPSHOT_DAYS).toBeLessThan(DEFAULT_RESULT_DAYS);
  });

  it("keeps a write-up long enough to cover an application cycle", () => {
    expect(DEFAULT_RESULT_DAYS).toBeGreaterThanOrEqual(365);
  });

  it("expires each field on its own schedule", () => {
    const fresh = expiryFor(daysAgo(10), POLICY, NOW);
    expect(fresh).toMatchObject({ snapshotExpired: false, resultExpired: false });

    const middling = expiryFor(daysAgo(100), POLICY, NOW);
    expect(middling).toMatchObject({ snapshotExpired: true, resultExpired: false });

    const old = expiryFor(daysAgo(400), POLICY, NOW);
    expect(old).toMatchObject({ snapshotExpired: true, resultExpired: true });
  });

  it("never expires anything when a window is switched off", () => {
    const off: RetentionPolicy = { inputSnapshotDays: 0, resultDays: -1 };
    const state = expiryFor(daysAgo(5000), off, NOW);
    expect(state).toEqual({
      snapshotExpired: false,
      resultExpired: false,
      resultExpiresAt: null,
    });
    expect(cutoffFor(0, NOW)).toBeNull();
  });

  it("warns before a write-up goes, not after", () => {
    const { resultExpiresAt } = expiryFor(daysAgo(340), POLICY, NOW);
    expect(isExpiringSoon(resultExpiresAt, NOW)).toBe(true);

    // Not yet close.
    expect(isExpiringSoon(expiryFor(daysAgo(10), POLICY, NOW).resultExpiresAt, NOW)).toBe(
      false,
    );
    // Already gone — nothing left to warn about.
    expect(isExpiringSoon(expiryFor(daysAgo(400), POLICY, NOW).resultExpiresAt, NOW)).toBe(
      false,
    );
    expect(EXPIRY_WARNING_DAYS).toBeGreaterThan(0);
  });
});

describe("the sweep cannot reach a score", () => {
  it("writes only the two prose columns", async () => {
    // Source-level: this is the one piece of code in the app that destroys
    // something a user might want, and the blast radius is the whole point.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../lib/evaluation/retention-sweep.ts", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    const written = [...src.matchAll(/data:\s*\{\s*(\w+):\s*null\s*\}/g)].map(
      (m) => m[1]!,
    );
    expect(written.length).toBeGreaterThan(0);
    expect([...new Set(written)].sort()).toEqual([
      "inputSnapshotJson",
      "resultJson",
    ]);

    // And nothing that would let it touch the numbers.
    expect(src).not.toMatch(/overallScore/);
    expect(src).not.toMatch(/chartPointJson:\s*null/);
    expect(src).not.toMatch(/thresholdSnapshotJson/);
    expect(src).not.toMatch(/deleteMany/);
  });
});
