// The tests this product knows how to reason about.
//
// Reference data rather than sample data: a deployment with no TestType rows
// cannot record a score at all, because a sitting is recorded AGAINST a test and
// its sections are range-checked against that test's schema. So this is seeded
// on every deployment, by scripts/seed-testprep.ts, not by prisma/seed.ts.
//
// WHY THESE ARE SAFE TO WRITE DOWN AND THE POLICIES ARE NOT. A test's structure
// is a stable, published fact that changes on the order of once a decade and is
// announced years ahead: the SAT has two sections of 200-800 scored in tens, the
// ACT four of 1-36 averaged. A school's middle-50% moves every admissions cycle
// and is exactly the kind of number lib/testprep/target.ts warns about —
// recalled confidently, unsourced, and repeated to a parent. Those live in a
// researched JSON with a sourceDataVersion attached; see the seed script.
//
// ADDING A TEST IS A DATA CHANGE, NOT A CODE CHANGE, everywhere downstream:
// derivation, allocation and stopping all read the schema off the row. The one
// thing to get right here is the composite rule, because it decides what a
// student's headline number even means.
import type { CompositeRule, TestSectionSchema } from "@/lib/validation/testprep";

export type SeedTestType = {
  /** Stable identifier, and what the seed upserts on. */
  code: string;
  name: string;
  sectionSchema: TestSectionSchema;
  compositeRule: CompositeRule;
};

export const SEED_TEST_TYPES: SeedTestType[] = [
  {
    code: "SAT",
    name: "SAT",
    sectionSchema: {
      sections: [
        // Scored in tens. The step matters downstream: allocation reports "you
        // need 30 more points" only in values the test can actually produce.
        { name: "Reading and Writing", min: 200, max: 800, step: 10 },
        { name: "Math", min: 200, max: 800, step: 10 },
      ],
      compositeMin: 400,
      compositeMax: 1600,
    },
    compositeRule: "SUM",
  },
  {
    code: "ACT",
    name: "ACT",
    sectionSchema: {
      sections: [
        { name: "English", min: 1, max: 36, step: 1 },
        { name: "Math", min: 1, max: 36, step: 1 },
        { name: "Reading", min: 1, max: 36, step: 1 },
        { name: "Science", min: 1, max: 36, step: 1 },
      ],
      compositeMin: 1,
      compositeMax: 36,
    },
    // Averaged and rounded, not summed — an ACT composite is on the same 1-36
    // scale as its sections, which is why SUM here would produce a number four
    // times too large and no admissions office would recognise it.
    compositeRule: "AVERAGE",
  },
];
