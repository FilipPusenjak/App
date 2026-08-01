// The defect prompt v6 exists to fix, reported from a real run.
//
// A student with a 4.0 added a large public university that admits the large
// majority of qualified applicants — deliberately, to see how the app judged an
// easy target — and was told they were a 58 for it. A 58 is "genuinely
// borderline". They were not borderline.
//
// The cause was an omission rather than a bad rule: v5 defined overallScore and
// gradeRelativeScore precisely and never defined fitScore anywhere the model
// could read. With no bar to measure against, fit degenerated into the headline
// percentile restated once per school — right for the hardest target on the
// list, wrong for every other one.
//
// These tests are written against the symptom, not the implementation.
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, PROMPT_VERSION } from "@/lib/prompts/evaluation";
import {
  evaluationResultSchema,
  storedEvaluationResultSchema,
  SELECTIVITY_TIERS,
} from "@/lib/validation/evaluation";
import { evaluationWireSchema } from "@/lib/validation/evaluation-wire";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { genericRubric, renderRubric, ukRubric, usRubric } from "@/lib/rubrics";

describe("fitScore is defined at all — it never was", () => {
  it("is still in force on the active prompt", () => {
    expect(PROMPT_VERSION).toBe("evaluation/v8");
  });

  it("says outright that fit is not the headline score repeated", () => {
    expect(SYSTEM_PROMPT).toMatch(/fitScore is NOT overallScore repeated once per school/);
    expect(SYSTEM_PROMPT).toMatch(
      /If every fitScore lands near overallScore, you have answered the wrong question/,
    );
  });

  it("gives fitScore bands, so 58 has a meaning that can be checked", () => {
    expect(SYSTEM_PROMPT).toMatch(/85-100 — clears this school's bar comfortably/);
    expect(SYSTEM_PROMPT).toMatch(/50-69 — genuinely borderline/);
    expect(SYSTEM_PROMPT).toMatch(/25-49 — below this school's bar/);
  });

  it("requires the spread across schools that was missing", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /same profile must produce very different fitScores across schools of different selectivity/,
    );
  });
});

describe("the exact case that was reported", () => {
  it("says a low headline plus a high fit is the CORRECT answer, not a contradiction", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /excellent grades and modest activities has a LOW overallScore and belongs in the 85-100 band/,
    );
    expect(SYSTEM_PROMPT).toMatch(/Both are true simultaneously/);
  });

  it("forbids the specific move that produced the 58", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /A low headline percentile is NEVER a reason to hold a fit score down/,
    );
  });

  it("stops the selective-admissions yardstick being used on schools that don't use it", () => {
    expect(SYSTEM_PROMPT).toMatch(/Match the yardstick to the school/);
    expect(SYSTEM_PROMPT).toMatch(
      /Do not judge an accessible school's fit on the absence of a spike/,
    );
    expect(SYSTEM_PROMPT).toMatch(/grades and course rigor carry nearly all the weight/);
  });

  it("tells the student the thing they added the school to find out", () => {
    expect(SYSTEM_PROMPT).toMatch(/should be told plainly that it is a safety and why/);
  });

  it("does not pad an easy school with invented risks", () => {
    expect(SYSTEM_PROMPT).toMatch(/do not manufacture keyRisks for a school the student clears/i);
  });
});

describe("the bar has to be named before fit can be measured", () => {
  it("offers a tier from open through extremely selective", () => {
    expect(SELECTIVITY_TIERS).toEqual([
      "open",
      "accessible",
      "selective",
      "highly_selective",
      "extremely_selective",
    ]);
    for (const tier of SELECTIVITY_TIERS) {
      expect(SYSTEM_PROMPT).toContain(`"${tier}"`);
    }
  });

  it("describes each bar in words, never as a figure", () => {
    expect(SYSTEM_PROMPT).toMatch(/admits the large majority of applicants who meet its academic requirements/);
    expect(SYSTEM_PROMPT).toMatch(/turns away many well-qualified applicants/);
  });

  it("notes selectivity is a property of the COURSE, not just the school", () => {
    expect(SYSTEM_PROMPT).toMatch(/selectivity is a property of the COURSE/);
    expect(SYSTEM_PROMPT).toMatch(/Medicine, Law or Computer Science sits a tier or two above/);
  });

  it("makes the model hedge downward and flag it when unsure", () => {
    expect(SYSTEM_PROMPT).toMatch(/choose the more cautious tier/);
    expect(SYSTEM_PROMPT).toMatch(/put it in verifyThese/);
  });
});

describe("the statistics ban survives the change", () => {
  it("still forbids stating or estimating any acceptance rate", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /NEVER state or estimate acceptance rates, admit rates, applicants-per-place, average GPAs, or average test scores/,
    );
    expect(SYSTEM_PROMPT).toMatch(/Not even approximately/);
  });

  it("carves out only the wording, not numbers", () => {
    expect(SYSTEM_PROMPT).toMatch(/The prohibition is on NUMBERS/);
    expect(SYSTEM_PROMPT).toMatch(/never dress a number up as a range or an approximation/);
  });

  it("keeps every rubric's caution consistent with that carve-out", () => {
    // A rubric that still said "never discuss selectivity" would contradict the
    // system prompt, and the model would follow one of them at random.
    expect(renderRubric(usRubric)).toMatch(/prohibition is on numbers/i);
    expect(renderRubric(ukRubric)).toMatch(/not the same thing and is not covered by this/);
  });
});

describe("the rubrics no longer assume every institution is selective", () => {
  it("says US holistic review in full is what SELECTIVE schools do", () => {
    const text = renderRubric(usRubric);
    expect(text).toMatch(/THESE DIMENSIONS DESCRIBE SELECTIVE HOLISTIC REVIEW/);
    expect(text).toMatch(/admit primarily on academic qualification/);
    expect(text).toMatch(/comfortably admissible there whatever their activity list looks like/);
  });

  it("says UK selectivity tracks the course far more than the university", () => {
    const text = renderRubric(ukRubric);
    expect(text).toMatch(/SELECTIVITY VARIES ENORMOUSLY BY COURSE/);
    expect(text).toMatch(/admit most applicants who meet the stated grade requirements/);
  });

  it("stops the generic rubric defaulting unknown countries to a high bar", () => {
    const text = renderRubric(genericRubric);
    expect(text).toMatch(/Most institutions in most countries are not highly selective/);
    expect(text).toMatch(/systematically understates where a qualified student stands/);
  });

  it("does not soften the US rubric's honesty about weak items", () => {
    // Guard against this fix becoming "everything is fine everywhere".
    const text = renderRubric(usRubric);
    expect(text).toMatch(/If an item has no evidence of outcome, treat it as unproven/);
    expect(SYSTEM_PROMPT).toMatch(/Call weak items weak/);
    expect(SYSTEM_PROMPT).toMatch(/Do not inflate scores/);
  });
});

describe("adding an easy school must not change the headline number", () => {
  it("anchors the pool to the most selective targets", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /placement among a realistic pool of applicants to the MOST SELECTIVE targets/,
    );
    expect(SYSTEM_PROMPT).toMatch(
      /Adding a less selective school to the list must not move overallScore/,
    );
    expect(SYSTEM_PROMPT).toMatch(/has not become weaker/);
  });
});

describe("the pieces have to agree with each other", () => {
  it("ties classification to the fit score rather than to reputation", () => {
    expect(SYSTEM_PROMPT).toMatch(/a "safety" must sit in the 85-100 band/);
    expect(SYSTEM_PROMPT).toMatch(/If your classification and your number disagree, one of them is wrong/);
  });
});

describe("the contract, and what it does to older evaluations", () => {
  const fit = {
    schoolName: "Arizona State University",
    country: "United States",
    course: "Computer Science",
    rubricUsed: "us-holistic",
    selectivity: "accessible",
    fitScore: 92,
    classification: "safety",
    classificationReason: "Your transcript clears what this course asks for.",
    assessment: "A 4.0 puts you comfortably above this school's academic bar.",
    keyRisks: [],
  };

  function resultWith(fits: unknown[]) {
    return {
      overallScore: 42,
      gradeRelativeScore: 71,
      gradeContext: "Strong for the year.",
      stageOutlook: {
        stageLabel: "Middle — Grade 11",
        whatMattersNow: "Turning foundations into evidence.",
        onTrack: "on_track",
        assessment: "Real progress.",
        reachableNow: ["A competition entry"],
        notYetExpected: ["Published research"],
      },
      systemScores: [
        {
          rubricId: "us-holistic",
          systemLabel: "United States — holistic review",
          readinessScore: 48,
          gradeRelativeScore: 74,
          assessment: "Breadth counts here.",
        },
      ],
      changeSinceLast: "First evaluation.",
      headline: "Strong grades, thin activities.",
      summary: "A short honest paragraph.",
      strengths: [{ title: "GPA", detail: "4.0.", relevantTo: ["all"] }],
      weaknesses: [
        { title: "Few activities", detail: "Thin.", severity: "moderate" },
      ],
      narrativeCoherence: { score: 55, assessment: "Coherent." },
      schoolFits: fits,
      itemAssessments: [],
      actions: [],
      gaps: [],
      verifyThese: ["Check the entry requirements."],
    };
  }

  it("requires a selectivity tier on every school", () => {
    expect(evaluationResultSchema.safeParse(resultWith([fit])).success).toBe(true);

    const withoutTier: Record<string, unknown> = { ...fit };
    delete withoutTier.selectivity;
    expect(
      evaluationResultSchema.safeParse(resultWith([withoutTier])).success,
    ).toBe(false);
  });

  it("rejects a tier that isn't one of the five", () => {
    expect(
      evaluationResultSchema.safeParse(
        resultWith([{ ...fit, selectivity: "easy" }]),
      ).success,
    ).toBe(false);
  });

  it("reads a v5 row back without inventing a tier for it", () => {
    const v5Fit: Record<string, unknown> = { ...fit };
    delete v5Fit.selectivity;
    const parsed = storedEvaluationResultSchema.parse(resultWith([v5Fit]));
    // Absent, not defaulted — the UI omits the label rather than asserting a
    // selectivity nobody judged.
    expect(parsed.schoolFits[0]!.selectivity).toBeUndefined();
    expect(parsed.schoolFits[0]!.fitScore).toBe(92);
  });

  it("keeps the schema small enough to still compile into a grammar", () => {
    // The field added here is exactly the kind of growth that caused the
    // "compiled grammar is too large" outage. Re-check the ceiling.
    type S = { properties?: Record<string, S>; items?: S };
    const cost = (s: S): number => {
      if (!s || typeof s !== "object") return 0;
      let total = 0;
      if (s.properties) {
        const keys = Object.keys(s.properties);
        total += 2 ** keys.length;
        for (const k of keys) total += cost(s.properties[k]!);
      }
      if (s.items) total += cost(s.items);
      return total;
    };
    const schema = (
      zodOutputFormat(evaluationWireSchema as never) as { schema: S }
    ).schema;
    expect(cost(schema)).toBeLessThan(10_000);
  });
});
