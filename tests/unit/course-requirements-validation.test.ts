// The gate between an agent's research and something the app tells a student.
//
// There is no human review step, so this schema IS the review. Anything it
// accepts gets shown as fact; anything it rejects costs only a "check the
// course page". Every test below is about the asymmetry between those two.
import { describe, expect, it } from "vitest";
import { validateRecord } from "@/lib/validation/course-requirements";

const OFFICIAL = "https://www.undergraduate.study.cam.ac.uk/courses/medicine";

function fact(over: Record<string, unknown> = {}) {
  return {
    value: "A*A*A at A Level",
    quote: "The typical offer for Medicine is A*A*A at A Level.",
    sourceUrl: OFFICIAL,
    ...over,
  };
}

function record(over: Record<string, unknown> = {}) {
  return {
    university: "University of Cambridge",
    country: "GB",
    course: "Medicine (A100)",
    cycleYear: new Date().getUTCFullYear() + 1,
    stale: false,
    gatheredOn: "2026-08-08",
    primarySourceUrl: OFFICIAL,
    requirements: { gradeRequirement: fact() },
    omitted: [],
    ...over,
  };
}

describe("a well-sourced record is accepted", () => {
  it("accepts the shape the brief asks for", () => {
    const outcome = validateRecord(record());
    expect(outcome.ok).toBe(true);
  });

  it("accepts a record where most fields are unknown", () => {
    // The expected common case. Nulls are the safe answer, not a defect.
    expect(validateRecord(record()).ok).toBe(true);
  });

  it("uppercases the country so matching cannot miss on case", () => {
    const outcome = validateRecord(record({ country: "gb" }));
    expect(outcome.ok && outcome.record.country).toBe("GB");
  });
});

describe("a fact without a source is not a fact", () => {
  it("rejects a value with no quote", () => {
    const noQuote = fact();
    delete (noQuote as { quote?: unknown }).quote;
    const outcome = validateRecord(
      record({ requirements: { gradeRequirement: noQuote } }),
    );
    expect(outcome.ok).toBe(false);
  });

  it("rejects a value with no source URL", () => {
    const noUrl = fact();
    delete (noUrl as { sourceUrl?: unknown }).sourceUrl;
    expect(
      validateRecord(record({ requirements: { gradeRequirement: noUrl } })).ok,
    ).toBe(false);
  });

  it("rejects a quote too short to be a quotation of anything", () => {
    expect(
      validateRecord(
        record({ requirements: { gradeRequirement: fact({ quote: "yes" }) } }),
      ).ok,
    ).toBe(false);
  });
});

describe("sources the brief bans", () => {
  it("rejects a forum", () => {
    const outcome = validateRecord(
      record({
        requirements: {
          gradeRequirement: fact({
            sourceUrl: "https://www.thestudentroom.co.uk/showthread.php?t=1",
          }),
        },
      }),
    );
    expect(outcome.ok).toBe(false);
  });

  it("rejects wikipedia", () => {
    expect(
      validateRecord(
        record({
          primarySourceUrl: "https://en.wikipedia.org/wiki/Cambridge",
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects a chat transcript as a source", () => {
    // The specific way this data goes wrong: a model citing itself.
    expect(
      validateRecord(
        record({ primarySourceUrl: "https://claude.ai/chat/abc" }),
      ).ok,
    ).toBe(false);
  });

  it("rejects plain http", () => {
    expect(
      validateRecord(
        record({ primarySourceUrl: "http://www.cam.ac.uk/courses" }),
      ).ok,
    ).toBe(false);
  });
});

describe("records that claim more than they know", () => {
  it("rejects a record with no sourced requirement at all", () => {
    // An empty row says "we looked and found nothing", which is a different
    // and more misleading claim than never having looked. Absence of a row is
    // the honest representation of "not checked".
    expect(validateRecord(record({ requirements: {} })).ok).toBe(false);
  });

  it("rejects a cycle year far in the future", () => {
    // A year nobody has published yet means the researcher guessed.
    expect(
      validateRecord(record({ cycleYear: new Date().getUTCFullYear() + 10 })).ok,
    ).toBe(false);
  });

  it("rejects an archived cycle year", () => {
    expect(
      validateRecord(record({ cycleYear: new Date().getUTCFullYear() - 10 })).ok,
    ).toBe(false);
  });

  it("rejects an acceptance rate with no scope", () => {
    // A rate without scope is three different numbers wearing one label.
    const outcome = validateRecord(
      record({
        acceptanceRate: {
          percent: 4.5,
          quote: "The University admitted 4.5% of applicants in 2025.",
          sourceUrl: OFFICIAL,
        },
      }),
    );
    expect(outcome.ok).toBe(false);
  });

  it("accepts an acceptance rate that states its scope", () => {
    expect(
      validateRecord(
        record({
          acceptanceRate: {
            percent: 4.5,
            scope: "course",
            quote: "The course admitted 4.5% of applicants in 2025.",
            sourceUrl: OFFICIAL,
          },
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("reporting a rejection", () => {
  it("names the record so a human can find it in the file", () => {
    const outcome = validateRecord(record({ requirements: {} }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.identifier).toContain("Cambridge");
      expect(outcome.errors.length).toBeGreaterThan(0);
    }
  });

  it("survives garbage without throwing", () => {
    // A batch must not die on one malformed entry.
    for (const junk of [null, 42, "nope", [], {}]) {
      expect(() => validateRecord(junk)).not.toThrow();
      expect(validateRecord(junk).ok).toBe(false);
    }
  });
});
