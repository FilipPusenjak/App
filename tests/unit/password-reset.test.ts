// The rules a reset token obeys, tested without a database.
//
// A reset token is a bearer credential for an account holding a minor's
// personal data: anyone with one can take the account over without knowing the
// password. So the properties below are not style preferences — each is the
// thing standing between a leaked link and a compromised account.
import { describe, expect, it } from "vitest";
import {
  RESET_TOKEN_TTL_MINUTES,
  hashResetToken,
  mintResetToken,
  resetTokenExpiry,
  resetTokenMessage,
  resetTokenState,
} from "@/lib/password-reset";

const minutes = (n: number) => n * 60 * 1000;

describe("minting", () => {
  it("never produces the same token twice", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(mintResetToken().token);
    expect(seen.size).toBe(500);
  });

  it("carries enough randomness that guessing is not a strategy", () => {
    // 32 bytes base64url-encoded. Short tokens are the classic way this
    // primitive gets built wrong.
    const { token } = mintResetToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("is URL-safe, because the delivery path is a pasted link", () => {
    for (let i = 0; i < 200; i += 1) {
      // No +, / or = to be mangled by a chat client or a query parser.
      expect(mintResetToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("stores a hash that is not the token", () => {
    // The whole point: a database leak must not yield working links.
    const { token, tokenHash } = mintResetToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).not.toContain(token);
  });

  it("hashes deterministically, so a token can be looked up", () => {
    const { token, tokenHash } = mintResetToken();
    expect(hashResetToken(token)).toBe(tokenHash);
    expect(hashResetToken(`${token}x`)).not.toBe(tokenHash);
  });
});

describe("expiry", () => {
  it("is short enough that a link left in a chat log stops working", () => {
    const now = new Date("2026-08-16T12:00:00Z");
    const expires = resetTokenExpiry(now);
    expect(expires.getTime() - now.getTime()).toBe(minutes(RESET_TOKEN_TTL_MINUTES));
    expect(RESET_TOKEN_TTL_MINUTES).toBeLessThanOrEqual(24 * 60);
  });
});

describe("what state a token is in", () => {
  const now = new Date("2026-08-16T12:00:00Z");
  const future = new Date(now.getTime() + minutes(30));
  const past = new Date(now.getTime() - minutes(30));

  it("accepts an unused token that has not expired", () => {
    expect(resetTokenState({ expiresAt: future, usedAt: null }, now)).toBe("valid");
  });

  it("refuses a token that was already redeemed", () => {
    // Single use is what stops a forwarded link working a second time.
    expect(resetTokenState({ expiresAt: future, usedAt: past }, now)).toBe("used");
  });

  it("refuses a token past its expiry", () => {
    expect(resetTokenState({ expiresAt: past, usedAt: null }, now)).toBe("expired");
  });

  it("refuses a token expiring exactly now", () => {
    // The boundary belongs to "expired": a token valid at its own expiry
    // instant is valid for longer than the TTL claims.
    expect(resetTokenState({ expiresAt: now, usedAt: null }, now)).toBe("expired");
  });

  it("calls a spent-and-expired token spent", () => {
    expect(resetTokenState({ expiresAt: past, usedAt: past }, now)).toBe("used");
  });

  it("treats a missing token as unknown rather than throwing", () => {
    expect(resetTokenState(null, now)).toBe("unknown");
    expect(resetTokenState(undefined, now)).toBe("unknown");
  });
});

describe("what the holder of a bad link is told", () => {
  it("says nothing for a valid token", () => {
    expect(resetTokenMessage("valid")).toBeNull();
  });

  it("gives every failure the same next step", () => {
    // The reasons differ, but all three end at "ask for a new one" — there is
    // nothing else the reader can do, and a message that branches on the
    // reason is a probe an attacker can run against guessed tokens.
    for (const state of ["expired", "used", "unknown"] as const) {
      expect(resetTokenMessage(state)).toMatch(/new one/i);
    }
  });

  it("never reveals whose account a token belongs to", () => {
    for (const state of ["expired", "used", "unknown"] as const) {
      const message = resetTokenMessage(state)!;
      expect(message).not.toMatch(/@/);
      expect(message).not.toMatch(/account for|belongs to|registered/i);
    }
  });
});
