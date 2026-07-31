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
      weight: "high",
      description:
        "Genuine range beyond the main academic focus. Valued in its own right here — unlike in UK admissions. Reward duration and progression, not a long list of shallow memberships. Breadth is NOT filler in this system: holistic review is explicitly interested in the whole person, and a profile that is strong in one subject and empty everywhere else is a weaker holistic application than one with real range.",
    },
    {
      key: "sustained_commitment",
      label: "Sustained commitment outside the academic focus",
      weight: "high",
      description:
        "Multi-year dedication to something demanding that is NOT the intended major — a sport, an instrument, climbing, dance, martial arts, theatre, an art form. This is genuinely valued in US holistic review: it evidences discipline, resilience, and the ability to improve at something hard over years, which is exactly what admissions officers read activity lists for. Judge it on duration, progression, and level reached. It is usually not a 'spike' unless the level is high (state, national, competitive), but it is never worthless and must not be dismissed as irrelevant merely because it is unrelated to the intended course.",
    },
    {
      key: "personal_qualities",
      label: "Personal qualities the profile evidences",
      weight: "moderate",
      description:
        "What the pattern of activities demonstrates about the person: perseverance, initiative, curiosity, care for others, willingness to do unglamorous work. US applications are read by people looking for a person, not a subject specialist. Draw this from the evidence rather than asserting it.",
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

  stages: [
    {
      key: "early",
      label: "Early — Grade 9-10",
      purpose:
        "Building the foundations everything later is made of: the strongest courses actually available, a small number of activities that can still be running in three years, and genuine exploration of what the student cares about. Almost nothing here is supposed to look impressive yet — the value is that it COMPOUNDS. An activity begun in Grade 9 can become a leadership role and a body of work by Grade 12; the identical activity begun in Grade 12 cannot.",
      evidence: [
        "Taking the most demanding courses the school actually offers at this level, and doing well in them.",
        "Two or three activities begun and stuck with, rather than a long list sampled briefly.",
        "Any sustained commitment — a sport, an instrument, an art, a craft — that is being pursued seriously and improving.",
        "Real curiosity being followed: reading, building, making, self-teaching, in a direction that means something to them.",
        "Starting something that can grow — a project, a small business, a group — where the growth is the point.",
        "Beginning to seek out what is available locally: a volunteering placement, a club, a mentor, a summer programme.",
      ],
      notYetExpected: [
        "Standardized test scores. Sitting them this early is usually pointless and occasionally harmful.",
        "Admissions test preparation for tests taken in the final year.",
        "Leadership titles. Most are held by older students; not having one at 14 says nothing.",
        "Published or independently significant research. It requires coursework, technique and a mentor relationship that take years to build — being upstream of it is not a deficit.",
        "Selective summer programmes with age floors the student has not reached.",
        "A finished, coherent application narrative. It is being lived now, not written.",
        "Internships and formal work experience, which are mostly closed at this age.",
      ],
    },
    {
      key: "middle",
      label: "Middle — Grade 11",
      purpose:
        "Turning foundations into evidence. Commitments started earlier should now be producing something visible — a role, an output, a result — and the profile should be narrowing toward what the student is actually about rather than still widening.",
      evidence: [
        "Depth showing: years of continuity in the things that matter, with a role or an output to point at.",
        "Rigor at or near the ceiling of what the school offers.",
        "A recognizable direction emerging, with activity that supports it.",
        "First external validation where it is available — competitions, exhibitions, publications, real users, real customers.",
        "Testing underway if the student's targets use it.",
        "Relationships with teachers who will eventually write about them with specifics.",
      ],
      notYetExpected: [
        "Completed applications or finished essays.",
        "Final-year leadership positions not yet held.",
        "Results from competitions and programmes that only take part in the final year.",
      ],
    },
    {
      key: "final",
      label: "Final — Grade 12",
      purpose:
        "Converting what exists into an application. The profile is largely fixed; what remains is presenting it truthfully and well, and finishing anything close to done.",
      evidence: [
        "A clear, honest narrative that the record actually supports.",
        "Peak responsibility in the things sustained longest.",
        "Testing complete or a deliberate decision not to test.",
        "Recommenders who can speak in specifics.",
        "Any long-running project brought to a real conclusion.",
      ],
      notYetExpected: [
        "New commitments started now that cannot possibly show depth before applications close.",
      ],
    },
  ],

  guidance: [
    "Weigh depth over breadth when they conflict: one genuinely distinctive strength outweighs many shallow activities. But this is NOT a licence to dismiss everything outside the intended major — depth and range are both assessed here, and an activity does not have to relate to the course to count.",
    "A sustained, demanding activity unrelated to the intended major (a sport, an instrument, climbing, an art form) is a real asset in this system. Judge it on how long it has been pursued, whether the student has progressed, and the level reached — not on whether it connects to the major. Calling such an item unhelpful is a misreading of holistic review.",
    "Judge academics in context — the rigor available at the student's school matters as much as the raw GPA. If the school's offerings and grading are described, use that; if they are not, say that GPA cannot be fully judged without it rather than assuming.",
    "Credit sustained commitment and progression over time (e.g. member -> lead) more than one-off participation.",
    "WEEKLY HOURS ARE A WEAK SIGNAL AND MUST NOT DRIVE YOUR RATING. A school club that meets for an hour a week is the standard format for clubs everywhere — that is the normal cadence, not evidence of low commitment, and rating a club down for it is a straightforward error. What matters is how many YEARS it was sustained, what role was held, what was actually produced or changed, and the level reached. A one-hour-a-week club held for three years with a real role and real output is a strong item; the same hours for one term with nothing to show is not. Judge low hours as weak ONLY when they come with short duration AND no outcome.",
    "Time-intensive activities (a varsity sport, serious music practice) earn credit for that intensity, but the reverse does not follow: a low-hours activity is not thereby weak. Do not rank items by hours.",
    "Impact means consequences. If an item has no evidence of outcome, treat it as unproven and say so.",
    "Essays and recommendations are absent from this data and can shift an outcome substantially. Say so rather than scoring around the gap silently.",
    "THESE DIMENSIONS DESCRIBE SELECTIVE HOLISTIC REVIEW, WHICH IS NOT HOW EVERY US UNIVERSITY ADMITS. Holistic review in this full form is what schools do when they must turn away large numbers of qualified applicants. Many US universities — including large, well-regarded public ones — admit primarily on academic qualification: meet the grade and course requirements and you are in. When judging fit at such a school, weight academic rigor and GPA almost entirely, and treat the spike, leadership, narrative and breadth dimensions as close to irrelevant. A student with a strong transcript is comfortably admissible there whatever their activity list looks like, and saying otherwise is a straightforward misreading of that school.",
  ],

  cautions: [
    "Do not state or estimate any school's acceptance rate, average GPA, or average test score. Naming how selective a course is IN WORDS is required and is not covered by this — the prohibition is on numbers, which would be invented.",
    "Do not assert a school's current testing policy (test-optional, test-blind, required) — these change year to year. Tell the student to verify it.",
    "Do not claim a student 'will' or 'will not' get in. Holistic outcomes are not predictable from a resume.",
  ],
};
