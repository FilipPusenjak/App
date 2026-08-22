// The test-prep edition's promises, checked against the source that has to keep
// them.
//
// SOURCE-LEVEL, for the same reason the counselor edition's guarantees are. The
// claims here are about what the code cannot do — "nothing orders students by
// score", "the stopping engine has no entitlement check" — and a behavioural
// test only shows that the paths it happened to call did not do it today. A
// test that reads the source fails when someone adds the next route, which is
// exactly when a reviewer needs telling.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocateSections,
  retakeGuidance,
  type Allocation,
} from "@/lib/testprep/allocation";
import type { TestSectionSchema } from "@/lib/validation/testprep";

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

/** Source with comments stripped, so prose about a rule cannot satisfy it. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every file that is part of the test-prep surface. */
const TESTPREP_SOURCES = [
  ...filesUnder(join(ROOT, "lib", "testprep")),
  ...filesUnder(join(ROOT, "app", "api", "tutor")),
  ...filesUnder(join(ROOT, "app", "(tutor)")),
  join(ROOT, "app", "actions", "testprep.ts"),
];

describe("the test-prep surface exists at all", () => {
  it("has sources to check", () => {
    // Guards the guards. Every scan below passes vacuously against an empty
    // list, which would quietly disable this file if a directory were renamed.
    expect(TESTPREP_SOURCES.length).toBeGreaterThan(10);
  });
});

describe("nothing orders students by how they are doing", () => {
  /**
   * The roster is alphabetical, and the reason is in lib/testprep/roster.ts:
   * every other ordering a test-prep list could take is a ranking by a number
   * about a child.
   */
  it("sorts the roster by name and by nothing else", () => {
    const src = code(join(ROOT, "lib", "testprep", "roster.ts"));

    const sorts = [...src.matchAll(/\.sort\(([\s\S]{0,200}?)\)\s*;/g)].map((m) => m[1]!);
    expect(sorts.length).toBeGreaterThan(0);
    for (const s of sorts) {
      expect(s).toMatch(/studentName/);
    }
  });

  it("issues no Prisma ordering by a score, a signal count or a date on the roster path", () => {
    // listTutorLinks orders by startedAt (a fact about the grant, not the
    // student); the roster's own queries take no order at all. Anything naming
    // composite, score or improvement here would be a leaderboard.
    const paths = [
      join(ROOT, "lib", "testprep", "roster.ts"),
      join(ROOT, "lib", "testprep", "access.ts"),
    ];
    for (const path of paths) {
      const orderings = [
        ...code(path).matchAll(/orderBy:\s*\{([\s\S]{0,120}?)\}/g),
      ].map((m) => m[1]!);
      for (const o of orderings) {
        expect({ path, o }).toEqual({
          path,
          o: expect.stringMatching(/startedAt|takenAt|createdAt|studentName/),
        });
      }
    }
  });

  it("keeps every ranking term out of the tutor's screens", () => {
    // Terms that could only appear here as part of ordering students against
    // each other, or as a caseload-wide marketing statistic.
    const RANKING_TERMS =
      /\baverageGain\b|\bcaseloadAverage\b|\bimprovementRank\b|\brankStudents\b|\bleaderboard\b|\bpercentileAmongStudents\b/i;
    const offences = filesUnder(join(ROOT, "app", "(tutor)"))
      .concat(join(ROOT, "lib", "testprep", "roster.ts"))
      .filter((f) => RANKING_TERMS.test(code(f)))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(offences).toEqual([]);
  });
});

describe("the stopping signal is not gated behind anything", () => {
  /**
   * The load-bearing promise of the whole product: an over-band, unpaid,
   * expired account is still told when to stop. A single entitlement check in
   * the engine would end that, so the engine may not know entitlement exists.
   */
  const ENTITLEMENT_TERMS =
    /caseloadStanding|CASELOAD_BANDS|overBand|caseloadLimit|entitlement|\bplan\b.*\bactive\b|subscription/i;

  it("keeps entitlement out of the stopping engine entirely", () => {
    const src = code(join(ROOT, "lib", "testprep", "stopping.ts"));
    expect(ENTITLEMENT_TERMS.test(src)).toBe(false);
  });

  it("keeps it out of derivation and persistence too", () => {
    // Where a gate would actually be reached for: deriving is what writes the
    // signal, so a check here would silently stop it being recorded at all.
    for (const file of ["derive.ts", "target.ts", "allocation.ts"]) {
      const src = code(join(ROOT, "lib", "testprep", file));
      expect({ file, gated: ENTITLEMENT_TERMS.test(src) }).toEqual({
        file,
        gated: false,
      });
    }
  });

  it("imports nothing from the entitlement module into any engine", () => {
    const engines = filesUnder(join(ROOT, "lib", "testprep")).filter(
      (f) => !f.endsWith("entitlement.ts"),
    );
    const offences = engines
      .filter((f) => /from\s+["'][^"']*entitlement["']/.test(code(f)))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(offences).toEqual([]);
  });

  it("renders the over-band notice without disabling anything", () => {
    // Soft enforcement, checked as source rather than trusted: a `disabled`
    // attribute or a redirect driven by standing would be a hard gate wearing
    // a notice's clothes.
    const layout = code(join(ROOT, "app", "(tutor)", "layout.tsx"));
    expect(layout).toMatch(/standing\.overBand/);
    expect(layout).not.toMatch(/disabled/);
    // The only redirects are the two identity checks, neither about billing.
    const redirects = [...layout.matchAll(/redirect\(([^)]*)\)/g)].map((m) => m[1]!);
    for (const r of redirects) {
      expect(r).toMatch(/\/login|\/dashboard|\/caseload/);
    }
  });
});

describe("a tutor cannot write to a student's record", () => {
  /**
   * The tables the test-prep surface may write. Every one belongs to the
   * engagement itself; every student-owned table is absent, and that absence
   * is the test.
   *
   * scoreAttempt is here because recording a sitting is the tutor's job — and
   * it is the ONLY student-facing number they may put on the record, marked
   * unverified when they do.
   */
  const WRITABLE = new Set([
    "scoreAttempt",
    "scoreTarget",
    "sectionAllocation",
    "stoppingSignal",
    "progressArtifact",
    "counselorReadLog",
    "caseloadLink",
    "counselorAccount",
  ]);

  const WRITE_METHODS =
    "create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany";

  it("issues no write against profile, or any other student-owned table", () => {
    const offences: string[] = [];
    for (const file of TESTPREP_SOURCES) {
      const src = code(file);
      const pattern = new RegExp(
        `\\b(\\w+)\\s*\\.\\s*(\\w+)\\s*\\.\\s*(${WRITE_METHODS})\\s*\\(`,
        "g",
      );
      for (const m of src.matchAll(pattern)) {
        const [, receiver, model, method] = m as unknown as string[];
        // Only the Prisma clients this codebase binds — `prisma` and the `tx`
        // handed to $transaction. The Anthropic client also has a .create().
        if (!/^(prisma|tx)$/.test(receiver!)) continue;
        if (WRITABLE.has(model!)) continue;
        offences.push(`${file.replace(ROOT + "/", "")}: ${receiver}.${model}.${method}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("uses no raw SQL, which would slip past the check above", () => {
    const offences = TESTPREP_SOURCES.filter((f) =>
      /\$executeRaw|\$queryRaw|\$executeRawUnsafe|\$queryRawUnsafe/.test(code(f)),
    ).map((f) => f.replace(ROOT + "/", ""));
    expect(offences).toEqual([]);
  });

  it("imports no student-side mutation helper", () => {
    const STUDENT_DATA_ACTIONS =
      /from\s+["']@\/app\/actions\/(profile|students|target|plan|account)["']/;
    const offences = TESTPREP_SOURCES.filter((f) =>
      STUDENT_DATA_ACTIONS.test(code(f)),
    ).map((f) => f.replace(ROOT + "/", ""));
    expect(offences).toEqual([]);
  });

  it("never targets the narrative column of an artifact in an update", () => {
    // A tutor may append their own note. The generated body — and the stopping
    // notice inside it — is not theirs to edit, which is the point of it being
    // immutable.
    const src = code(join(ROOT, "app", "actions", "testprep.ts"));
    const updates = [
      ...src.matchAll(/progressArtifact\.update\(([\s\S]{0,400}?)\n\s{2}\}\)/g),
    ].map((m) => m[1]!);
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      const dataBlock = u.match(/data:\s*\{([^}]*)\}/)?.[1] ?? "";
      const keys = [...dataBlock.matchAll(/(\w+)\s*:/g)].map((k) => k[1]!);
      expect(keys).toEqual(["tutorNote"]);
    }
  });
});

describe("the tutor surface reads through the scoped helpers, never around them", () => {
  it("selects no wider profile shape of its own", () => {
    // A findMany on profile with a hand-written select in a tutor route is the
    // exact way TUTOR_PROFILE_SELECT gets bypassed by accident.
    const offences: string[] = [];
    for (const file of TESTPREP_SOURCES) {
      if (file.endsWith(join("lib", "testprep", "access.ts"))) continue;
      const src = code(file);
      for (const m of src.matchAll(/prisma\.profile\.find\w+\(([\s\S]{0,400}?)\n\s{2}\}\)/g)) {
        const select = m[1]!.match(/select:\s*\{([\s\S]*?)\}/)?.[1] ?? "";
        const keys = [...select.matchAll(/(\w+):\s*true/g)].map((k) => k[1]!);
        const allowed = new Set(["id", "studentName", "gradeLevel", "graduationYear"]);
        const strays = keys.filter((k) => !allowed.has(k));
        if (strays.length > 0) {
          offences.push(`${file.replace(ROOT + "/", "")}: ${strays.join(", ")}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });
});

describe("superscore-false schools get no single-section retake recommendation", () => {
  /**
   * The arithmetic this protects: a school that does not superscore reads ONE
   * sitting whole. A student told to spend a month on Math alone can lift Math
   * and slip English in the same sitting and go BACKWARDS at that school — so
   * naming a single section as the retake goal is not a softer version of good
   * advice, it is wrong advice.
   */
  const SCHEMA: TestSectionSchema = {
    sections: [
      { name: "Math", min: 200, max: 800, step: 10 },
      { name: "Reading and Writing", min: 200, max: 800, step: 10 },
    ],
    compositeMin: 400,
    compositeMax: 1600,
  };

  /** A student with real room in Math and almost none in Reading. */
  function allocations(): Allocation[] {
    return allocateSections({
      current: { Math: 600, "Reading and Writing": 780 },
      schema: SCHEMA,
      rule: "SUM",
    });
  }

  it("finds Math as the section with the room, whatever the policy", () => {
    // The premise. Headroom is a fact about the scale and does not move with a
    // school's superscore policy — only the recommendation does.
    const focus = allocations().find((a) => a.recommendedFocus);
    expect(focus?.sectionName).toBe("Math");
  });

  it("names no section when the binding school does not superscore", () => {
    const guidance = retakeGuidance({
      allocations: allocations(),
      bindingSuperscores: false,
      bindingSchoolName: "Ashford College",
    });
    expect(guidance.singleSection).toBe(false);
    expect(guidance.focusSection).toBeNull();
  });

  it("says why, in terms a tutor can repeat to a parent", () => {
    const guidance = retakeGuidance({
      allocations: allocations(),
      bindingSuperscores: false,
      bindingSchoolName: "Ashford College",
    });
    expect(guidance.message).toContain("Ashford College");
    expect(guidance.message).toMatch(/does not superscore/);
    expect(guidance.message).toMatch(/every section holds|one sitting whole/);
  });

  it("does name the section when the school does superscore", () => {
    // The other half of the claim: this is a real distinction, not a blanket
    // refusal to ever recommend a focus.
    const guidance = retakeGuidance({
      allocations: allocations(),
      bindingSuperscores: true,
      bindingSchoolName: "Ashford College",
    });
    expect(guidance.singleSection).toBe(true);
    expect(guidance.focusSection).toBe("Math");
  });

  it("recommends nothing at all when no section has room, either way", () => {
    const maxed = allocateSections({
      current: { Math: 800, "Reading and Writing": 800 },
      schema: SCHEMA,
      rule: "SUM",
    });
    for (const superscores of [true, false]) {
      const guidance = retakeGuidance({
        allocations: maxed,
        bindingSuperscores: superscores,
        bindingSchoolName: "Ashford College",
      });
      expect({ superscores, ...guidance }).toEqual({
        superscores,
        singleSection: false,
        focusSection: null,
        message: expect.stringContaining("cannot go higher"),
      });
    }
  });

  it("is the only thing that names a focus section to a parent", () => {
    // Mutation-proofing the wiring, not just the function. The artifact's
    // context is what a parent reads; if it ever went back to reading
    // recommendedFocus directly, this whole guarantee would be bypassed while
    // every test above still passed.
    const src = code(join(ROOT, "lib", "testprep", "progress-context.ts"));
    expect(src).toMatch(/focusSection:\s*retake\.focusSection/);
    expect(src).not.toMatch(/recommendedFocus/);
  });
});
