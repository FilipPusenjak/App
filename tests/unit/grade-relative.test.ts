// The defect prompt v7 exists to fix, reported from a real run.
//
// A Grade 9 student with a 96 average, a 99 in a chemistry course and several
// sustained clubs was placed at 60 "for your year" — in the same evaluation
// that told them they were "a 9th grade student with the best possible
// foundation". Both cannot be true.
//
// Two independent faults produced it, and this file tests both:
//
//   1. The comparison pool was underspecified. v6 said "students in their year
//      with similar ambitions", which reads as the self-selected group chasing
//      the student's most selective target — the same pool overallScore
//      already uses, and one in which a 96 average is unremarkable. The page
//      meanwhile told the student it meant "students at your own stage".
//   2. The prose and the number were free to contradict each other.
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, PROMPT_VERSION } from "@/lib/prompts/evaluation";
import { STAGE_TRACKS } from "@/lib/validation/evaluation";

describe("gradeRelativeScore has one pool, and it is the broad one", () => {
  it("is on prompt v7", () => {
    expect(PROMPT_VERSION).toBe("evaluation/v7");
  });

  it("names the ordinary university-bound cohort", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /placement among students IN THE SAME YEAR AT COMPARABLE SCHOOLS WHO INTEND TO GO TO UNIVERSITY/,
    );
    expect(SYSTEM_PROMPT).toMatch(
      /stronger than roughly 90% of university-bound students in their year/,
    );
  });

  it("rules out the narrow pool by name — that was the actual misreading", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /NOT the self-selected group aiming at this student's most selective target/,
    );
    expect(SYSTEM_PROMPT).toMatch(
      /most of whom do not have top grades/,
    );
  });

  it("says why reusing overallScore's pool makes the number worthless", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /the second number tells them nothing the first did not/,
    );
  });

  it("anchors the reported case, so top grades plus real activities can't land mid-pack", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /Top-of-the-class grades plus a couple of activities genuinely sustained places a student well above its middle/,
    );
    expect(SYSTEM_PROMPT).toMatch(/somewhere in the 70s or 80s, not near 50/);
    expect(SYSTEM_PROMPT).toMatch(
      /you have quietly swapped in the selective-applicant pool again/,
    );
  });
});

describe("the stage penalty is not charged twice", () => {
  it("says gated achievements move this number not at all", () => {
    expect(SYSTEM_PROMPT).toMatch(/Gated achievements must not move this number at all/);
  });

  it("gives the reason, which is what makes the rule stick", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /Every other student in the year is blocked from research, admissions tests and formal leadership by exactly the same gates/,
    );
    expect(SYSTEM_PROMPT).toMatch(/scores them against a comparison group that does not exist/);
    expect(SYSTEM_PROMPT).toMatch(/double-counts a stage penalty overallScore has already applied/);
  });
});

describe("the words and the number may not contradict each other", () => {
  it("pins every onTrack value to a numeric range", () => {
    expect(SYSTEM_PROMPT).toMatch(/onTrack fixes the range of gradeRelativeScore/);
    expect(SYSTEM_PROMPT).toMatch(/"ahead" means 75 or above/);
    expect(SYSTEM_PROMPT).toMatch(/"on_track" means roughly 45 to 75/);
    expect(SYSTEM_PROMPT).toMatch(/"slightly_behind" means roughly 25 to 45/);
    expect(SYSTEM_PROMPT).toMatch(/"behind" means below 25/);
  });

  it("covers every track the schema allows — an unpinned one is a loophole", () => {
    for (const track of STAGE_TRACKS) {
      expect(SYSTEM_PROMPT).toContain(`"${track}"`);
    }
  });

  it("forbids the exact sentence that was reported", () => {
    expect(SYSTEM_PROMPT).toMatch(/Superlatives commit you to a number/);
    expect(SYSTEM_PROMPT).toMatch(/the best possible foundation for their year/);
    expect(SYSTEM_PROMPT).toMatch(/cut the praise, do not leave both standing/);
  });

  it("closes the reverse case too", () => {
    expect(SYSTEM_PROMPT).toMatch(/do not write a lukewarm assessment beside a high number/);
  });

  it("requires gradeContext to explain the numbers actually given", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /gradeContext must explain the numbers you actually gave, not a different pair/,
    );
  });
});

describe("none of this is permission to inflate", () => {
  it("says so where the calibration is given", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /keep low numbers available for students who are genuinely behind their year/,
    );
    expect(SYSTEM_PROMPT).toMatch(/this is a real measurement, not encouragement/);
    expect(SYSTEM_PROMPT).toMatch(
      /Reserve 90\+ for something that also distinguishes them within that strong group/,
    );
  });

  it("says so where the coherence rule is given", () => {
    expect(SYSTEM_PROMPT).toMatch(/This is not an instruction to inflate anything/);
  });

  it("leaves the calibration section untouched", () => {
    expect(SYSTEM_PROMPT).toMatch(/Call weak items weak/);
    expect(SYSTEM_PROMPT).toMatch(/Do not inflate scores/);
    expect(SYSTEM_PROMPT).toMatch(/Being harsh where it is warranted is part of the job/);
  });

  it("keeps everything v6 fixed about fit scores", () => {
    expect(SYSTEM_PROMPT).toMatch(/fitScore is NOT overallScore repeated once per school/);
    expect(SYSTEM_PROMPT).toMatch(/85-100 — clears this school's bar comfortably/);
    expect(SYSTEM_PROMPT).toMatch(
      /Adding a less selective school to the list must not move overallScore/,
    );
  });
});
