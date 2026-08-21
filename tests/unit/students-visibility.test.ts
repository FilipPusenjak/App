// Who is offered the Students tab.
//
// There used to be an opt-in ("I manage more than one student") that any
// account could flip on. It's gone — a new account can never become
// multi-student — but the safety rule it enforced still matters for the
// accounts that already had several profiles before that closed: a display
// setting must never be able to strand someone's own records behind a page
// nothing links to. isMultiStudent is now the whole rule.
import { describe, expect, it } from "vitest";
import { isMultiStudent } from "@/lib/students";

describe("a solo account", () => {
  it("is not shown the tab", () => {
    expect(isMultiStudent([{}])).toBe(false);
  });

  it("is not shown it before their first profile exists either", () => {
    expect(isMultiStudent([])).toBe(false);
  });
});

describe("an account that already has several students", () => {
  it("keeps the tab, however many", () => {
    // THE PROPERTY THAT MATTERS. There is no setting left to turn this off
    // with, but the function this reduced to still has to hold: more than one
    // profile always means reachable.
    expect(isMultiStudent([{}, {}])).toBe(true);
    expect(isMultiStudent(Array.from({ length: 12 }, () => ({})))).toBe(true);
  });
});
