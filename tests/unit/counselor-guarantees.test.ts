// The counselor edition's promises, checked against the source that has to keep
// them.
//
// Several of these are SOURCE-LEVEL tests, which is unusual and deliberate. The
// claims are about what the code cannot do — "no route mutates a student
// record", "nothing ranks students by readiness" — and a behavioural test can
// only show that the paths it happened to call did not do it today. A test that
// reads the source fails when someone adds the twelfth route, which is exactly
// when a reviewer needs telling.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findBannedCounselorPhrasing,
  sessionPrepNarrativeSchema,
} from "@/lib/validation/counselor";
import {
  isOperator,
  monthWindow,
  worstCasePerLinkUsd,
  LIST_PRICE_PER_LINK_USD,
} from "@/lib/counselor/economics";
import { RUN_BUDGET_USD } from "@/lib/cost-budget";

const ROOT = process.cwd();

function filesUnder(dir: string, exts = [".ts", ".tsx"]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full, exts);
    return exts.some((e) => full.endsWith(e)) ? [full] : [];
  });
}

/** A copy of an object without one key, for proving the key is required. */
function omit<T extends object>(value: T, key: keyof T): Partial<T> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

/** Source with comments stripped, so prose about a rule cannot satisfy it. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every file that is part of the counselor surface. */
const COUNSELOR_SOURCES = [
  ...filesUnder(join(ROOT, "lib", "counselor")),
  ...filesUnder(join(ROOT, "app", "api", "counselor")),
  ...filesUnder(join(ROOT, "app", "(counselor)")),
];

describe("the counselor surface exists at all", () => {
  it("has sources to check", () => {
    // Guards the guards. Every test below is a scan, and a scan of nothing
    // passes silently — which would quietly disable this whole file if a
    // directory were ever renamed.
    expect(COUNSELOR_SOURCES.length).toBeGreaterThan(8);
  });
});

describe("a counselor cannot write to a student's record", () => {
  /**
   * The tables the counselor surface may write.
   *
   * All five belong to the counselor edition itself. A CaseloadLink appears
   * because a counselor may invite and end their own link; every student-owned
   * table is absent, and that absence is the test.
   */
  const WRITABLE = new Set([
    "triageSignal",
    "sessionPrep",
    "counselorRecommendation",
    "counselorReadLog",
    "counselorAccount",
    "caseloadLink",
  ]);

  const WRITE_METHODS =
    "create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany";

  /**
   * The ONE exception, stated as narrowly as it can be.
   *
   * Redeeming an invite code consumes it, and the code lives on Profile — so
   * the counselor surface does write one row of a student-owned table. It sets
   * the two invite columns to null and touches nothing else, which is why the
   * allowance below is a column list rather than a filename.
   */
  const PROFILE_WRITE_ALLOWED_COLUMNS = new Set([
    "counselorInviteCode",
    "counselorInviteExpiresAt",
  ]);

  it("issues no write against any student-owned table", () => {
    // Matches ANY receiver, not just `prisma` — a write issued through a
    // transaction client (`tx.profile.update`) is the same write, and a guard
    // that only knew the word "prisma" would have waved it through.
    const offences: string[] = [];
    for (const file of COUNSELOR_SOURCES) {
      const src = code(file);
      const pattern = new RegExp(
        `\\b(\\w+)\\s*\\.\\s*(\\w+)\\s*\\.\\s*(${WRITE_METHODS})\\s*\\(`,
        "g",
      );
      for (const m of src.matchAll(pattern)) {
        const [, receiver, model, method] = m as unknown as string[];
        // Only the Prisma clients this codebase actually binds — `prisma` and
        // the `tx` handed to $transaction. Anything else with a .create() on
        // it (the Anthropic client, for one) is not a database write.
        if (!/^(prisma|tx)$/.test(receiver!)) continue;
        if (WRITABLE.has(model!)) continue;
        if (model === "profile") {
          // Allowed only if the data object names nothing but the invite
          // columns. The call's argument is read here rather than trusted.
          const args = src.slice(m.index! + m[0]!.length, m.index! + m[0]!.length + 600);
          const dataBlock = args.match(/data:\s*\{([^}]*)\}/)?.[1] ?? "";
          const keys = [...dataBlock.matchAll(/(\w+)\s*:/g)].map((k) => k[1]!);
          const strays = keys.filter((k) => !PROFILE_WRITE_ALLOWED_COLUMNS.has(k));
          if (keys.length > 0 && strays.length === 0) continue;
          offences.push(
            `${file.replace(ROOT + "/", "")}: ${receiver}.profile.${method} writes ${strays.join(", ") || "(unreadable data block)"}`,
          );
          continue;
        }
        offences.push(`${file.replace(ROOT + "/", "")}: ${receiver}.${model}.${method}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("uses no raw SQL, which would slip past the check above", () => {
    const offences = COUNSELOR_SOURCES.filter((f) =>
      /\$executeRaw|\$queryRaw|\$executeRawUnsafe|\$queryRawUnsafe/.test(code(f)),
    );
    expect(offences).toEqual([]);
  });

  it("imports no student-side mutation helper", () => {
    // The other way a write could arrive: not through Prisma here, but by
    // calling something that writes on this module's behalf. Named rather than
    // "any action", because the counselor nav signs out through the shared
    // auth action and a session is not a student record.
    const STUDENT_DATA_ACTIONS =
      /from\s+["']@\/app\/actions\/(profile|students|target|plan|account)["']/;
    const offences: string[] = [];
    for (const file of COUNSELOR_SOURCES) {
      if (STUDENT_DATA_ACTIONS.test(code(file))) {
        offences.push(file.replace(ROOT + "/", ""));
      }
    }
    expect(offences).toEqual([]);
  });
});

describe("nothing ranks students by how they are doing", () => {
  /**
   * The caseload is ordered by NEED, and need is severity. A readiness value
   * reaching this surface at all would be the first step toward a leaderboard
   * of a counselor's own children.
   */
  const RANKING_TERMS =
    /\breadiness\b|\bpercentile\b|thresholdBand|differentiation\.band|\bscoreProfile\b/;

  it("keeps every scoring concept out of the caseload and attention list", () => {
    const surfaces = [
      join(ROOT, "lib", "counselor", "caseload.ts"),
      join(ROOT, "app", "(counselor)", "caseload", "page.tsx"),
      join(ROOT, "app", "(counselor)", "caseload", "students", "page.tsx"),
      // The overview is a DASHBOARD, which is precisely the screen a readiness
      // average would arrive on — "just one summary number for the caseload" is
      // a reasonable-sounding request that this rule exists to refuse.
      join(ROOT, "lib", "counselor", "overview.ts"),
      join(ROOT, "app", "(counselor)", "caseload", "overview", "page.tsx"),
    ];
    for (const file of surfaces) {
      expect({ file, hit: RANKING_TERMS.test(code(file)) }).toEqual({
        file,
        hit: false,
      });
    }
  });

  it("orders the caseload by severity and the directory by name, and by nothing else", () => {
    const src = code(join(ROOT, "lib", "counselor", "caseload.ts"));
    const orderings = [...src.matchAll(/orderBy:\s*([\s\S]{0,160}?)\n\s*(?:\}|take)/g)].map(
      (m) => m[1]!,
    );
    expect(orderings.length).toBeGreaterThan(0);
    for (const o of orderings) {
      // severity / computedAt order the signals; studentName orders the
      // directory. Anything else here would be a ranking by another name.
      expect(o).toMatch(/severity|computedAt|studentName|generatedAt|createdAt/);
    }
  });

  it("counts work on the overview, and never loads a student's name to rank", () => {
    // The dashboard's whole defence is that its unit of count is a signal, a
    // session, a year group or a consent scope — never a student. Selecting a
    // student name here would be the first thing anyone needed in order to
    // build the ordered list of children this product refuses to produce.
    const src = code(join(ROOT, "lib", "counselor", "overview.ts"));
    expect(src).not.toMatch(/studentName/);

    // Every sort on this surface, checked. Counts and severities order the
    // WORK; a label orders a composition row alphabetically. Anything reaching
    // for a measure of a student would have to appear here first.
    const sorts = [...src.matchAll(/\.sort\(([\s\S]{0,220}?)\)\s*;/g)].map((m) => m[1]!);
    expect(sorts.length).toBeGreaterThan(0);
    for (const s of sorts) {
      expect(s).toMatch(/count|topSeverity|label/);
    }
  });

  it("exposes no counselor JSON route that could return a sorted caseload", () => {
    // The scan above covers the pages. A JSON endpoint is the other way a
    // ranked list could leave the building, so the route list is enumerated.
    const routes = filesUnder(join(ROOT, "app", "api", "counselor"))
      .filter((f) => f.endsWith("route.ts"))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(routes.sort()).toEqual([
      "app/api/counselor/links/route.ts",
      "app/api/counselor/prep/route.ts",
      "app/api/counselor/recommendations/[id]/route.ts",
      "app/api/counselor/triage/route.ts",
    ]);
  });
});

describe("every model claim carries a traceable basis", () => {
  const withBasis = {
    headline: "Two prerequisites went unmet this term.",
    sinceLastSession: "Chemistry dropped out of the plan.",
    discussionPoints: [
      { point: "Chemistry is now required and unplanned.", urgency: "NOW", basis: "threshold.newly_binding" },
    ],
    questionsToAsk: ["Why did chemistry come off the timetable?"],
    optionsToConsider: [
      {
        option: "Add chemistry back next term.",
        tradeoff: "Costs a free period they are using for the EPQ.",
        feasibility: "TIGHT",
        basis: "threshold.newly_binding",
      },
    ],
    whatIMayHaveMissed: "The drop coincides with the activity stalling.",
  };

  it("accepts a narrative where every point and option cites a fact", () => {
    expect(sessionPrepNarrativeSchema.safeParse(withBasis).success).toBe(true);
  });

  it("rejects a discussion point with no basis", () => {
    const parsed = sessionPrepNarrativeSchema.safeParse({
      ...withBasis,
      discussionPoints: [omit(withBasis.discussionPoints[0]!, "basis")],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an option with no basis", () => {
    const parsed = sessionPrepNarrativeSchema.safeParse({
      ...withBasis,
      optionsToConsider: [omit(withBasis.optionsToConsider[0]!, "basis")],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty basis, which is the shape a model actually produces", () => {
    // The realistic failure is not a missing key — a structured output will
    // supply every key — it is a key filled with nothing.
    const parsed = sessionPrepNarrativeSchema.safeParse({
      ...withBasis,
      discussionPoints: [{ ...withBasis.discussionPoints[0]!, basis: "  " }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("this product never states odds of admission", () => {
  const PROBABILITY_PHRASINGS = [
    "She has a 40% chance of an offer.",
    "Roughly one in three applicants like this get in.",
    "Their odds of admission are good.",
    "This student is likely to be admitted.",
    "Probability of acceptance: moderate.",
    "They will probably get an offer from Imperial.",
    "Expect a 2 in 5 shot at this course.",
    "Chances of admission improve to about 60 percent.",
  ];

  it.each(PROBABILITY_PHRASINGS)("catches %j wherever it appears", (text) => {
    const found = findBannedCounselorPhrasing({
      headline: "A term of steady work.",
      sinceLastSession: text,
      discussionPoints: [],
      questionsToAsk: [],
      optionsToConsider: [],
      whatIMayHaveMissed: null,
    });
    expect(found.length).toBeGreaterThan(0);
  });

  it("walks nested points and options, not just the top-level strings", () => {
    const found = findBannedCounselorPhrasing({
      headline: "A term of steady work.",
      sinceLastSession: "Nothing changed.",
      discussionPoints: [
        {
          point: "Their chances of admission are strong.",
          urgency: "MONITOR",
          basis: "profile.stale",
        },
      ],
      questionsToAsk: [],
      optionsToConsider: [],
      whatIMayHaveMissed: null,
    });
    expect(found.length).toBeGreaterThan(0);
  });

  /**
   * The other half of the guarantee, and the easier one to get wrong.
   *
   * A false positive here discards a run that has already been paid for, so
   * each of these is a sentence the widened patterns above could plausibly
   * swallow: a calendar fact that contains "will get an offer", and ordinary
   * counselling arithmetic that contains a ratio.
   */
  const MUST_PASS = [
    "She will get an offer decision in December, so the exam has to be sat first.",
    "Three of their five targets require chemistry.",
    "One in three of her activities has stalled at participant level.",
    "Two out of five subjects are below the published grade.",
    "Ask whether the family would accept an offer that far from home.",
    "Roughly 60 percent of her recorded hours are in one activity.",
  ];

  it.each(MUST_PASS)("does not trip on %j", (text) => {
    const found = findBannedCounselorPhrasing({
      headline: text,
      sinceLastSession: text,
      discussionPoints: [],
      questionsToAsk: [text],
      optionsToConsider: [],
      whatIMayHaveMissed: null,
    });
    expect(found).toEqual([]);
  });

  it("leaves ordinary counselling language alone", () => {
    // The cost of a false positive is a paid run discarded, so the patterns
    // have to survive the words a prep is actually written in.
    const found = findBannedCounselorPhrasing({
      headline: "Two prerequisites are unmet with eight months to go.",
      sinceLastSession:
        "They added an olympiad and dropped chemistry, which is required by three of their five targets.",
      discussionPoints: [
        {
          point: "Ask what happened to chemistry before assuming it was a choice.",
          urgency: "NOW",
          basis: "threshold.newly_binding",
        },
      ],
      questionsToAsk: ["Is the family aligned on applying abroad?"],
      optionsToConsider: [
        {
          option: "Sit the exam externally in the summer.",
          tradeoff: "Costs a summer they were going to spend on the research project.",
          feasibility: "TIGHT",
          basis: "threshold.newly_binding",
        },
      ],
      whatIMayHaveMissed: "The activity has not moved a rung in fourteen months.",
    });
    expect(found).toEqual([]);
  });
});

describe("the economics hold by arithmetic", () => {
  it("prices the worst case a link can cost against what a link is charged", () => {
    const worst = worstCasePerLinkUsd();
    expect(worst).toBeCloseTo(4 * RUN_BUDGET_USD.SESSION_PREP, 10);
    // The claim the pricing rests on: even a counselor running four preps a
    // month for EVERY student stays well inside the list price.
    expect(worst).toBeLessThan(LIST_PRICE_PER_LINK_USD / 2);
  });

  it("measures a calendar month, so a cost figure reconciles with an invoice", () => {
    const { from, to } = monthWindow(new Date("2026-08-21T13:45:00Z"));
    expect(from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls the year over in December", () => {
    const { to } = monthWindow(new Date("2026-12-31T23:59:59Z"));
    expect(to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("makes nobody an operator when the allowlist is unset", () => {
    const saved = process.env.OPERATOR_EMAILS;
    try {
      delete process.env.OPERATOR_EMAILS;
      expect(isOperator("anyone@example.com")).toBe(false);
      process.env.OPERATOR_EMAILS = "   ";
      expect(isOperator("anyone@example.com")).toBe(false);

      process.env.OPERATOR_EMAILS = "ops@example.com, other@example.com";
      expect(isOperator("OPS@example.com")).toBe(true);
      expect(isOperator(" ops@example.com ")).toBe(true);
      expect(isOperator("someone@example.com")).toBe(false);
      expect(isOperator(null)).toBe(false);
      expect(isOperator(undefined)).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.OPERATOR_EMAILS;
      else process.env.OPERATOR_EMAILS = saved;
    }
  });
});

describe("the cost view carries no student data", () => {
  it("selects nothing from a student-owned table", () => {
    const src = code(join(ROOT, "lib", "counselor", "economics.ts"));
    // An operator is not a party to any consent grant, so this module reads
    // counselor-side tables only.
    expect(src).not.toMatch(/prisma\s*\.\s*profile\b/);
    expect(src).not.toMatch(/studentProfile|studentName|resumeItem|testScore/);
  });
});

describe("recommendations never become a performance review", () => {
  const src = code(join(ROOT, "lib", "counselor", "recommendations.ts"));

  it("computes no effectiveness score and no cross-counselor comparison", () => {
    expect(src).not.toMatch(/effectiveness|successRate|success_rate|benchmark|percentile|ranking/i);
  });

  it("never reaches for an admissions outcome", () => {
    expect(src).not.toMatch(/admitted|admission|acceptedToSchool|offerReceived|outcomeJoin/i);
  });

  it("scopes every query to the signed-in counselor's own readable links", () => {
    const queries = [...src.matchAll(/prisma\.counselorRecommendation\.\w+\(/g)];
    expect(queries.length).toBeGreaterThan(1);
    // Every findMany/findFirst passes through readableLinkWhere; the lone
    // update targets a row that one already resolved.
    const scoped = [...src.matchAll(/readableLinkWhere\(account\.id\)/g)];
    expect(scoped.length).toBeGreaterThanOrEqual(3);
  });

  it("cannot mark a counselor's own advice as accepted by the student", () => {
    const validation = code(join(ROOT, "lib", "validation", "counselor.ts"));
    const transitions = validation.slice(
      validation.indexOf("RECOMMENDATION_TRANSITIONS"),
    );
    const block = transitions.slice(0, transitions.indexOf("};") + 2);
    // The value exists as a STATE but appears as no transition's target, so no
    // counselor-facing route can write it.
    expect(block).toContain("ACCEPTED_BY_STUDENT");
    expect(block.match(/ACCEPTED_BY_STUDENT/g)!.length).toBe(1);
    expect(block).toMatch(/ACCEPTED_BY_STUDENT:\s*\[\]/);
  });
});
