// SIGNUP_ALLOWED_EMAILS — the gate that stops strangers on a deployed instance
// from creating accounts that spend the owner's API credits.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEmailAllowedToSignUp,
  isSignupRestricted,
} from "@/lib/signup-access";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with no allowlist configured", () => {
  it("registration is open (the local-dev default)", () => {
    vi.stubEnv("SIGNUP_ALLOWED_EMAILS", "");
    expect(isSignupRestricted()).toBe(false);
    expect(isEmailAllowedToSignUp("anyone@example.com")).toBe(true);
  });
});

describe("with an allowlist configured", () => {
  it("only listed addresses may register", () => {
    vi.stubEnv("SIGNUP_ALLOWED_EMAILS", "kid@example.com,parent@example.com");
    expect(isSignupRestricted()).toBe(true);
    expect(isEmailAllowedToSignUp("kid@example.com")).toBe(true);
    expect(isEmailAllowedToSignUp("parent@example.com")).toBe(true);
    expect(isEmailAllowedToSignUp("stranger@example.com")).toBe(false);
  });

  it("matches case-insensitively and ignores stray whitespace", () => {
    vi.stubEnv("SIGNUP_ALLOWED_EMAILS", "  Kid@Example.com ,, ");
    expect(isEmailAllowedToSignUp("kid@example.com")).toBe(true);
    expect(isEmailAllowedToSignUp("KID@EXAMPLE.COM")).toBe(true);
    expect(isEmailAllowedToSignUp("other@example.com")).toBe(false);
  });
});
