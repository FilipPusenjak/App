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

  guidance: [
    "Do not assume this country's system resembles the US or UK. State clearly that the rubric applied is generic.",
    "Restrict the assessment to what is defensible without country-specific knowledge, and push the student to verify the real criteria.",
  ],

  cautions: [
    "Do not invent admissions criteria, statistics, or requirements for this country or institution.",
    "Do not apply US holistic assumptions (breadth, essays, recommendations) unless you are certain they apply.",
  ],
};
