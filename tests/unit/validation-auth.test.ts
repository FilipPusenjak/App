// Auth form schemas — most importantly, email normalization.
//
// The bug this pins down: signup lowercased emails on storage but login did
// not normalize before lookup, so anyone who typed "Student@Example.COM" was
// told their password was wrong — forever, on every attempt. Both schemas must
// normalize identically.
import { describe, expect, it } from "vitest";
import { loginSchema, signupSchema } from "@/lib/validation/auth";

describe("loginSchema", () => {
  it("lowercases and trims the email", () => {
    const parsed = loginSchema.parse({
      email: "Student@Example.COM",
      password: "whatever",
    });
    expect(parsed.email).toBe("student@example.com");
  });

  it("rejects a non-email", () => {
    expect(
      loginSchema.safeParse({ email: "not-an-email", password: "x" }).success,
    ).toBe(false);
  });

  it("rejects an empty password", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.com", password: "" }).success,
    ).toBe(false);
  });
});

describe("signupSchema", () => {
  const valid = {
    name: "Test Student",
    email: "new@example.com",
    password: "long-enough-password",
  };

  it("normalizes email the same way login does", () => {
    const fromSignup = signupSchema.parse({
      ...valid,
      email: "MiXeD@Example.Com",
    });
    const fromLogin = loginSchema.parse({
      email: "MiXeD@Example.Com",
      password: "x",
    });
    expect(fromSignup.email).toBe(fromLogin.email);
  });

  it("requires a name", () => {
    expect(signupSchema.safeParse({ ...valid, name: "  " }).success).toBe(false);
  });

  it("requires at least 8 password characters", () => {
    expect(signupSchema.safeParse({ ...valid, password: "short7c" }).success).toBe(
      false,
    );
    expect(
      signupSchema.safeParse({ ...valid, password: "8chars!!" }).success,
    ).toBe(true);
  });

  it("accepts a valid country code and an empty one", () => {
    expect(
      signupSchema.safeParse({ ...valid, countryOfOrigin: "US" }).success,
    ).toBe(true);
    expect(
      signupSchema.safeParse({ ...valid, countryOfOrigin: "" }).success,
    ).toBe(true);
  });

  it("rejects a made-up country code", () => {
    expect(
      signupSchema.safeParse({ ...valid, countryOfOrigin: "ZZ" }).success,
    ).toBe(false);
  });
});
