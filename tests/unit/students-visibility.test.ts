// Who is offered the Students tab.
//
// One rule, and it has a safety half. The account holder opts in, because a
// solo student should never have to hold the idea of a roster — but the setting
// must never be able to hide profiles that already exist.
import { describe, expect, it } from "vitest";
import { shouldShowStudents } from "@/lib/students";

describe("a solo student", () => {
  it("is not shown the tab", () => {
    // The default, and the common case. A roster of one is a concept to be
    // spared, not a feature.
    expect(shouldShowStudents({ managesStudents: false, profileCount: 1 })).toBe(
      false,
    );
  });

  it("is not shown it before their first profile exists either", () => {
    expect(shouldShowStudents({ managesStudents: false, profileCount: 0 })).toBe(
      false,
    );
  });
});

describe("someone who says they manage several", () => {
  it("gets the tab immediately, before adding a second student", () => {
    // Otherwise the setting appears to do nothing: you cannot add a second
    // student from a page you cannot reach.
    expect(shouldShowStudents({ managesStudents: true, profileCount: 1 })).toBe(
      true,
    );
  });

  it("gets it with none yet", () => {
    expect(shouldShowStudents({ managesStudents: true, profileCount: 0 })).toBe(
      true,
    );
  });
});

describe("the setting can never strand a profile", () => {
  it("keeps the tab for an account that already has several students", () => {
    // THE PROPERTY THAT MATTERS. Without it, switching the setting off leaves
    // every profile but the active one owned, intact, and unreachable — a
    // data-loss bug wearing a checkbox.
    expect(shouldShowStudents({ managesStudents: false, profileCount: 2 })).toBe(
      true,
    );
    expect(shouldShowStudents({ managesStudents: false, profileCount: 12 })).toBe(
      true,
    );
  });

  it("holds no matter how the two inputs combine", () => {
    for (const managesStudents of [true, false]) {
      for (const profileCount of [0, 1, 2, 5]) {
        const shown = shouldShowStudents({ managesStudents, profileCount });
        // Restated as the invariant rather than the implementation: more than
        // one student ALWAYS means reachable.
        if (profileCount > 1) expect(shown).toBe(true);
        if (managesStudents) expect(shown).toBe(true);
        if (!managesStudents && profileCount <= 1) expect(shown).toBe(false);
      }
    }
  });
});
