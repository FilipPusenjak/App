// What a counselor reads beside each triage signal: the raw facts, kept
// checkable, but in the form a person checks them in.
import { describe, expect, it } from "vitest";
import { describeBasis } from "@/lib/counselor/basis";

describe("a signal's facts as a counselor reads them", () => {
  const facts = describeBasis({
    signal: "COMMITMENT_OVERDUE",
    status: "ACCEPTED",
    dueDate: "2026-09-29",
    daysOverdue: 37,
    commitmentId: "cmw2z2qld0011j27dlltl34qe",
    lastEditAt: "2026-06-02T03:14:51.077Z",
    everHeld: false,
    description: "Email the robotics mentor",
  });
  const byKey = Object.fromEntries(facts.map((f) => [f.key, f.value]));

  it("keeps the facts a counselor can check, as they were", () => {
    expect(byKey["Days overdue"]).toBe("37");
    expect(byKey["Description"]).toBe("Email the robotics mentor");
  });

  it("drops row ids and the signal's own name", () => {
    expect(Object.keys(byKey).some((k) => /id$/i.test(k))).toBe(false);
    expect(byKey["Signal"]).toBeUndefined();
  });

  it("writes dates, booleans and status codes the way a person would", () => {
    expect(byKey["Due date"]).toBe("Sep 29, 2026");
    expect(byKey["Last edit at"]).toBe("Jun 2, 2026");
    expect(byKey["Ever held"]).toBe("no");
    expect(byKey["Status"]).toBe("accepted");
  });
});
