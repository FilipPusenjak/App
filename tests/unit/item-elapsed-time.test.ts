// How long an item has run, as the model is told it.
//
// This exists because of a real, reported wrong answer: a student entered a
// project with a start date a week earlier, and the evaluation described it as
// "a month or two in with no shipped product" — and then judged it against that
// imagined timeline. The model was not ignoring the dates. It was given
// `[2026-08-08 to present]` and never told what "present" was, so elapsed time
// was unknowable and it filled the gap from its own prior.
//
// Two things follow, and both are tested here: the prompt states today's date,
// and each span is computed rather than left as arithmetic for the model to do
// mid-judgement. A wrong duration is not a cosmetic defect — it changes what
// the student is told they should have finished by now.
import { describe, expect, it } from "vitest";
import {
  describeLeadTime,
  describeSpan,
  renderSnapshot,
} from "@/lib/prompts/evaluation/render";
import type { EvaluationSnapshot } from "@/lib/evaluation/snapshot";

const TODAY = "2026-08-15T09:30:00.000Z";

function span(start: string | null, end: string | null, today = TODAY) {
  return describeSpan(start, end, today);
}

describe("the reported bug: a week-old project", () => {
  it("says one week, not a month or two", () => {
    const text = span("2026-08-08", null);
    expect(text).toContain("7 days so far");
    expect(text).not.toMatch(/month/);
  });

  it("still carries the raw dates, so the model can check the arithmetic", () => {
    expect(span("2026-08-08", null)).toContain("2026-08-08 to present");
  });

  it("renders inside the full prompt, not just in isolation", () => {
    // The unit being right is worth nothing if the renderer doesn't call it.
    const text = renderSnapshot(
      snapshotWithItem({ startDate: "2026-08-08", endDate: null }),
    );
    expect(text).toContain("7 days so far");
  });
});

describe("units a person would actually use", () => {
  it.each([
    ["2026-08-14", "1 day"],
    ["2026-08-08", "7 days"],
    ["2026-08-02", "13 days"],
    ["2026-08-01", "2 weeks"],
    ["2026-07-04", "6 weeks"],
    ["2026-06-15", "2 months"],
    ["2025-08-15", "1 year"],
    ["2024-10-01", "1 year 10 months"],
    ["2024-08-15", "2 years"],
    ["2024-02-15", "2 years 6 months"],
  ])("a start of %s reads as %s so far", (start, expected) => {
    expect(span(start, null)).toContain(`${expected} so far`);
  });

  it("says the same day is less than a day rather than zero days", () => {
    expect(span("2026-08-15", null)).toContain("less than a day");
  });

  it("counts calendar months, not 30-day blocks", () => {
    // Feb 15 -> Aug 15 is six calendar months but only 181 days; a /30 estimate
    // would call it 6 months by luck and a /31 one would call it 5.
    expect(span("2026-02-15", null)).toContain("6 months so far");
  });

  it("does not round a month up before it has elapsed", () => {
    // One day short of two months stays in weeks rather than becoming "2 months".
    expect(span("2026-06-16", null)).not.toMatch(/2 months/);
  });

  it("says years once there is a year, so sustained work reads as sustained", () => {
    // "23 months" is accurate and useless: the prompt weighs YEARS sustained,
    // and a two-year commitment should not need converting to be recognised.
    const text = span("2024-09-01", null);
    expect(text).toContain("1 year 11 months");
    expect(text).not.toContain("23 months");
  });
});

describe("spans that are not simply 'started and still going'", () => {
  it("reports a finished item in the past tense with its real length", () => {
    const text = span("2025-09-01", "2026-06-01");
    expect(text).toContain("ran 9 months");
    expect(text).toContain("now finished");
    expect(text).not.toContain("so far");
  });

  it("treats an end date in the future as still running, not as done", () => {
    const text = span("2026-06-15", "2026-12-01");
    expect(text).toContain("2 months so far");
    expect(text).toContain("scheduled to run until 2026-12-01");
  });

  it("says a future item has not started rather than giving it a duration", () => {
    // A planned item credited with elapsed time is the same error in reverse.
    const text = span("2026-10-01", null);
    expect(text).toContain("has not started yet");
    expect(text).not.toContain("so far");
  });

  it("says the duration is unknown when there is no start date", () => {
    const text = span(null, "2026-06-01");
    expect(text).toContain("unknown");
    expect(text).not.toMatch(/\d+ (day|week|month|year)/);
  });

  it("renders nothing at all when the item has no dates", () => {
    expect(span(null, null)).toBe("");
  });

  it("flags reversed dates instead of reporting a negative span", () => {
    const text = span("2026-06-01", "2026-01-01");
    expect(text).toContain("unreliable");
    // Not `/-\d/` — the ISO dates themselves contain hyphens. What must never
    // appear is a negative DURATION.
    expect(text).not.toMatch(/-\d+ (day|week|month|year)/);
  });

  it("survives an unparseable date without throwing or inventing a span", () => {
    expect(() => span("not a date", null)).not.toThrow();
    expect(span("not a date", null)).not.toMatch(/\d+ (day|week|month|year)/);
  });
});

describe("how far off a planned date is", () => {
  it("states the time remaining, which is what a projection turns on", () => {
    expect(describeLeadTime("2026-11-15", TODAY)).toContain("3 months from now");
  });

  it("names a target date that has already gone by as overdue", () => {
    // A plan quietly rots into this. Read as upcoming, it credits a student
    // with time they no longer have.
    const text = describeLeadTime("2026-05-15", TODAY);
    expect(text).toContain("PASSED");
    expect(text).toContain("3 months ago");
    expect(text).not.toContain("from now");
  });

  it("says 'today' rather than '0 days from now'", () => {
    expect(describeLeadTime("2026-08-15", TODAY)).toContain("today");
  });

  it("renders nothing when there is no target date", () => {
    expect(describeLeadTime(null, TODAY)).toBe("");
  });
});

describe("the prompt states today's date", () => {
  it("names the capture date, since every 'so far' is relative to it", () => {
    const text = renderSnapshot(snapshotWithItem({}));
    expect(text).toContain("Today's date: 2026-08-15");
  });

  it("tells the model not to estimate elapsed time itself", () => {
    const text = renderSnapshot(snapshotWithItem({}));
    expect(text).toMatch(/do not estimate/i);
  });

  it("does not leak the time of day", () => {
    // Day precision on both sides; an item started this morning should not be
    // described in hours.
    const text = renderSnapshot(snapshotWithItem({}));
    expect(text).not.toContain("09:30");
  });
});

describe("grade level says which grade it means", () => {
  it("states that it is the grade in progress or just completed", () => {
    // Previously a bare free-text passthrough: the model was given "Grade 11"
    // with no indication of whether that year was ahead of them or behind.
    const text = renderSnapshot(snapshotWithItem({}));
    expect(text).toMatch(/currently IN, or has JUST COMPLETED/);
  });

  it("ties that reading to today's date rather than leaving it open", () => {
    const text = renderSnapshot(snapshotWithItem({}));
    expect(text).toMatch(/together with today's date/i);
  });
});

function snapshotWithItem(item: {
  startDate?: string | null;
  endDate?: string | null;
}): EvaluationSnapshot {
  return {
    capturedAt: TODAY,
    student: {
      gradeLevel: "Grade 11",
      schoolName: "Riverside High",
      schoolContext: null,
      curriculum: "AP",
      gpa: 3.8,
      gpaScale: "4.0",
      intendedMajor: "Computer Science",
      careerGoal: null,
      countryOfOrigin: "United States",
    },
    testScores: [],
    resumeItems: [
      {
        ref: "R1",
        id: "item-a",
        type: "project",
        title: "Building a co-op managing app",
        org: null,
        description: null,
        startDate: item.startDate ?? null,
        endDate: item.endDate ?? null,
        hoursPerWeek: null,
        evidenceNotes: null,
      },
    ],
    targets: [
      {
        name: "MIT",
        country: "US",
        countryName: "United States",
        course: "Computer Science",
        classification: null,
        priority: null,
        notes: null,
      },
    ],
  };
}
