// A one-score test (SAT, ACT, IELTS...) needs no label — the kind already says
// what it is. A multi-subject kind (AP, GCSE, IB subject, predicted grade,
// other) covers many possible tests, so leaving the label blank there would
// silently collapse every subject into one indistinguishable row.
import { describe, expect, it } from "vitest";
import { testScoreSchema } from "@/lib/validation/profile";

function input(kind: string, label?: string) {
  return { kind, label, score: "1500" };
}

describe("testScoreSchema label requirement", () => {
  it("defaults the label to the kind's name for single-score kinds left blank", () => {
    for (const kind of ["sat", "act", "ib_total", "ucat", "ielts", "toefl"]) {
      const parsed = testScoreSchema.safeParse(input(kind));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.label.length).toBeGreaterThan(0);
    }
  });

  it("requires a label for subject-specific kinds", () => {
    for (const kind of ["ap", "ib_subject", "gcse", "predicted_grade", "other"]) {
      const parsed = testScoreSchema.safeParse(input(kind));
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].path).toEqual(["label"]);
      }
    }
  });

  it("keeps an explicit label a user typed, for any kind", () => {
    const parsed = testScoreSchema.safeParse(input("sat", "Retake"));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.label).toBe("Retake");

    const parsedAp = testScoreSchema.safeParse(input("ap", "Physics 1"));
    expect(parsedAp.success).toBe(true);
    if (parsedAp.success) expect(parsedAp.data.label).toBe("Physics 1");
  });
});
