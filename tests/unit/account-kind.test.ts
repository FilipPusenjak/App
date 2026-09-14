// Which kind of account signup creates.
//
// The one field on this form that is a privilege decision rather than a
// preference: STUDENT holds only its own data; COUNSELOR and TUTOR each open a
// professional surface that will hold other families' children under revocable
// grants. So the interesting cases are not the happy paths — they are what
// happens when the field is missing, empty, or something nobody put there on
// purpose — and, since the two professional kinds are different products, that
// each one lands in its own.
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_KINDS,
  ACCOUNT_TYPE_FOR_KIND,
  PROFESSIONAL_KINDS,
  isProfessionalKind,
  signupSchema,
} from "@/lib/validation/auth";

const base = {
  name: "Sam Okafor",
  email: "Sam@Example.com",
  password: "a-real-password",
  // Required on every signup now, counselor accounts included — a gate only
  // students passed would be one radio button away from doing nothing. The
  // rule itself is tested in tests/unit/age-gate.test.ts.
  dateOfBirth: "1998-04-02",
};

describe("choosing an account kind", () => {
  it("offers exactly three, and no fourth", () => {
    expect([...ACCOUNT_KINDS]).toEqual(["STUDENT", "COUNSELOR", "TUTOR"]);
  });

  it("treats counselor and tutor as professional, and a student as not", () => {
    expect([...PROFESSIONAL_KINDS]).toEqual(["COUNSELOR", "TUTOR"]);
    expect(isProfessionalKind("COUNSELOR")).toBe(true);
    expect(isProfessionalKind("TUTOR")).toBe(true);
    expect(isProfessionalKind("STUDENT")).toBe(false);
  });

  it("creates a student account when the field is absent", () => {
    // A form posted without it — an older cached page, a script, a browser
    // that dropped the radio — must produce the LESS privileged account rather
    // than fail open into a caseload.
    const parsed = signupSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.accountKind).toBe("STUDENT");
  });

  it("makes a counselor account only when it is asked for by name", () => {
    const parsed = signupSchema.safeParse({
      ...base,
      accountKind: "COUNSELOR",
      orgName: "Okafor Admissions",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.accountKind).toBe("COUNSELOR");
  });

  it("makes a tutor account only when it is asked for by name", () => {
    const parsed = signupSchema.safeParse({
      ...base,
      accountKind: "TUTOR",
      orgName: "Okafor Test Prep",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.accountKind).toBe("TUTOR");
  });

  it("maps each professional kind to its own product, never the other's", () => {
    // The bug this replaces: signup hardcoded INDEPENDENT, so choosing "tutor"
    // silently produced a counselor and the tutor edition had no front door.
    expect(ACCOUNT_TYPE_FOR_KIND.COUNSELOR).toBe("INDEPENDENT");
    expect(ACCOUNT_TYPE_FOR_KIND.TUTOR).toBe("TEST_PREP_TUTOR");
    expect(ACCOUNT_TYPE_FOR_KIND.COUNSELOR).not.toBe(ACCOUNT_TYPE_FOR_KIND.TUTOR);
  });

  it("refuses anything that is not one of the three", () => {
    for (const junk of ["", "counselor", "ADMIN", "STUDENT ", 1, null, true]) {
      const parsed = signupSchema.safeParse({ ...base, accountKind: junk });
      expect({ junk, ok: parsed.success }).toEqual({ junk, ok: false });
    }
  });

  it("will not open a professional surface without a name students can recognise", () => {
    // A family deciding whether to grant access sees this name. An anonymous
    // practice is a request they cannot evaluate — and that holds for a tutor
    // exactly as it does for a counselor.
    for (const accountKind of PROFESSIONAL_KINDS) {
      for (const orgName of [undefined, "", "   "]) {
        const parsed = signupSchema.safeParse({ ...base, accountKind, orgName });
        expect({ accountKind, orgName, ok: parsed.success }).toEqual({
          accountKind,
          orgName,
          ok: false,
        });
      }
    }
  });

  it("does not demand a practice name from a student", () => {
    const parsed = signupSchema.safeParse({ ...base, accountKind: "STUDENT" });
    expect(parsed.success).toBe(true);
  });

  it("still normalizes the email on both paths", () => {
    // The rule that a mixed-case signup can log in afterwards must not be
    // something only the student path gets.
    for (const kind of ACCOUNT_KINDS) {
      const parsed = signupSchema.safeParse({
        ...base,
        accountKind: kind,
        orgName: "Okafor Admissions",
      });
      expect(parsed.success && parsed.data.email).toBe("sam@example.com");
    }
  });
});
