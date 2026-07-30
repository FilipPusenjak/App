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

  stages: [
    {
      key: "early",
      label: "Early — Year 10-11 / Grade 9-10 (pre-A-level)",
      purpose:
        "Getting into position for the subject. UK admissions is decided almost entirely on the course-relevant record, and at this stage that means the grades that gate subject choice, choosing the right subjects, and beginning genuine engagement with the field beyond the classroom. This stage is about becoming ELIGIBLE for depth, not demonstrating it.",
      evidence: [
        "Strong grades in the subjects that lead to the intended course — these determine which A-levels or equivalents are open at all.",
        "Deliberate thinking about subject choice for the next stage, with the course requirements actually checked.",
        "Early super-curricular engagement: reading in the subject, following it beyond the syllabus, following where the curiosity goes.",
        "Any first-hand exposure to the field that is actually open at this age — for medicine, regular volunteering in a care setting rather than one day of shadowing.",
        "A sustained interest of any kind, pursued seriously. It counts for little on a UK form directly, but the habits it builds are real.",
      ],
      notYetExpected: [
        "A-level or IB predicted grades. The courses have not started.",
        "Admissions test results (UCAT, LNAT, and successors). These are sat in the final year — preparing now is premature, not diligent.",
        "A personal statement. It is written in the final year.",
        "Work experience placements with minimum ages the student has not reached.",
        "Research or an EPQ-style extended project before the qualification is available.",
        "Interview practice, which belongs to the application year.",
      ],
    },
    {
      key: "middle",
      label: "Middle — Year 12 / Grade 11 (first A-level year)",
      purpose:
        "Building the actual case for the course. Subject performance is now the dominant fact of the application, and super-curricular depth should be accumulating into something specific enough to write and be interviewed about.",
      evidence: [
        "Strong performance in the course-relevant subjects; predicted grades taking shape.",
        "Substantial super-curricular work: sustained reading, an extended project, olympiads, lectures, wider study with a point of view.",
        "For applied courses, sustained relevant experience rather than one-off exposure.",
        "Beginning admissions test preparation where the course requires one.",
        "Being able to say something specific and personal about why this course.",
      ],
      notYetExpected: [
        "Final grades.",
        "A submitted application.",
      ],
    },
    {
      key: "final",
      label: "Final — Year 13 / Grade 12",
      purpose:
        "Execution. Predicted grades, admissions tests, the personal statement and interviews — all in a compressed window, all decisive.",
      evidence: [
        "Predicted grades at or above what the course expects (verify the actual requirement).",
        "Admissions test sat or scheduled.",
        "A personal statement that is overwhelmingly about the subject.",
        "Interview preparation grounded in the student's own super-curricular work.",
      ],
      notYetExpected: [
        "New super-curricular activity started now that cannot deepen before the deadline.",
      ],
    },
  ],

  guidance: [
    "Judge every item by its relevance to the specific named course. An impressive but unrelated activity is a weak item for this target, and should be called weak — even if the same item is a strength for a US target.",
    "Do not reward breadth for its own sake. Range is not a UK admissions virtue.",
    "When an activity counts for little here, the reason is RELEVANCE TO THE COURSE, never the number of hours per week. Do not tell a student their club is weak because it meets for an hour a week — an hour a week is how clubs work. Say plainly that clubs unrelated to the course carry little weight in UK course-specific admissions, whatever time they take, and that a course-relevant activity of the same size would count for much more.",
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
