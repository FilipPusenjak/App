import type { Rubric } from "./types";

/**
 * United Kingdom — course-specific admissions.
 *
 * Judged almost entirely on suitability for ONE named course. Depth in the
 * subject, predicted grades, subject-relevant super-curriculars, and (for some
 * courses) an admissions test. Unrelated extracurriculars count for very
 * little — the single most common mistake a US-trained applicant makes.
 */
export const ukRubric: Rubric = {
  id: "uk-course-specific",
  country: "GB",
  name: "United Kingdom — course-specific admissions",
  summary:
    "Course-specific: the applicant is judged on suitability for one named course. Subject depth, predicted grades, and subject-relevant super-curriculars dominate; unrelated extracurriculars count for very little.",

  dimensions: [
    {
      key: "subject_depth",
      label: "Depth in the specific subject",
      weight: "critical",
      description:
        "Demonstrated ability and sustained engagement in the exact subject applied for. This is the core of a UK application. Generic academic strength is not a substitute for subject depth.",
    },
    {
      key: "predicted_grades",
      label: "Predicted grades and required subjects",
      weight: "critical",
      description:
        "Predicted grades in the subjects that matter for this course, including whether required subjects are being taken at the right level. Judge relative strength; do not assert a specific offer threshold.",
    },
    {
      key: "supercurricular",
      label: "Super-curricular work (subject-relevant)",
      weight: "high",
      description:
        "Wider engagement that is directly relevant to the course: reading beyond the syllabus, olympiads and subject competitions, MOOCs, independent projects, essay prizes, relevant research. Must connect to the course to count.",
    },
    {
      key: "admissions_tests",
      label: "Admissions tests",
      weight: "high",
      description:
        "Course-specific entrance tests (e.g. UCAT for many medical courses) and any subject-specific written assessment. Which test applies depends on the course AND the university, and requirements change frequently.",
    },
    {
      key: "personal_statement",
      label: "Personal statement (subject-focused)",
      weight: "high",
      description:
        "In the UK this is an argument for why the student should study THIS subject, evidenced by super-curricular work. NOT present in this profile — flag it as unassessed rather than guessing.",
    },
    {
      key: "relevant_experience",
      label: "Relevant work or practical experience",
      weight: "moderate",
      description:
        "Experience that bears on the specific course (e.g. clinical or care experience for medicine, a portfolio for design). Only counts insofar as it is relevant to the course.",
    },
    {
      key: "unrelated_extracurricular",
      label: "Unrelated extracurricular activities",
      weight: "low",
      description:
        "Sports, clubs, music, and leadership roles UNRELATED to the course carry very little weight in UK admissions. Do not credit them as if they were US-style breadth. Say plainly when an item falls here — but say it as a fact about THIS system, not as a judgement on the activity: the correct framing is 'this counts for little for a UK course application' rather than 'this is not useful'. The same item may be a genuine asset for a US target, and if the student has US targets you must say so instead of leaving the impression it is worthless everywhere.",
    },
  ],

  guidance: [
    "Judge every item by its relevance to the specific named course. An impressive but unrelated activity is a weak item for this target, and should be called weak — even if the same item is a strength for a US target.",
    "Do not reward breadth for its own sake. Range is not a UK admissions virtue.",
    "Subject depth and predicted grades dominate. If those are weak, no amount of other material compensates.",
    "If the student's targets mix US and UK, expect real tension: effort that strengthens a US profile (breadth, unrelated leadership) often does nothing for a UK application. Name that tension explicitly rather than smoothing it over.",
    "Where the student has not named a specific course for a UK target, treat that as a gap — a UK application cannot be assessed without one.",
  ],

  cautions: [
    "Do not state specific grade requirements or typical offers (e.g. 'they require A*AA' or 'you need 39 IB points') — these vary by course and year. Tell the student to verify on the university's own course page.",
    "Do not assert which admissions test a course requires. Test requirements change (for example, the BMAT was discontinued after its final sittings, and some courses have since changed test), so requirements must be verified on the official course page for the year of entry.",
    "Do not state acceptance rates or applicants-per-place figures.",
    "Do not assume the interview practices of any university or course.",
  ],
};
