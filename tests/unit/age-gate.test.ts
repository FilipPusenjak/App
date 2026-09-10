// The under-13 screen.
//
// Two things are being protected here and they pull in opposite directions.
//
// The rule must actually hold — an off-by-one on somebody's thirteenth birthday
// is the whole point of the check failing silently, and date arithmetic done
// with milliseconds gets exactly that case wrong.
//
// And the rule must not TEACH itself. A rejection that says "you must be at
// least 13" is a hint, and the second attempt succeeds. So the message for a
// too-young date is deliberately the least informative of the five, and a test
// holds it that way against a future edit that makes it "friendlier".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGE_MESSAGES,
  MINIMUM_AGE_YEARS,
  ageInYears,
  checkAge,
} from "@/lib/validation/age";
import { signupSchema } from "@/lib/validation/auth";

const NOW = new Date("2026-09-10T12:00:00Z");

/** A birth date exactly `years` before NOW, offset by `days`. */
function born(years: number, days = 0): Date {
  const d = new Date(NOW);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

describe("counting years", () => {
  it("counts a birthday that has already passed this year", () => {
    expect(ageInYears(new Date("2010-01-01T00:00:00Z"), NOW)).toBe(16);
  });

  it("does not count a birthday still to come this year", () => {
    expect(ageInYears(new Date("2010-12-31T00:00:00Z"), NOW)).toBe(15);
  });

  it("counts the birthday itself as the day they turn that age", () => {
    // The boundary the whole check rests on.
    expect(ageInYears(new Date("2013-09-10T00:00:00Z"), NOW)).toBe(13);
    expect(ageInYears(new Date("2013-09-11T00:00:00Z"), NOW)).toBe(12);
  });

  it("gets a leap-day birthday right", () => {
    // 29 February in a non-leap year. Dividing a millisecond span by 365.25
    // lands on the wrong side of this.
    expect(ageInYears(new Date("2012-02-29T00:00:00Z"), new Date("2026-02-28T12:00:00Z"))).toBe(13);
    expect(ageInYears(new Date("2012-02-29T00:00:00Z"), new Date("2026-03-01T12:00:00Z"))).toBe(14);
  });
});

describe("who may hold an account", () => {
  it("accepts somebody comfortably over the floor", () => {
    expect(checkAge(born(17), NOW)).toEqual({ ok: true, age: 17 });
  });

  it("accepts somebody on their thirteenth birthday", () => {
    // Not "over 13" — 13. Being wrong by a day here turns away exactly the
    // person the floor was drawn to admit.
    const result = checkAge(born(MINIMUM_AGE_YEARS), NOW);
    expect(result).toEqual({ ok: true, age: MINIMUM_AGE_YEARS });
  });

  it("refuses somebody one day short of it", () => {
    expect(checkAge(born(MINIMUM_AGE_YEARS, 1), NOW)).toEqual({
      ok: false,
      reason: "too-young",
    });
  });

  it("refuses a missing date rather than passing it through", () => {
    // The failure that matters most: a form that stopped sending the field
    // must not become a form with no age check.
    expect(checkAge(null, NOW).ok).toBe(false);
    expect(checkAge(undefined, NOW).ok).toBe(false);
  });

  it("refuses a date it cannot read", () => {
    expect(checkAge(new Date("not a date"), NOW)).toEqual({
      ok: false,
      reason: "unparseable",
    });
  });

  it("refuses a date in the future", () => {
    expect(checkAge(born(-1), NOW)).toEqual({ ok: false, reason: "future" });
  });

  it("refuses an implausible year separately from a young one", () => {
    // A mistyped year is likelier than a 150-year-old, and the two deserve
    // different messages — one is worth correcting, the other is a refusal.
    expect(checkAge(born(150), NOW)).toEqual({
      ok: false,
      reason: "implausible",
    });
  });
});

describe("the screen does not teach itself", () => {
  it("never names the cut-off in the rejection", () => {
    const message = AGE_MESSAGES["too-young"];
    expect(message).not.toMatch(/13|thirteen|age|old enough|too young/i);
  });

  it("keeps the cut-off out of the signup form's copy", () => {
    // A label saying "you must be 13 or over" would defeat the neutral screen
    // just as surely as the rejection message would.
    const form = readFileSync("app/(auth)/signup/signup-form.tsx", "utf8")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(form).not.toMatch(/13|thirteen|must be at least/i);
  });
});

describe("signup will not create an account without a usable date", () => {
  const valid = {
    name: "A Student",
    email: "student@example.test",
    password: "a-long-enough-password",
    accountKind: "STUDENT" as const,
    dateOfBirth: "2008-04-02",
  };

  it("accepts a signup from somebody over the floor", () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses one with no date at all", () => {
    const { dateOfBirth, ...withoutDate } = valid;
    void dateOfBirth;
    expect(signupSchema.safeParse(withoutDate).success).toBe(false);
  });

  it("refuses one from somebody under the floor", () => {
    const parsed = signupSchema.safeParse({
      ...valid,
      dateOfBirth: new Date().toISOString().slice(0, 10),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === "dateOfBirth")).toBe(
        true,
      );
    }
  });

  it("applies the same floor to a counselor account", () => {
    // The routing-around case. If this ever passed, the gate would be one
    // radio button away from doing nothing.
    const parsed = signupSchema.safeParse({
      ...valid,
      accountKind: "COUNSELOR",
      orgName: "A Practice",
      dateOfBirth: new Date().toISOString().slice(0, 10),
    });
    expect(parsed.success).toBe(false);
  });
});

describe("the date of birth stays out of the model's reach", () => {
  it("is never assembled into an evaluation snapshot", () => {
    // An evaluation judging a student against their targets has no business
    // knowing their birthday. Grade level is the age-shaped fact that IS
    // relevant, and stageOutlook already reasons from it.
    const snapshot = readFileSync("lib/evaluation/snapshot.ts", "utf8");
    expect(snapshot).not.toMatch(/dateOfBirth|birthDate/);
  });

  it("is not rendered into any prompt", () => {
    const render = readFileSync("lib/prompts/evaluation/render.ts", "utf8");
    expect(render).not.toMatch(/dateOfBirth|birthDate/);
  });

  it("is included in the export, because it is theirs", () => {
    const route = readFileSync("app/api/export/route.ts", "utf8");
    expect(route).toMatch(/dateOfBirth: true/);
  });
});
