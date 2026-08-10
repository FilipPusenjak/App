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

  it("accepts a dense fact up to real-world length, not the original 300-char guess", () => {
    // A real research batch produced a genuine, single, non-padded fact (the
    // University of California "A-G" subject requirement) at 347 characters.
    // The original 300-char cap discarded it for being correct and thorough.
    const dense =
      "Fifteen A-G college-preparatory courses: two history/social science, four English, three mathematics (four recommended), two laboratory science (three recommended), two language other than English (three recommended), one visual and performing arts, and one college-preparatory elective; at least 11 completed before senior year; grade C or better";
    expect(dense.length).toBeGreaterThan(300);
    expect(dense.length).toBeLessThan(450);
    const outcome = validateRecord(
      record({
        requirements: {
          requiredSubjects: fact({ value: dense }),
        },
      }),
    );
    expect(outcome.ok).toBe(true);
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

  it("drops an acceptance rate with no scope, but keeps the record", () => {
    // A rate without scope is three different numbers wearing one label — so
    // it must not be STORED. But it is internal-only and never shown to a
    // student, so a defect in it must never cost the record its real, sourced,
    // student-facing requirements. Dropped, not rejected.
    const outcome = validateRecord(
      record({
        acceptanceRate: {
          percent: 4.5,
          quote: "The University admitted 4.5% of applicants in 2025.",
          sourceUrl: OFFICIAL,
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.record.acceptanceRate).toBeUndefined();
      expect(outcome.droppedAcceptanceRate).toBe(true);
      // The thing that actually matters — the sourced requirement — survived.
      expect(outcome.record.requirements.gradeRequirement).toBeTruthy();
    }
  });

  it("accepts scope as the free text a real source actually uses", () => {
    // Not one of a fixed three values. A closed enum here once discarded ~29%
    // of a real research batch over an internal-only field's wording, while
    // the public-facing requirements in those same records were fine.
    const outcome = validateRecord(
      record({
        acceptanceRate: {
          percent: 4.5,
          scope: "university-wide first-year admission, Fall 2025",
          quote: "4.5% of applicants were offered admission for Fall 2025.",
          sourceUrl: OFFICIAL,
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.droppedAcceptanceRate).toBe(false);
      expect(outcome.record.acceptanceRate?.scope).toBe(
        "university-wide first-year admission, Fall 2025",
      );
    }
  });

  it("still requires a source and a real quote on the rate itself", () => {
    // Loosening scope must not loosen the anti-fabrication rule underneath it.
    const outcome = validateRecord(
      record({
        acceptanceRate: {
          percent: 4.5,
          scope: "course",
          quote: "yes",
          sourceUrl: OFFICIAL,
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.droppedAcceptanceRate).toBe(true);
  });

  it("does not flag a drop when no acceptance rate was ever supplied", () => {
    const outcome = validateRecord(record());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.droppedAcceptanceRate).toBe(false);
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
