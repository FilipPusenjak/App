// Reporting whether this deployment can reach the model.
//
// The panel this feeds exists because the two failure modes need opposite
// fixes: a MISSING key falls back to samples, an INVALID key fails with a 401.
// Telling a reader which one they are in is the whole job, so getting the
// boolean backwards would be worse than not having the panel at all.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAiStatus } from "@/lib/ai-status";

const ORIGINAL = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL;
  vi.unstubAllEnvs();
});

describe("AI status", () => {
  it("reports not-live when no key is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(getAiStatus().live).toBe(false);
  });

  it("reports not-live when the key is only whitespace", () => {
    // An env var set to a space is indistinguishable from unset for this
    // purpose, and reporting it as connected would send someone hunting for a
    // 401 that never comes.
    vi.stubEnv("ANTHROPIC_API_KEY", "   ");
    expect(getAiStatus().live).toBe(false);
  });

  it("reports live when a key is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-not-a-real-key");
    expect(getAiStatus().live).toBe(true);
  });

  it("says nothing about the key's validity", () => {
    // It cannot know: only a real call finds that out. The panel's copy has to
    // stay honest about that, so this asserts the shape carries no such claim.
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-obviously-invalid");
    const status = getAiStatus();
    expect(status.live).toBe(true);
    expect(Object.keys(status).sort()).toEqual(
      [
        "baselineModel",
        "expectedNameIsEmpty",
        "followupModel",
        "live",
        "nearMissEnvNames",
      ].sort(),
    );
  });

  it("never returns the key or any part of it", () => {
    // A prefix on a page is a prefix in every screenshot of that page.
    const key = "sk-ant-SECRETVALUE123456";
    vi.stubEnv("ANTHROPIC_API_KEY", key);
    const serialized = JSON.stringify(getAiStatus());
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("sk-ant");
    for (let n = 6; n <= key.length; n++) {
      expect(serialized).not.toContain(key.slice(0, n));
    }
  });

  it("reports the models a run would actually use", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-x");
    vi.stubEnv("ANTHROPIC_MODEL", "");
    vi.stubEnv("ANTHROPIC_FOLLOWUP_MODEL", "");
    const status = getAiStatus();
    expect(status.baselineModel).toBe("claude-opus-5");
    expect(status.followupModel).toBe("claude-sonnet-5");
  });

  it("shows a misconfigured override rather than hiding it", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-x");
    vi.stubEnv("ANTHROPIC_MODEL", "typo-model-name");
    expect(getAiStatus().baselineModel).toBe("typo-model-name");
  });

  it("reports follow-ups disabled as such", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-x");
    vi.stubEnv("ANTHROPIC_FOLLOWUP_MODEL", "off");
    expect(getAiStatus().followupModel).toBeNull();
  });
});

describe("catching a name that only looks right", () => {
  it("flags a trailing space in the variable name", () => {
    // Invisible in a dashboard, and a different variable entirely. This is the
    // failure that is otherwise impossible to see from the outside.
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY ", "sk-ant-x");
    const status = getAiStatus();
    expect(status.live).toBe(false);
    expect(status.nearMissEnvNames).toContain("ANTHROPIC_API_KEY ");
  });

  it("flags a zero-width character in the name", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY​", "sk-ant-x");
    expect(getAiStatus().nearMissEnvNames).toContain("ANTHROPIC_API_KEY​");
  });

  it("flags an outright misspelling", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_APIKEY", "sk-ant-x");
    expect(getAiStatus().nearMissEnvNames).toContain("ANTHROPIC_APIKEY");
  });

  it("does not list the correct name as a near miss", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-x");
    expect(getAiStatus().nearMissEnvNames).not.toContain("ANTHROPIC_API_KEY");
  });

  it("reports an empty value under the right name separately from a missing one", () => {
    // "Set to nothing" and "not set" look the same in a dashboard and need
    // different fixes, so they are reported apart.
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(getAiStatus().expectedNameIsEmpty).toBe(true);
  });

  it("never leaks a value while reporting a name", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY ", "sk-ant-SECRETLEAKCANARY");
    const serialized = JSON.stringify(getAiStatus());
    expect(serialized).toContain("ANTHROPIC_API_KEY ");
    expect(serialized).not.toContain("SECRETLEAKCANARY");
    expect(serialized).not.toContain("sk-ant");
  });
});
