// Reporting which build is answering.
//
// Exists because "the deployment is X" and "this page came from X" turned out
// to be different claims during a long debugging session, and every conclusion
// drawn from a page is about whichever build actually served it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDeploymentInfo } from "@/lib/deployment-info";

afterEach(() => vi.unstubAllEnvs());

describe("deployment info", () => {
  it("shortens the commit SHA to what a dashboard shows", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "b6a14dcabcdef1234567890abcdef1234567890a");
    expect(getDeploymentInfo().commit).toBe("b6a14dc");
  });

  it("reports the environment, which is what scopes the variables", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(getDeploymentInfo().environment).toBe("preview");
  });

  it("returns nulls off-host rather than inventing a build identity", () => {
    // Locally there is no deployment; claiming one would be worse than silence.
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("GIT_COMMIT_SHA", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "");
    expect(getDeploymentInfo()).toEqual({
      commit: null,
      environment: null,
      branch: null,
    });
  });

  it("carries nothing sensitive", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "b6a14dcabcdef1234567890");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-SHOULDNEVERAPPEAR");
    vi.stubEnv("DATABASE_URL", "postgresql://u:PASSWORD@host/db");
    const serialized = JSON.stringify(getDeploymentInfo());
    expect(serialized).not.toContain("SHOULDNEVERAPPEAR");
    expect(serialized).not.toContain("PASSWORD");
    expect(serialized).not.toContain("postgresql");
  });
});
