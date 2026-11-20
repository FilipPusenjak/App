// The application document builder's rules, without a database.
//
// The integration side — entitlement on every route, contact details never
// stored, answers written to the profile, exports immutable — is in
// tests/integration/documents.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  detectGaps,
  mapEntryFields,
  suggestSelection,
  type ActivitySource,
} from "@/lib/documents/activities";
import { checkFidelity } from "@/lib/documents/fidelity";
import {
  COMMON_APP_LIMITS,
  charCount,
  currentCycle,
  cycleFor,
  limitsFor,
} from "@/lib/documents/limits";
import {
  applyEdit,
  applyGenerated,
  emptyCommonAppFields,
  entryKey,
  reconcileCommonApp,
  validateOrder,
  type CommonAppFields,
} from "@/lib/documents/fields";
import {
  compressEntries,
  compressionSourceHash,
  type CompressionCacheStore,
  type CompressionEntry,
  type MessagesClient,
} from "@/lib/documents/compress";
import { commonAppExportProblems } from "@/lib/documents/fields";
import { checkGrammarOnly } from "@/lib/documents/grammar";
import { MIN_FONT_SIZE, renderResumePdf, type ResumeContent } from "@/lib/documents/resume-pdf";
import { lockedPreview } from "@/lib/documents/preview";
import * as sample from "@/lib/documents/sample";
import { capDecision, REGENERATION_CAPS } from "@/lib/documents/caps";

const LIMITS = limitsFor("2026-27");

function activity(over: Partial<ActivitySource> = {}): ActivitySource {
  return {
    id: "a1",
    itemType: "extracurricular",
    title: "Robotics club",
    org: "Lakeview High",
    positionTitle: null,
    commonAppType: "Robotics",
    gradeLevels: [10, 11],
    timing: "SCHOOL_YEAR",
    hoursPerWeek: 4,
    weeksPerYear: 30,
    facts: ["Built the drivetrain for the 2026 robot", "Attended weekly build meetings"],
    description: "I attend weekly meetings and help build the robot.",
    evidenceNotes: null,
    startDate: "2024-09-01",
    endDate: null,
    startGrade: 10,
    endGrade: null,
    rung: "contributor",
    ...over,
  };
}

function entry(over: Partial<ActivitySource> = {}): CompressionEntry {
  const source = activity(over);
  return { entryId: source.id, source, limit: LIMITS.description, position: "", organization: source.org ?? "" };
}

/** A model stub: answers with whatever `reply` returns for the entries it was sent. */
function stubClient(reply: (ids: string[], call: number) => Record<string, string>) {
  let calls = 0;
  const client: MessagesClient = {
    messages: {
      async create(args) {
        calls += 1;
        const user = (args.messages as { content: string }[])[0]!.content;
        const ids = (JSON.parse(user) as { entries: { entryId: string }[] }).entries.map((e) => e.entryId);
        const out = reply(ids, calls);
        return {
          content: [
            { type: "text", text: JSON.stringify({ entries: Object.entries(out).map(([entryId, description]) => ({ entryId, description })) }) },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        };
      },
    },
  };
  return { client, calls: () => calls };
}

function memoryCache(seed: Record<string, string> = {}): CompressionCacheStore & { store: Map<string, string> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    get: async (h) => store.get(h) ?? null,
    put: async (h, o) => {
      store.set(h, o);
    },
  };
}

// ─── Limits ───────────────────────────────────────────────────────────────────

describe("Common App limits", () => {
  it("cover the current application cycle", () => {
    // Fails the day a new cycle starts without a checked entry for it.
    expect(COMMON_APP_LIMITS[currentCycle()]).toBeDefined();
    expect(() => limitsFor(currentCycle())).not.toThrow();
  });

  it("hold the values in the 2026–27 first-year guide", () => {
    expect(COMMON_APP_LIMITS["2026-27"]).toEqual({
      maxActivities: 10,
      position: 50,
      organization: 100,
      description: 150,
      maxHonors: 5,
      honorTitle: 100,
    });
  });

  it("start a new cycle on 1 August", () => {
    expect(cycleFor(new Date("2026-07-31T23:59:59Z"))).toBe("2025-26");
    expect(cycleFor(new Date("2026-08-01T00:00:00Z"))).toBe("2026-27");
  });

  it("refuse a cycle nobody has checked", () => {
    expect(() => limitsFor("2031-32")).toThrow();
  });
});

// ─── Fidelity ─────────────────────────────────────────────────────────────────

describe("the fidelity check", () => {
  const source = ["Attended weekly meetings", "Helped sort donations at the food bank"];

  it("rejects a number the student never entered", () => {
    const v = checkFidelity("Sorted 400 donations at weekly meetings", source);
    expect(v.map((x) => [x.kind, x.token])).toContainEqual(["number", "400"]);
  });

  it("rejects a number written as a word", () => {
    const v = checkFidelity("Attended three weekly meetings", source);
    expect(v.some((x) => x.kind === "number" && x.token.toLowerCase() === "three")).toBe(true);
  });

  it('flags "led" when the student only attended', () => {
    const v = checkFidelity("Led weekly meetings", source);
    expect(v.some((x) => x.kind === "verb" && /^led$/i.test(x.token))).toBe(true);
  });

  it("flags an organization the student never named", () => {
    const v = checkFidelity("Helped sort donations for UNICEF", source);
    expect(v.some((x) => x.kind === "proper_noun" && x.token === "UNICEF")).toBe(true);
  });

  it("passes an honest rephrasing", () => {
    expect(checkFidelity("Attend weekly meetings; help sort food bank donations", source)).toEqual([]);
  });
});

// ─── Field mapping and gaps ───────────────────────────────────────────────────

describe("mapping an activity to Common App fields", () => {
  it("leaves position empty when the student entered none", () => {
    expect(mapEntryFields(activity({ positionTitle: null }), LIMITS).position.value).toBe("");
  });

  it("flags an organization over its limit instead of cutting it", () => {
    const long = "A".repeat(LIMITS.organization + 7);
    const m = mapEntryFields(activity({ org: long }), LIMITS);
    expect(m.organization.value).toBe(long);
    expect(m.organization.overLimit).toBe(true);
  });

  it("asks about every missing Common App answer, as a question about this activity", () => {
    const gaps = detectGaps(
      activity({ commonAppType: null, gradeLevels: [], timing: null, hoursPerWeek: null, weeksPerYear: null, facts: [] }),
    );
    expect(gaps.map((g) => g.field).sort()).toEqual(
      ["commonAppType", "facts", "gradeLevels", "hoursPerWeek", "timing", "weeksPerYear"].sort(),
    );
    expect(gaps.find((g) => g.field === "weeksPerYear")!.question).toBe("How many weeks a year did you do Robotics club?");
  });
});

// ─── Selection ────────────────────────────────────────────────────────────────

describe("the suggested selection", () => {
  const list = [
    activity({ id: "low", title: "Chess", rung: "participant", hoursPerWeek: 1, weeksPerYear: 10, gradeLevels: [12] }),
    activity({ id: "high", title: "Food bank", rung: "leader", hoursPerWeek: 6, weeksPerYear: 40, startDate: "2022-09-01" }),
    ...Array.from({ length: 10 }, (_, i) => activity({ id: `m${i}`, title: `Club ${i}`, rung: "sustained" })),
  ];

  it("is deterministic, gives every activity a reason, and caps at the maximum", () => {
    const a = suggestSelection(list, { maxActivities: 10, intendedMajor: null });
    const b = suggestSelection([...list].reverse(), { maxActivities: 10, intendedMajor: null });
    expect(a).toEqual(b);
    expect(a.order).toHaveLength(10);
    expect(a.order[0]).toBe("high");
    expect(a.notSelected).toContain("low");
    for (const x of list) expect(a.reasons[x.id]).toBeTruthy();
  });
});

// ─── Student edits win; order is never changed for them ───────────────────────

describe("drafts", () => {
  const sources = [activity({ id: "a" }), activity({ id: "b", title: "Band" }), activity({ id: "c", title: "Choir" })];
  const base = (): CommonAppFields => {
    const f = emptyCommonAppFields({ order: ["a", "b", "c"], reasons: {}, notSelected: [] });
    for (const s of sources) {
      f.entries[s.id] = { position: "", organization: "", description: "", descriptionStatus: "empty", descriptionSourceHash: null, flag: null };
    }
    return f;
  };

  it("never lets regeneration overwrite an edited description", () => {
    const edited = applyEdit(base(), [], "a", "description", "My own words");
    const regen = applyGenerated(edited.fields, edited.editedFieldKeys, [
      { entryId: "a", description: "Generated A", sourceHash: "h1", flag: null },
      { entryId: "b", description: "Generated B", sourceHash: "h2", flag: null },
    ]);
    expect(regen.fields.entries.a!.description).toBe("My own words");
    expect(regen.fields.entries.b!.description).toBe("Generated B");
    expect(regen.skipped).toEqual(["a"]);
    expect(edited.editedFieldKeys).toEqual([entryKey("a", "description")]);
  });

  it("keeps a confirmed order even when the suggestion changes", () => {
    const confirmed = { ...base(), order: ["c", "a", "b"] };
    const next = reconcileCommonApp({
      fields: confirmed,
      activities: sources,
      mapped: {},
      suggestion: { order: ["a", "b", "c"], reasons: {}, notSelected: [] },
      orderConfirmed: true,
      editedFieldKeys: [],
    });
    expect(next.order).toEqual(["c", "a", "b"]);
  });

  it("drops a deleted activity from a confirmed order without moving the rest", () => {
    const next = reconcileCommonApp({
      fields: { ...base(), order: ["c", "a", "b"] },
      activities: sources.filter((s) => s.id !== "a"),
      mapped: {},
      suggestion: { order: ["b", "c"], reasons: {}, notSelected: [] },
      orderConfirmed: true,
      editedFieldKeys: [],
    });
    expect(next.order).toEqual(["c", "b"]);
  });

  it("keeps an edited position when the profile changes", () => {
    const edited = applyEdit(base(), [], "a", "position", "Treasurer");
    const next = reconcileCommonApp({
      fields: edited.fields,
      activities: sources,
      mapped: { a: { position: "Member", organization: "X" } },
      suggestion: { order: ["a", "b", "c"], reasons: {}, notSelected: [] },
      orderConfirmed: false,
      editedFieldKeys: edited.editedFieldKeys,
    });
    expect(next.entries.a!.position).toBe("Treasurer");
    expect(next.entries.a!.organization).toBe("X");
  });

  it("validates an order without adjusting it", () => {
    expect(validateOrder(["a", "a"], ["a"], 10).ok).toBe(false);
    expect(validateOrder(["zz"], ["a"], 10).ok).toBe(false);
    expect(validateOrder(["a", "b"], ["a", "b"], 1).ok).toBe(false);
    expect(validateOrder(["b", "a"], ["a", "b"], 10)).toEqual({ ok: true });
  });

  it("refuses to export a description over its limit, or an unconfirmed order", () => {
    const f = base();
    f.entries.a!.description = "x".repeat(LIMITS.description + 1);
    expect(commonAppExportProblems(f, LIMITS, true)).toHaveLength(1);
    expect(commonAppExportProblems(base(), LIMITS, false)).toHaveLength(1);
    expect(commonAppExportProblems(base(), LIMITS, true)).toEqual([]);
  });
});

// ─── Compression ──────────────────────────────────────────────────────────────

describe("compression", () => {
  it("makes zero model calls on a cache hit", async () => {
    const e = entry();
    const cache = memoryCache({ [compressionSourceHash(e)]: "Built the drivetrain; attend weekly build meetings" });
    const { client, calls } = stubClient(() => ({}));
    const run = await compressEntries({ entries: [e], client, model: "m", cache });
    expect(calls()).toBe(0);
    expect(run.modelCalls).toBe(0);
    expect(run.cacheHits).toBe(1);
    expect(run.results[0]!.description).toBe("Built the drivetrain; attend weekly build meetings");
  });

  it("retries once with the overage stated, then flags rather than truncating", async () => {
    const long = "Built the drivetrain and attended weekly build meetings ".repeat(4).trim();
    expect(charCount(long)).toBeGreaterThan(LIMITS.description);
    const { client, calls } = stubClient((ids) => Object.fromEntries(ids.map((id) => [id, long])));
    const run = await compressEntries({ entries: [entry()], client, model: "m", cache: memoryCache() });
    expect(calls()).toBe(2);
    const r = run.results[0]!;
    expect(r.flag?.kind).toBe("over_limit");
    expect(r.description).toBe(long); // not cut
  });

  it("retries an inflated description once, then flags it with the offending word", async () => {
    const { client, calls } = stubClient((ids) => Object.fromEntries(ids.map((id) => [id, "Led the drivetrain team at weekly build meetings"])));
    const run = await compressEntries({ entries: [entry()], client, model: "m", cache: memoryCache() });
    expect(calls()).toBe(2);
    const r = run.results[0]!;
    expect(r.flag?.kind).toBe("fidelity");
    expect(r.flag?.tokens).toContain("Led");
    expect(run.fidelityFailures).toHaveLength(2);
    expect(run.fidelityFailures[0]!.model).toBe("m");
  });

  it("accepts an honest retry and caches it", async () => {
    const cache = memoryCache();
    const { client } = stubClient((ids, call) =>
      Object.fromEntries(ids.map((id) => [id, call === 1 ? "Led weekly build meetings" : "Built the drivetrain; attend weekly build meetings"])),
    );
    const run = await compressEntries({ entries: [entry()], client, model: "m", cache });
    expect(run.results[0]!.flag).toBeNull();
    expect(cache.store.size).toBe(1);
  });

  it("never sends an activity with nothing to describe", async () => {
    const { client, calls } = stubClient(() => ({}));
    const run = await compressEntries({
      entries: [entry({ facts: [], description: null, evidenceNotes: null })],
      client,
      model: "m",
      cache: memoryCache(),
    });
    expect(calls()).toBe(0);
    expect(run.results[0]!.flag?.kind).toBe("no_content");
  });

  it("produces no accepted description over the limit", async () => {
    const lengths = [40, 149, 150, 151, 300];
    const entries = lengths.map((_, i) => entry({ id: `e${i}` }));
    const { client } = stubClient((ids) =>
      Object.fromEntries(ids.map((id) => [id, "Built the drivetrain ".padEnd(lengths[Number(id.slice(1))]!, ".")])),
    );
    const run = await compressEntries({ entries, client, model: "m", cache: memoryCache() });
    for (const r of run.results) {
      if (r.flag === null) expect(charCount(r.description)).toBeLessThanOrEqual(LIMITS.description);
    }
  });
});

// ─── Grammar fixes ────────────────────────────────────────────────────────────

describe("grammar-only fixes", () => {
  it("accepts spelling and punctuation corrections", () => {
    expect(checkGrammarOnly("i realy liked teh lab", "I really liked the lab.")).toEqual({ ok: true });
  });

  it("rejects a fix that adds content", () => {
    const r = checkGrammarOnly("I liked the lab", "I passionately loved the advanced lab");
    expect(r.ok).toBe(false);
  });

  it("rejects a fix that drops content", () => {
    expect(checkGrammarOnly("I liked the chemistry lab a lot", "I liked the lab").ok).toBe(false);
  });
});

// ─── Caps ─────────────────────────────────────────────────────────────────────

describe("regeneration caps", () => {
  it("allow 5 list runs and 3 per entry a month", () => {
    expect(REGENERATION_CAPS).toEqual({ LIST_PER_MONTH: 5, ENTRY_PER_MONTH: 3 });
    expect(capDecision("LIST", 4).ok).toBe(true);
    expect(capDecision("LIST", 5).ok).toBe(false);
    expect(capDecision("ENTRY", 3).ok).toBe(false);
  });
});

// ─── Resume ───────────────────────────────────────────────────────────────────

describe("the resume PDF", () => {
  it("never sets text below 10pt", () => {
    expect(MIN_FONT_SIZE).toBeGreaterThanOrEqual(10);
  });

  it("fits one page by cutting the lowest-ranked activities, not by shrinking", async () => {
    const content: ResumeContent = {
      contact: { name: "Test Student" },
      education: { school: "Lakeview High School", detail: "Expected graduation 2027" },
      activities: Array.from({ length: 30 }, (_, i) => ({
        id: `act${i}`,
        title: `Activity ${i}`,
        subtitle: "Member, Some Organization",
        meta: "Grades 9–12 · 3 hrs/week",
        bullets: ["One line describing what was done in this activity, long enough to wrap onto a second line of text."],
      })),
      honors: [],
      skills: ["Python"],
    };
    const out = await renderResumePdf(content);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(out.dropped.length).toBeGreaterThan(0);
    // Cut from the end of the ranking, in order.
    expect(out.dropped[0]).toBe("act29");
    expect(out.dropped).toEqual([...out.dropped].sort((a, b) => Number(b.slice(3)) - Number(a.slice(3))));
  });
});

// ─── Locked preview ───────────────────────────────────────────────────────────

describe("the locked preview", () => {
  it("is built from the sample module alone", () => {
    expect(lockedPreview()).toEqual({
      student: sample.SAMPLE_STUDENT,
      commonApp: sample.SAMPLE_COMMON_APP,
      bragSheet: sample.SAMPLE_BRAG_SECTIONS,
      resume: sample.SAMPLE_RESUME_LINES,
    });
  });

  it("imports nothing that could reach a student's data", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../../lib/documents/sample.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/require\(/);
  });
});
