// Which school system's words the student is written to in.
//
// Observed on the deployment, in a real projection, for a US student in Grade 9
// with Oxford, Cambridge and UCL among their targets:
//
//   "Even fully executed, at Grade 9 you cannot yet show predicted grades, an
//    admissions test, or a personal statement — those are gated to Year 13 and
//    correctly absent."
//
// The UK rubric was correctly chosen; they are applying to UK universities. But
// Year 13 does not exist in an American school, so the one clause explaining
// WHEN the missing things arrive was the one clause the reader could not place.
//
// The source of it is honest enough: a stage label has to name the same point
// in school in more than one system, because the rubric is shown to students
// from all of them. What was missing was any instruction about which half to
// write back.
import { describe, expect, it } from "vitest";
import { renderRubric } from "@/lib/rubrics";
import { ukRubric } from "@/lib/rubrics/uk";
import { usRubric } from "@/lib/rubrics/us";
import { euRubric } from "@/lib/rubrics/eu";
import { genericRubric } from "@/lib/rubrics/generic";

const ALL = [ukRubric, usRubric, euRubric, genericRubric];

describe("every rendered rubric says whose words to use", () => {
  it("carries the vocabulary rule, whichever system it describes", () => {
    // Not UK-only: a British student measured against the US rubric has the
    // mirror of this problem, and it would read just as wrongly to them.
    for (const rubric of ALL) {
      expect(renderRubric(rubric)).toMatch(/VOCABULARY:/);
    }
  });

  it("points at the student's stated grade level as the deciding fact", () => {
    // The snapshot carries it as free text in the student's own words, which
    // is exactly the signal needed and is already in every prompt.
    expect(renderRubric(ukRubric)).toMatch(/grade level/i);
  });

  it("gives the concrete pairing, not just the principle", () => {
    // An abstract instruction here is the kind a model half-follows.
    const text = renderRubric(ukRubric);
    expect(text).toMatch(/Grade 9/);
    expect(text).toMatch(/Year 13/);
    expect(text).toMatch(/Grade 12/);
  });
});

describe("the stage labels that made this possible", () => {
  it("still name both systems, so either reader can be served", () => {
    // The fix is the instruction, NOT stripping the second naming: a UK
    // student needs Year 13 and a US student needs Grade 12, and the label
    // has to carry both for the model to have the choice at all.
    const final = ukRubric.stages.find((s) => s.key === "final");
    expect(final?.label).toMatch(/Year 13/);
    expect(final?.label).toMatch(/Grade 12/);
  });

  it("keeps the US rubric free of foreign year naming", () => {
    // Nothing to translate: a US-only rubric has no second vocabulary to leak.
    for (const stage of usRubric.stages) {
      expect(stage.label).not.toMatch(/Year 1[123]/);
    }
  });
});
