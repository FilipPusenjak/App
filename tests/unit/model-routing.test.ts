// Which model an evaluation runs on, and what it is called on screen.
//
// Two rules that have to hold together. Every evaluation runs on the full
// model unless a follow-up model is deliberately configured — and the page
// names the model a row ACTUALLY ran on, so it stays true for rows written
// under an earlier default.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL,
  getCheckInModel,
  getFollowupModel,
} from "@/lib/anthropic";
import { modelLabel } from "@/lib/model-label";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("which model a check-in runs on", () => {
  it("runs on the full model when no follow-up model is configured", () => {
    vi.stubEnv("ANTHROPIC_MODEL", "");
    vi.stubEnv("ANTHROPIC_FOLLOWUP_MODEL", "");
    expect(getFollowupModel()).toBeNull();
    expect(getCheckInModel()).toBe(DEFAULT_MODEL);
  });

  it("runs on the full model when follow-ups are switched off", () => {
    // "off" has always meant every evaluation on the full model. The route
    // used to fall back to Sonnet here, which made that false for check-ins.
    vi.stubEnv("ANTHROPIC_MODEL", "");
    vi.stubEnv("ANTHROPIC_FOLLOWUP_MODEL", "off");
    expect(getCheckInModel()).toBe(DEFAULT_MODEL);
  });

  it("follows an explicitly configured follow-up model", () => {
    // The routing is intact, not removed — configuring it brings it back.
    vi.stubEnv("ANTHROPIC_FOLLOWUP_MODEL", "claude-sonnet-5");
    expect(getCheckInModel()).toBe("claude-sonnet-5");
  });

  it("follows an overridden full model", () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-opus-5");
    vi.stubEnv("ANTHROPIC_FOLLOWUP_MODEL", "");
    expect(getCheckInModel()).toBe("claude-opus-5");
  });

  it("defaults the full model to Opus 5.5", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-5-5");
  });
});

describe("naming the model a row ran on", () => {
  it("names the models production has actually used", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelLabel("claude-opus-5")).toBe("Claude Opus 5");
    expect(modelLabel("claude-sonnet-5")).toBe("Claude Sonnet 5");
  });

  it("shows an unknown id as itself rather than guessing a name", () => {
    // Still exactly which model ran — just less readable. A guessed name
    // could be wrong; the id cannot.
    expect(modelLabel("claude-future-9")).toBe("claude-future-9");
  });
});
