// What the course field tells a student, in each state it can be in.
//
// This is the copy on a field most students will fill in with something we have
// no data for, so the thing being tested is mostly restraint: it must never
// imply their course is wrong, unrecognised, or missing. A course that is not
// on the list is the ordinary case, not an error.
import { describe, expect, it } from "vitest";
import { describeHint } from "@/app/(app)/targets/course-picker";

const state = (over: Partial<Parameters<typeof describeHint>[0]> = {}) => ({
  total: 0,
  loading: false,
  hasUniversity: true,
  typed: false,
  exact: false,
  ...over,
});

describe("before a university is entered", () => {
  it("keeps the original guidance rather than talking about a list", () => {
    // There is nothing to list yet; mentioning one would be noise.
    expect(describeHint(state({ hasUniversity: false }))).toContain(
      "UK course-specific admissions",
    );
  });
});

describe("when we hold courses for the university", () => {
  it("says how many, so the offer is concrete", () => {
    expect(describeHint(state({ total: 34 }))).toContain("34 courses");
  });

  it("gets the singular right", () => {
    const one = describeHint(state({ total: 1 }));
    expect(one).toContain("1 course ");
    expect(one).not.toContain("1 courses");
  });

  it("says what picking from the list BUYS, not that typing is wrong", () => {
    const hint = describeHint(state({ total: 12, typed: true }));
    expect(hint).toMatch(/pick one/i);
    expect(hint).toMatch(/keep your own wording/i);
    // Never scolds.
    expect(hint).not.toMatch(/invalid|not recognised|not recognized|incorrect|must/i);
  });

  it("confirms an exact match, because that is the thing worth knowing", () => {
    const hint = describeHint(state({ total: 12, typed: true, exact: true }));
    expect(hint).toMatch(/matched/i);
    expect(hint).toMatch(/real published entry requirements/i);
  });
});

describe("when we hold nothing for the university", () => {
  it("says what will happen instead, without implying a mistake", () => {
    // The majority case for most students. It has to read as normal.
    const hint = describeHint(state({ total: 0, typed: true }));
    expect(hint).toMatch(/check the official course page/i);
    expect(hint).not.toMatch(/invalid|unsupported|not found|error/i);
  });
});

describe("while looking", () => {
  it("says so rather than flashing 'no courses'", () => {
    // Without this the field claims there is no data every time the university
    // name changes, which is wrong roughly 350ms before it is right.
    const hint = describeHint(state({ loading: true, total: 0 }));
    expect(hint).toMatch(/checking/i);
    expect(hint).not.toMatch(/no researched courses/i);
  });
});

describe("every state", () => {
  it("always returns something for the student to read", () => {
    for (const loading of [true, false]) {
      for (const hasUniversity of [true, false]) {
        for (const typed of [true, false]) {
          for (const exact of [true, false]) {
            for (const total of [0, 1, 40]) {
              const hint = describeHint({ total, loading, hasUniversity, typed, exact });
              expect(hint.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });
});
