// Prompt caching, and the property the whole saving rests on.
//
// Around 89% of an evaluation's input is byte-identical on every run: the
// system prompt (~5,700 tokens) and the rubrics (~6,500), against roughly
// 1,500 tokens of actual student profile. Caching is a PREFIX match, so that
// only pays off while the stable text genuinely comes first and nothing
// volatile is interpolated into it.
//
// These tests exist because that property is silently breakable. Putting a
// date, a school name or a score anywhere in the rubric section would produce
// a distinct cache entry per student per run — every request paying the 1.25x
// or 2x WRITE price and never reading. That is worse than no caching at all,
// and nothing about the output would look wrong.
import { describe, expect, it } from "vitest";
import { buildUserPrompt, buildUserPromptParts } from "@/lib/prompts/evaluation";
import { buildUserPromptParts as buildProjectionParts } from "@/lib/prompts/projection";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import { buildProjectionSnapshot } from "@/lib/evaluation/projection-snapshot";
import { buildDiff } from "@/lib/evaluation/diff";
import { DEFAULT_CACHE_TTL, getCacheControl } from "@/lib/anthropic";

function profileOf(overrides: {
  gpa?: number;
  items?: string[];
  major?: string;
}) {
  return {
    gradeLevel: "Grade 9",
    schoolName: "A Competitive School",
    schoolContext: "Full IB offered.",
    curriculum: "ib",
    gpa: overrides.gpa ?? 96,
    gpaScale: "100",
    intendedMajor: overrides.major ?? "Medicine",
    careerGoal: "Doctor",
    testScores: [],
    resumeItems: (overrides.items ?? ["Chemistry Club"]).map((title, n) => ({
      id: `i${n}`,
      type: "extracurricular",
      title,
      org: null,
      description: null,
      startDate: null,
      endDate: null,
      hoursPerWeek: null,
      evidenceNotes: null,
    })),
    targetSchools: [
      { name: "Oxford", country: "GB", course: "Medicine", classification: null, priority: null, notes: null },
      { name: "Cornell", country: "US", course: "Biology", classification: null, priority: null, notes: null },
    ],
  };
}

const snapshot = (o: Parameters<typeof profileOf>[0] = {}) =>
  buildSnapshot(profileOf(o), "CA");

describe("the cacheable prefix is genuinely stable", () => {
  it("is identical for two completely different students", () => {
    // Same target countries, nothing else in common. If this ever differs,
    // every student writes their own cache entry and reads nobody's.
    const a = buildUserPromptParts(snapshot({ gpa: 96, items: ["Chemistry Club"] }));
    const b = buildUserPromptParts(
      snapshot({ gpa: 62, items: ["Chess", "Football", "Choir"], major: "History" }),
    );
    expect(a.stable).toBe(b.stable);
  });

  it("is identical across runs of the same student with a previous evaluation", () => {
    const first = buildUserPromptParts(snapshot(), null);
    const second = buildUserPromptParts(
      snapshot(),
      buildDiff(snapshot(), snapshot({ items: ["Chemistry Club", "Debate"] }), {
        overallScore: 30,
        gradeRelativeScore: 70,
        fitScores: { Oxford: 25 },
      }),
    );
    expect(second.stable).toBe(first.stable);
  });

  it("contains no student-specific text at all", () => {
    // Deliberately values that could only come from this student. Words like
    // "Medicine" and "Grade 9" appear in the rubrics' own text — the UK rubric
    // names oversubscribed courses, the US one labels its stages — so they are
    // not evidence of a leak.
    const { stable } = buildUserPromptParts(snapshot());
    for (const leak of [
      "96",
      "Doctor",
      "Chemistry Club",
      "A Competitive School",
      "Oxford",
      "Cornell",
    ]) {
      expect(stable).not.toContain(leak);
    }
  });

  it("carries no date or time, which would defeat caching invisibly", () => {
    const { stable } = buildUserPromptParts(snapshot());
    expect(stable).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(stable).not.toMatch(/\d{2}:\d{2}/);
  });

  it("holds the bulk of the prompt — otherwise caching is not worth doing", () => {
    const { stable, variable } = buildUserPromptParts(snapshot());
    expect(stable.length).toBeGreaterThan(variable.length * 2);
  });

  it("splits without changing the prompt the model receives", () => {
    const { stable, variable } = buildUserPromptParts(snapshot());
    expect(buildUserPrompt(snapshot())).toBe(`${stable}\n\n${variable}`);
  });

  it("puts the student's data AFTER the breakpoint, where it belongs", () => {
    const { variable } = buildUserPromptParts(snapshot());
    expect(variable).toContain("Chemistry Club");
    expect(variable).toContain("Oxford");
  });
});

describe("the projection prompt splits the same way", () => {
  function projectionSnapshot(major: string) {
    return buildProjectionSnapshot(
      profileOf({ major }),
      "CA",
      [
        {
          id: "p1",
          type: "leadership",
          title: "Start a club",
          org: null,
          description: null,
          targetDate: null,
          hoursPerWeek: 1,
        },
      ],
      { evaluationId: null, capturedAt: null, overallScore: null, systemReadiness: {} },
    );
  }

  it("shares a prefix across different students", () => {
    expect(buildProjectionParts(projectionSnapshot("Medicine")).stable).toBe(
      buildProjectionParts(projectionSnapshot("History")).stable,
    );
  });

  it("keeps the plans out of the cached part", () => {
    const parts = buildProjectionParts(projectionSnapshot("Medicine"));
    expect(parts.stable).not.toContain("Start a club");
    expect(parts.variable).toContain("Start a club");
  });
});

describe("the cache TTL is a deliberate choice, not a default", () => {
  const original = process.env.ANTHROPIC_CACHE_TTL;
  const withTtl = (value: string | undefined) => {
    if (value === undefined) delete process.env.ANTHROPIC_CACHE_TTL;
    else process.env.ANTHROPIC_CACHE_TTL = value;
    try {
      return getCacheControl();
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_CACHE_TTL;
      else process.env.ANTHROPIC_CACHE_TTL = original;
    }
  };

  it("defaults to an hour, matching how a student actually iterates", () => {
    // Read the result, edit the profile, run again — gaps a 5-minute cache
    // almost never survives.
    expect(DEFAULT_CACHE_TTL).toBe("1h");
    expect(withTtl(undefined)).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("allows the short TTL for bursty use", () => {
    // Writes cost 1.25x at 5 minutes against 2x at an hour, so this pays from
    // the second run rather than the third.
    expect(withTtl("5m")).toEqual({ type: "ephemeral" });
  });

  it("can be turned off entirely", () => {
    // A student who runs once and stops pays the write premium for nothing.
    expect(withTtl("off")).toBeUndefined();
  });
});
