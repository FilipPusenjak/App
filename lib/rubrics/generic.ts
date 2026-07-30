import type { Rubric } from "./types";

/**
 * Fallback for countries with no dedicated rubric yet.
 *
 * Deliberately cautious: it must NOT quietly apply US assumptions to, say, a
 * German or Japanese application. It assesses what is defensible in general and
 * tells the student to verify the actual system.
 */
export const genericRubric: Rubric = {
  id: "generic",
  country: "*",
  name: "General (no country-specific rubric)",
  summary:
    "No country-specific rubric is configured for this target. Assess conservatively and defer to the institution's own published criteria.",

  dimensions: [
    {
      key: "academic_record",
      label: "Academic record",
      weight: "critical",
      description:
        "Grades, curriculum rigor, and any results in subjects relevant to the intended course.",
    },
    {
      key: "subject_relevance",
      label: "Relevance to the intended course",
      weight: "high",
      description:
        "How closely the student's strongest work relates to what they intend to study.",
    },
    {
      key: "evidence_quality",
      label: "Quality of evidence",
      weight: "moderate",
      description:
        "Whether claims are backed by verifiable outcomes rather than asserted.",
    },
  ],

  stages: [
    {
      key: "early",
      label: "Early — first years of secondary",
      purpose:
        "Building foundations: the strongest available coursework, and a small number of commitments that can still be running years from now. What matters at this stage is what compounds, not what looks impressive today.",
      evidence: [
        "Strong performance in the most demanding courses actually available.",
        "A few commitments begun and sustained rather than many sampled.",
        "Genuine engagement with the intended field, at whatever level is open.",
      ],
      notYetExpected: [
        "Test scores, admissions tests, or any final-year requirement.",
        "Leadership titles or independently significant research — both gated behind years of prerequisites.",
        "A finished application narrative.",
      ],
    },
    {
      key: "middle",
      label: "Middle — penultimate years",
      purpose:
        "Turning foundations into visible evidence: continuity producing a role, an output or a result, and a direction becoming recognizable.",
      evidence: [
        "Depth and continuity in the things that matter, with something concrete to point at.",
        "Rigor near the ceiling of what is available.",
        "Any external validation the system actually recognizes — verify what that is.",
      ],
      notYetExpected: ["Final grades or a submitted application."],
    },
    {
      key: "final",
      label: "Final year",
      purpose:
        "Meeting the institution's stated requirements and presenting the record honestly.",
      evidence: [
        "Whatever the published criteria actually require — verify them directly.",
        "Long-running work brought to a conclusion.",
      ],
      notYetExpected: [
        "New commitments that cannot show depth before deadlines.",
      ],
    },
  ],

  guidance: [
    "Do not assume this country's system resembles the US or UK. State clearly that the rubric applied is generic.",
    "The stage model here is deliberately general. Say that stage expectations for this country should be verified rather than assumed.",
    "Restrict the assessment to what is defensible without country-specific knowledge, and push the student to verify the real criteria.",
  ],

  cautions: [
    "Do not invent admissions criteria, statistics, or requirements for this country or institution.",
    "Do not apply US holistic assumptions (breadth, essays, recommendations) unless you are certain they apply.",
  ],
};
