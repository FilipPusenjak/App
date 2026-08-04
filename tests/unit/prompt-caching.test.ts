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

// A cache WRITE costs 2x base input and a read 0.1x, so an entry nobody reads
// is an ~89% surcharge on the cached portion — not a saving. Shipping caching
// as an unconditional default made every run more expensive for anyone who
// evaluates occasionally instead of in bursts, which is most people. These
// tests pin the rule that replaced it: write only when a read is plausible.
describe("a cache entry is written only when one can be read back", () => {
  const original = process.env.ANTHROPIC_CACHE_TTL;
  const withSetting = <T>(value: string | undefined, run: () => T): T => {
    if (value === undefined) delete process.env.ANTHROPIC_CACHE_TTL;
    else process.env.ANTHROPIC_CACHE_TTL = value;
    try {
      return run();
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_CACHE_TTL;
      else process.env.ANTHROPIC_CACHE_TTL = original;
    }
  };
  const ago = (ms: number) => new Date(Date.now() - ms);

  it("does NOT write on a run with no previous run to have warmed it", () => {
    // The first evaluation would otherwise pay 2x for an entry that expires
    // unused far more often than not.
    expect(withSetting(undefined, () => getCacheControl(null))).toBeUndefined();
  });

  it("does NOT write when the last run was too long ago", () => {
    // The exact case that was costing money: run, read it, come back tomorrow.
    expect(
      withSetting(undefined, () => getCacheControl(ago(6 * 60 * 60 * 1000))),
    ).toBeUndefined();
  });

  it("DOES write when the last run is recent enough that an entry survives", () => {
    expect(withSetting(undefined, () => getCacheControl(ago(60_000)))).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("leaves a margin rather than betting on the last second of the window", () => {
    // An entry that expired moments ago costs 2x instead of the 0.1x it was
    // gambling on, so the edge of the window is not treated as a hit.
    expect(
      withSetting(undefined, () => getCacheControl(ago(59 * 60 * 1000))),
    ).toBeUndefined();
    expect(DEFAULT_CACHE_TTL).toBe("1h");
  });

  it("honours the shorter window when asked for it", () => {
    expect(withSetting("5m", () => getCacheControl(ago(60_000)))).toEqual({
      type: "ephemeral",
    });
    // 4 minutes is inside an hour but outside five.
    expect(
      withSetting("5m", () => getCacheControl(ago(4.9 * 60 * 1000))),
    ).toBeUndefined();
  });

  it("can be forced on for steady multi-user traffic", () => {
    expect(withSetting("always", () => getCacheControl(null))).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("can be turned off entirely", () => {
    expect(withSetting("off", () => getCacheControl(ago(60_000)))).toBeUndefined();
  });
});
