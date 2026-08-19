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
  it("is still in force on the active prompt", () => {
    expect(PROMPT_VERSION).toBe("evaluation/v11");
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
    // v8 replaced one sentence of guidance with bands, because the sentence
    // was not enough to move a real student off 60.
    expect(SYSTEM_PROMPT).toMatch(
      /A student at or near the top of their class who is actually involved in things belongs HERE/,
    );
    expect(SYSTEM_PROMPT).toMatch(/70-85 — strong grades in demanding courses/);
    expect(SYSTEM_PROMPT).toMatch(
      /you have quietly swapped the selective-applicant pool back in/,
    );
  });

  it("gives a band for every level, not just the flattering one", () => {
    expect(SYSTEM_PROMPT).toMatch(/85-95 — at or near the top of a demanding programme/);
    expect(SYSTEM_PROMPT).toMatch(/50-65 — solid grades and some involvement/);
    expect(SYSTEM_PROMPT).toMatch(/30-45 — grades or engagement noticeably behind their year/);
    expect(SYSTEM_PROMPT).toMatch(/Below 30 — little evidence of either/);
  });

  it("reads the bands at the student's stage — v9", () => {
    // v8 got the reported case from 60 to 66 and no further, because its bands
    // demanded "years-long commitments" from a student three months into
    // secondary school. No member of their year could satisfy that, so the
    // requirement could not discriminate between any of them.
    expect(SYSTEM_PROMPT).toMatch(/Read those bands at the student's stage/);
    expect(SYSTEM_PROMPT).toMatch(
      /sustained FOR AS LONG AS THEY HAVE HAD/,
    );
    expect(SYSTEM_PROMPT).toMatch(
      /their entire comparison group has had exactly the same number of months/,
    );
  });

  it("says what sustained commitment looks like in the early years", () => {
    expect(SYSTEM_PROMPT).toMatch(/things carried in from before secondary school/);
    expect(SYSTEM_PROMPT).toMatch(/joined at the first opportunity and still running/);
    expect(SYSTEM_PROMPT).toMatch(
      /A Grade 9 student who joined several things in September and is genuinely active in them HAS sustained commitment/,
    );
  });

  it("re-scales the top band too, not only the one below it", () => {
    expect(SYSTEM_PROMPT).toMatch(
      /for a final-year student it means years; for a Grade 9 student it means since before they arrived/,
    );
  });

  it("stops the bands being read as a floor", () => {
    expect(SYSTEM_PROMPT).toMatch(/Do not read that as a floor/);
    expect(SYSTEM_PROMPT).toMatch(
      /Top grades with nothing sustained alongside them is a 50s or 60s profile/,
    );
    expect(SYSTEM_PROMPT).toMatch(/a student coasting in easy courses is lower still/);
    // The guard that keeps the stage-relative reading from becoming flattery.
    expect(SYSTEM_PROMPT).toMatch(
      /Joining things and doing nothing in them is not sustaining anything at any stage/,
    );
    expect(SYSTEM_PROMPT).toMatch(
      /one-off experiences are not commitments however impressive they sound/,
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
    expect(SYSTEM_PROMPT).toMatch(/the low bands exist to be used/);
    expect(SYSTEM_PROMPT).toMatch(/This is a real measurement, not encouragement/);
    expect(SYSTEM_PROMPT).toMatch(
      /90\+ needs something that distinguishes them even within the strong group/,
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
