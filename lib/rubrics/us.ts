import type { Rubric } from "./types";

/**
 * United States — holistic review.
 *
 * The whole applicant is considered: academic rigor in context, a distinctive
 * area of depth ("spike"), leadership and impact, and whether the pieces cohere
 * into a narrative. Breadth has real value here, which is precisely what does
 * NOT transfer to the UK rubric.
 */
export const usRubric: Rubric = {
  id: "us-holistic",
  country: "US",
  name: "United States — holistic review",
  summary:
    "Holistic: the whole applicant is weighed — academics in context, depth plus breadth, leadership, character, and the coherence of the overall narrative.",

  dimensions: [
    {
      key: "academic_rigor",
      label: "Academic rigor and performance",
      weight: "critical",
      description:
        "GPA and grade trend judged against the rigor of the courses taken and what was actually available at the student's school. An upward trend counts. Rigor matters as much as the raw number.",
    },
    {
      key: "spike",
      label: "Depth / distinctive strength (the 'spike')",
      weight: "critical",
      description:
        "Whether the student is genuinely distinctive in at least one area, and at what level (school, regional, national, international). Selective US admissions rewards being exceptional at something over being decent at many things.",
    },
    {
      key: "leadership_impact",
      label: "Leadership and measurable impact",
      weight: "high",
      description:
        "Initiative and consequences, not titles. What changed because this student was involved? A founder of something small with real results usually beats a nominal officer of something large.",
    },
    {
      key: "narrative_coherence",
      label: "Narrative coherence",
      weight: "high",
      description:
        "Whether activities, coursework, and stated major/career goal tell one intelligible story. Incoherence is not fatal but is a real weakness; a story that is merely asserted rather than evidenced is weaker still.",
    },
    {
      key: "breadth",
      label: "Breadth of engagement",
      weight: "moderate",
      description:
        "Genuine range beyond the main focus, including sustained commitment over time. Valued here — unlike in UK admissions. Reward duration and progression, not a long list of shallow memberships.",
    },
    {
      key: "service_community",
      label: "Service and community contribution",
      weight: "moderate",
      description:
        "Sustained contribution to a community. Weigh depth and duration; one-off or resume-padding service is weak and should be described that way.",
    },
    {
      key: "testing",
      label: "Standardized testing",
      weight: "moderate",
      description:
        "SAT/ACT where submitted, plus AP/IB results as evidence of rigor. Weight varies enormously by school and year because testing policies differ and change.",
    },
    {
      key: "essays_recommendations",
      label: "Essays and recommendations",
      weight: "high",
      description:
        "Heavily weighted in real US decisions but NOT present in this profile. Do not guess at their quality. Note explicitly that they are unassessed and materially affect the outcome.",
    },
  ],

  guidance: [
    "Weigh depth over breadth when they conflict: one genuinely distinctive strength outweighs many shallow activities.",
    "Judge academics in context — the rigor available at the student's school matters as much as the raw GPA.",
    "Credit sustained commitment and progression over time (e.g. member -> lead) more than one-off participation.",
    "Impact means consequences. If an item has no evidence of outcome, treat it as unproven and say so.",
    "Essays and recommendations are absent from this data and can shift an outcome substantially. Say so rather than scoring around the gap silently.",
  ],

  cautions: [
    "Do not state or estimate any school's acceptance rate, average GPA, or average test score.",
    "Do not assert a school's current testing policy (test-optional, test-blind, required) — these change year to year. Tell the student to verify it.",
    "Do not claim a student 'will' or 'will not' get in. Holistic outcomes are not predictable from a resume.",
  ],
};
