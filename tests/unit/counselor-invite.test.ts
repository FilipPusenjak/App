// The invite code, and the direction the invitation runs.
//
// The property worth testing hardest is not the code's entropy — it is that a
// code arrives through a human (read aloud, pasted, retyped with hyphens
// somebody added) and must survive that journey without either rejecting a
// correct code or accepting a wrong one.
import { describe, expect, it } from "vitest";
import {
  INVITE_TTL_DAYS,
  formatInviteCode,
  generateInviteCode,
  inviteExpiryFrom,
  isWellFormedInviteCode,
  normalizeInviteCode,
} from "@/lib/counselor/invite";

describe("generating a code", () => {
  it("produces something a person can read aloud without ambiguity", () => {
    // 0/O, 1/I/L and 5/S are the pairs that get misheard and mistyped. A code
    // containing one turns "it does not work" into a support conversation.
    for (let i = 0; i < 500; i++) {
      expect(generateInviteCode()).not.toMatch(/[01ILOS]/);
    }
  });

  it("is well formed by its own definition", () => {
    for (let i = 0; i < 200; i++) {
      expect(isWellFormedInviteCode(generateInviteCode())).toBe(true);
    }
  });

  it("does not repeat itself across a realistic number of students", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateInviteCode());
    expect(seen.size).toBe(5000);
  });
});

describe("reading a code back", () => {
  it("forgives every way a human passes one along", () => {
    const code = generateInviteCode();
    const mangled = [
      code.toLowerCase(),
      `  ${code}  `,
      formatInviteCode(code),
      `${code.slice(0, 3)} ${code.slice(3)}`,
      formatInviteCode(code).toLowerCase(),
    ];
    for (const m of mangled) {
      expect(normalizeInviteCode(m)).toBe(code);
      expect(isWellFormedInviteCode(m)).toBe(true);
    }
  });

  it("rejects anything that is not a code of ours", () => {
    // Including the near misses: a code with an ambiguous character has been
    // mistyped by definition, and accepting it would look up nothing anyway.
    const bad = [
      "",
      "   ",
      "ABCDE",
      "ABCDEFGHJKM",
      "ABCDEFGHJ0", // contains a zero
      "ABCDEFGHJI", // contains an I
      "ABCDEFGH-J", // a hyphen inside is stripped, leaving nine
      "../../etc/passwd",
      "ABCDEFGHJ;",
    ];
    for (const b of bad) {
      expect({ b, ok: isWellFormedInviteCode(b) }).toEqual({ b, ok: false });
    }
  });
});

describe("expiry", () => {
  it("is a fixed window from the moment it was issued", () => {
    const now = new Date("2026-08-21T09:00:00Z");
    const expires = inviteExpiryFrom(now);
    expect(expires.getTime() - now.getTime()).toBe(INVITE_TTL_DAYS * 86_400_000);
    expect(expires.toISOString()).toBe("2026-09-04T09:00:00.000Z");
  });
});
