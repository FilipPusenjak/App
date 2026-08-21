// Which kind of account signup creates.
//
// The one field on this form that is a privilege decision rather than a
// preference: STUDENT holds only its own data, COUNSELOR opens a caseload that
// will hold other families' children under revocable grants. So the interesting
// cases are not the happy paths — they are what happens when the field is
// missing, empty, or something nobody put there on purpose.
import { describe, expect, it } from "vitest";
import { ACCOUNT_KINDS, signupSchema } from "@/lib/validation/auth";

const base = {
  name: "Sam Okafor",
  email: "Sam@Example.com",
  password: "a-real-password",
};

describe("choosing an account kind", () => {
  it("offers exactly two, and no third", () => {
    expect([...ACCOUNT_KINDS]).toEqual(["STUDENT", "COUNSELOR"]);
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

  it("refuses anything that is not one of the two", () => {
    for (const junk of ["", "counselor", "ADMIN", "STUDENT ", 1, null, true]) {
      const parsed = signupSchema.safeParse({ ...base, accountKind: junk });
      expect({ junk, ok: parsed.success }).toEqual({ junk, ok: false });
    }
  });

  it("will not open a caseload without a name students can recognise", () => {
    // A family deciding whether to grant access sees this name. An anonymous
    // practice is a request they cannot evaluate.
    for (const orgName of [undefined, "", "   "]) {
      const parsed = signupSchema.safeParse({
        ...base,
        accountKind: "COUNSELOR",
        orgName,
      });
      expect({ orgName, ok: parsed.success }).toEqual({ orgName, ok: false });
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
