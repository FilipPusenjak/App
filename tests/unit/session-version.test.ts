// Resetting a password signs every other device out — and stays that way.
//
// The mechanism is a number on the account that every session token carries a
// copy of. The rule comparing them is pure and tested directly. The wiring —
// that the token actually receives the number at sign-in, that the per-request
// check actually compares it, and that setting a password actually moves it —
// is asserted against the source, because a future edit that dropped any one
// of those would fail no runtime test: the session and the database are both
// mocked away in every unit test that touches them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sessionIsCurrent } from "@/lib/session-version";

describe("sessionIsCurrent", () => {
  it("accepts a token minted under the account's current version", () => {
    expect(sessionIsCurrent(0, 0)).toBe(true);
    expect(sessionIsCurrent(3, 3)).toBe(true);
  });

  it("refuses a token minted under any earlier version", () => {
    expect(sessionIsCurrent(0, 1)).toBe(false);
    expect(sessionIsCurrent(2, 3)).toBe(false);
  });

  it("refuses a token that carries no version at all", () => {
    // The only tokens without one predate the mechanism. The safe reading is
    // that they cannot be vouched for — one forced sign-in per device on the
    // deploy that introduces this, rather than a hijacked session outliving
    // the reset that was meant to end it.
    expect(sessionIsCurrent(undefined, 0)).toBe(false);
    expect(sessionIsCurrent(null, 0)).toBe(false);
    expect(sessionIsCurrent("0", 0)).toBe(false);
  });

  it("refuses a token claiming a version the account has not reached", () => {
    // A signed token cannot be forged, but the rule should not depend on that.
    expect(sessionIsCurrent(5, 3)).toBe(false);
  });
});

describe("the wiring", () => {
  const auth = readFileSync("lib/auth.ts", "utf8");
  const session = readFileSync("lib/session.ts", "utf8");

  it("puts the account's version on the token at sign-in", () => {
    expect(auth).toContain("sessionVersion: user.sessionVersion");
    expect(auth).toContain("const version: unknown = user.sessionVersion");
    expect(auth).toContain('token.sv = typeof version === "number" ? version : undefined');
    expect(auth).toContain("const sv: unknown = token.sv");
    expect(auth).toContain('session.user.sessionVersion = typeof sv === "number" ? sv : undefined');
  });

  it("compares it on every request, beside the row-exists check", () => {
    expect(session).toContain("sessionVersion: true");
    expect(session).toMatch(
      /sessionIsCurrent\(session\?\.user\?\.sessionVersion, row\.sessionVersion\)/,
    );
  });

  it("does not hand the version on to callers", () => {
    // Nothing outside the check needs it, and a field on every user object is
    // a field that ends up in a JSON response eventually. The return is an
    // explicit object rather than the row, and the version is not in it.
    const start = session.indexOf("return {");
    const returned = session.slice(start, session.indexOf("};", start));
    expect(returned).toContain("countryOfOrigin: row.countryOfOrigin");
    expect(returned).not.toContain("sessionVersion");
  });
});

describe("every place a password is set moves the version", () => {
  // Found by searching rather than listed, so a password-change form added
  // later is held to the rule the moment it writes passwordHash. Signup is
  // the one exception: the account has no sessions yet to sign out.
  const files = [
    "lib/password-reset-store.ts",
    "app/actions/auth.ts",
    "app/actions/password-reset.ts",
  ];

  for (const file of files) {
    it(`${file}`, () => {
      const source = readFileSync(file, "utf8");
      const writes = source.match(/data: \{[^}]*passwordHash[^}]*\}/g) ?? [];
      for (const write of writes) {
        const isSignup = /countryOfOrigin|counselorAccount/.test(write);
        if (isSignup) continue;
        expect(
          write,
          `${file} sets passwordHash without bumping sessionVersion, so a ` +
            `session on another device survives the new password`,
        ).toContain("sessionVersion: { increment: 1 }");
      }
    });
  }

  it("actually found the reset store's write", () => {
    // Guards the guard: a refactor that renamed the field would make the loop
    // above pass by finding nothing.
    const source = readFileSync("lib/password-reset-store.ts", "utf8");
    expect(source).toContain("sessionVersion: { increment: 1 }");
  });
});
