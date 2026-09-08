// Is that grade underway, or finished?
//
// The model used to be told to work this out from today's date. That is not a
// question a date can answer: school years do not begin or end on a shared date,
// so a June reading of "Grade 11" is mid-year in Sydney and finished in Chicago.
// Every timing judgement downstream rests on getting it right — how much of the
// year is left to act in, whether a gap is "now" or "soon", whether an activity
// still has room to compound — so the student is now asked outright.
//
// What these tests hold is that a stated answer is passed through AS a statement
// and that the old guess is gone when one exists, because a prompt that says both
// "they told you" and "work it out from the date" is the bug with extra words.
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import { buildDiff } from "@/lib/evaluation/diff";
import { renderSnapshot } from "@/lib/prompts/evaluation/render";
import { PROMPT_VERSION } from "@/lib/prompts/evaluation";
import {
  GRADE_STATUSES,
  GRADE_STATUS_LABELS,
  GRADE_STATUS_PROMPT,
} from "@/lib/validation/enums";
import { profileSchema } from "@/lib/validation/profile";

function snapshotWith(gradeStatus: string | null) {
  return buildSnapshot(
    {
      gradeLevel: "Grade 11",
      gradeStatus,
      schoolName: "Riverside High",
      schoolContext: null,
      curriculum: "ap",
      gpa: 3.8,
      gpaScale: "4.0",
      intendedMajor: "Computer Science",
      careerGoal: null,
      testScores: [],
      resumeItems: [],
      targetSchools: [
        {
          name: "MIT",
          country: "US",
          course: "Computer Science",
          classification: null,
          priority: null,
          notes: null,
        },
      ],
    },
    "US",
  );
}

const render = (status: string | null) => renderSnapshot(snapshotWith(status));

describe("a stated answer is rendered as a fact", () => {
  it("says the year is still underway when the student said so", () => {
    const text = render("in_progress");
    expect(text).toContain("CURRENTLY IN this grade");
    expect(text).toContain("it is not finished yet");
  });

  it("says the year is over when the student said so", () => {
    const text = render("completed");
    expect(text).toContain("ALREADY FINISHED this grade");
    // The consequence, not just the fact. "Completed" on its own still leaves
    // the model free to plan as though that year were ahead of them.
    expect(text).toContain("do not treat that year as still ahead of them");
  });

  it("tells the model the student said it, so it stops re-deriving it", () => {
    for (const status of GRADE_STATUSES) {
      expect(render(status)).toContain("treat it as fact");
    }
  });

  it("drops the date guess entirely once there is an answer", () => {
    // The whole point. Leaving the old instruction in beside a stated fact
    // would invite the model to overturn the student on a calendar assumption.
    for (const status of GRADE_STATUSES) {
      const text = render(status);
      expect(text).not.toContain("or has JUST COMPLETED");
      expect(text).not.toContain("Read it together with today's date");
    }
  });

  it("still prints the grade itself alongside the status", () => {
    expect(render("completed")).toContain("Grade level: Grade 11");
  });
});

describe("when the student has not answered", () => {
  const text = render(null);

  it("falls back to reasoning from the date rather than to nothing", () => {
    // Profiles saved before the question existed. A reasoned guess still beats
    // no guidance — it just must not be presented as though it were told.
    expect(text).toContain("Read it together with today's date");
    expect(text).toContain("they did not say which");
  });

  it("warns that the calendar assumption is not universal", () => {
    // The actual defect being fixed: the old text reasoned from a northern
    // -hemisphere school year without ever saying that was an assumption.
    expect(text).toContain(
      "school years do not start or end on the same date everywhere",
    );
  });

  it("asks the model to surface the assumption it made", () => {
    expect(text).toContain("verifyThese");
  });

  it("never claims the student stated something they did not", () => {
    expect(text).not.toContain("treat it as fact");
  });
});

describe("the snapshot carries the answer", () => {
  it("freezes the raw value, not a label, so the prompt can phrase it", () => {
    expect(snapshotWith("completed").student.gradeStatus).toBe("completed");
  });

  it("records null when unanswered rather than inventing a default", () => {
    // A default would be a guess wearing a stored value's clothes, and it would
    // be wrong for a whole hemisphere at a time.
    expect(snapshotWith(null).student.gradeStatus).toBeNull();
  });

  it("tolerates a profile loaded without the field at all", () => {
    const { gradeStatus, ...withoutField } = {
      gradeLevel: "Grade 11",
      gradeStatus: null,
      schoolName: null,
      schoolContext: null,
      curriculum: null,
      gpa: null,
      gpaScale: null,
      intendedMajor: null,
      careerGoal: null,
      testScores: [],
      resumeItems: [],
      targetSchools: [],
    };
    void gradeStatus;
    expect(buildSnapshot(withoutField, null).student.gradeStatus).toBeNull();
  });
});

describe("finishing the year is a change a follow-up should see", () => {
  const scores = {
    overallScore: 40,
    gradeRelativeScore: 60,
    fitScores: { MIT: 30 },
    promptVersion: PROMPT_VERSION,
    rescoredKeys: [],
  };

  it("reports the move from in progress to completed", () => {
    const diff = buildDiff(
      snapshotWith("in_progress"),
      snapshotWith("completed"),
      scores,
    );
    expect(diff.changedFields.join(" ")).toContain("Grade status");
    expect(diff.changedFields.join(" ")).toContain("completed");
  });

  it("says nothing when the answer has not moved", () => {
    const diff = buildDiff(
      snapshotWith("completed"),
      snapshotWith("completed"),
      scores,
    );
    expect(diff.changedFields.join(" ")).not.toContain("Grade status");
  });
});

describe("the field the student actually fills in", () => {
  it("accepts both answers and nothing else", () => {
    for (const status of GRADE_STATUSES) {
      expect(profileSchema.safeParse({ gradeStatus: status }).success).toBe(true);
    }
    expect(profileSchema.safeParse({ gradeStatus: "graduated" }).success).toBe(
      false,
    );
  });

  it("stays optional, so an existing profile still saves", () => {
    expect(profileSchema.safeParse({}).success).toBe(true);
  });

  it("offers exactly two answers, phrased from the student's side", () => {
    // Two options and no "not sure": a third choice would put the guess back,
    // and the student is the one person who cannot be unsure about this.
    expect(GRADE_STATUSES).toHaveLength(2);
    for (const status of GRADE_STATUSES) {
      expect(GRADE_STATUS_LABELS[status]).toMatch(/^I /);
      expect(GRADE_STATUS_PROMPT[status]).toContain("student");
    }
  });
});
