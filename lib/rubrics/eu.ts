import type { Rubric } from "./types";

/**
 * European (EU/EEA) — qualification-led admissions.
 *
 * Replaces what would have been a single-country Ireland rubric. Ireland is not
 * special enough to deserve one while the Netherlands, Germany, France and the
 * Nordics all fall through to the cautious generic fallback: they share a shape
 * that is genuinely different from both US holistic review and UK
 * course-specific selection, and it is that shape a rubric can capture.
 *
 * The shape: admission is decided mainly by a RECOGNISED SCHOOL-LEAVING
 * QUALIFICATION and the grades in the subjects a course requires, plus the
 * language the course is taught in. For most programmes it is a threshold
 * rather than a competition — meet the requirement and you are generally
 * admitted. Extracurricular activity, the centrepiece of a US application,
 * usually counts for nothing at all.
 *
 * The most important thing in this file is the warning that "the EU" is not one
 * admissions system. Ireland's points system, Germany's numerus clausus, Dutch
 * numerus fixus selection and the French grandes écoles concours differ from one
 * another far more than they resemble each other, and a rubric that flattened
 * them would be the same error this app exists to avoid between the US and the
 * UK. What is shared is the shape; everything numeric must be verified.
 */
export const euRubric: Rubric = {
  id: "eu-qualification-led",
  country: "EU",
  name: "European (EU/EEA) — qualification-led admissions",
  summary:
    "Admission turns on a recognised school-leaving qualification, the grades in the subjects the course requires, and the language of instruction. Mostly a threshold rather than a contest; extracurriculars count for little except where a programme runs a formal selection.",

  dimensions: [
    {
      key: "leaving_qualification",
      label: "School-leaving qualification and its recognition",
      weight: "critical",
      description:
        "Whether the student's diploma is accepted for direct entry in the target country, and whether it covers the subjects the course requires. This is the first gate and it is binary — a qualification that is not recognised, or is missing a required subject, cannot be compensated for by anything else in the profile. Some countries require a foundation or bridging year for qualifications they do not recognise directly. Judge whether the student's curriculum plausibly leads where they want to go, and send them to verify the specifics.",
    },
    {
      key: "required_subject_grades",
      label: "Grades in the REQUIRED subjects",
      weight: "critical",
      description:
        "Performance in the specific subjects the course demands — usually mathematics and sciences for engineering, medicine and economics — rather than the overall average. A strong general average with a weak grade in a required subject is a serious problem here in a way it often is not in US admissions. Weigh the required subjects first and the overall record second.",
    },
    {
      key: "language_of_instruction",
      label: "Language of instruction",
      weight: "critical",
      description:
        "Whether the course is taught in English or in the national language, and whether the student can evidence the level required. This is a hard gate and frequently the thing that actually blocks an otherwise qualified applicant — most commonly for programmes with no English-taught track. Treat a missing language qualification as a concrete, dated obstacle, not a soft weakness.",
    },
    {
      key: "restricted_entry",
      label: "Restricted-entry selection, where it applies",
      weight: "high",
      description:
        "A minority of courses — commonly medicine, dentistry, veterinary medicine, psychology and some others — are capped and select rather than admit. Selection may use a grade threshold, an entrance examination, an aptitude test, a weighted procedure, or in some places a partial lottery. Where a target is one of these, that mechanism dominates everything else in this rubric. Where it is not, do not invent a contest that does not exist.",
    },
    {
      key: "motivation_and_fit",
      label: "Motivation letter, interview or selection file",
      weight: "moderate",
      description:
        "Present only where a programme runs a selection procedure, and absent from this profile in any case. Where it applies, it rewards demonstrated engagement with the SUBJECT rather than a general activity list. Note explicitly that it is unassessed and can matter, rather than scoring around the gap silently.",
    },
    {
      key: "subject_engagement",
      label: "Evidence of engagement with the subject",
      weight: "moderate",
      description:
        "Reading, projects, competitions, relevant work or volunteering that show a real interest in the field. Genuinely valuable where a selection procedure exists, and modestly useful everywhere as evidence the student has chosen their course for a reason. Judge relevance to the course, not general impressiveness.",
    },
    {
      key: "extracurricular_breadth",
      label: "Extracurricular breadth",
      weight: "low",
      description:
        "Deliberately LOW, and this is the single biggest difference from US admissions. Sport, music, clubs, leadership positions and volunteering unrelated to the course typically carry no weight in a qualification-led admission and are often not even collected on the application. This is a fact about the system, not a judgement of the activity — an item can be a genuine asset for a US target and count for nothing here at the same time. Say exactly that rather than calling the item weak.",
    },
    {
      key: "practical_eligibility",
      label: "Practical eligibility and process",
      weight: "moderate",
      description:
        "Application routes, deadlines, and whether the student's residency or nationality affects their route — these differ sharply by country and are frequently earlier than students expect. Do not state any of the specifics; flag that they are decisive and must be checked on the official source for the year of entry.",
    },
  ],

  stages: [
    {
      key: "early",
      label: "Early — Grade 9-10 / Years 1-2 of secondary",
      purpose:
        "Keeping the right doors open. Almost everything that decides a European admission is a subject choice or a language, and both are made years before the application. The work at this stage is making sure the qualification the student is heading toward will be recognised where they want to go, and that it includes the subjects their intended course requires. Nothing here needs to look impressive; it needs to be correct.",
      evidence: [
        "Taking, and doing well in, the subjects their intended course is likely to require — mathematics and sciences above all, since these are the hardest to add later.",
        "Being on a curriculum track that leads to a qualification recognised in the target country.",
        "Starting the language of instruction early where the course is not taught in English. This is the single highest-leverage thing at this stage and it takes years.",
        "Genuine reading and exploration in the intended field, which costs nothing and informs the choice.",
        "Beginning to find out how the target country's system actually works, since it decides subject choices that are about to be made.",
      ],
      notYetExpected: [
        "Final or predicted grades, which do not exist yet.",
        "Entrance examinations and aptitude tests for restricted-entry courses, which are sat in the final year.",
        "A motivation letter or selection file.",
        "A formal language certificate. Learning the language now matters; certifying it does not.",
        "A settled course choice. Keeping the required subjects open is what matters at this point.",
      ],
    },
    {
      key: "middle",
      label: "Middle — Grade 11 / penultimate year",
      purpose:
        "Turning the open doors into a concrete shortlist. Requirements should now be checked rather than assumed, subject grades should be at the level the target courses ask for, and the language should be approaching the certifiable level.",
      evidence: [
        "Solid performance in the required subjects, at or near the level the shortlisted courses ask for.",
        "A shortlist of specific courses, with their actual entry requirements read rather than assumed.",
        "Language study far enough along that certification in the final year is realistic.",
        "Awareness of which shortlisted courses are restricted-entry, and what mechanism each of them uses.",
        "Subject engagement that would support a motivation letter, where any target requires one.",
      ],
      notYetExpected: [
        "Submitted applications.",
        "Results from final-year examinations.",
        "Entrance-exam results for tests only sat in the final year.",
      ],
    },
    {
      key: "final",
      label: "Final — Grade 12 / final year",
      purpose:
        "Meeting the requirements and completing the process correctly. The profile is largely fixed; what remains is grades, language certification, any entrance examination, and applying on time through the right route.",
      evidence: [
        "Predicted or final grades that meet the stated requirements in the required subjects.",
        "Language certification completed at the required level.",
        "Any entrance examination or aptitude test prepared for and sat.",
        "Applications submitted through the correct route, before deadlines that are often earlier than expected.",
        "Recognition of the student's own qualification confirmed rather than assumed.",
      ],
      notYetExpected: [
        "New extracurricular activity started now, which would not affect a qualification-led decision even if it were finished.",
      ],
    },
  ],

  guidance: [
    "\"THE EU\" IS NOT ONE ADMISSIONS SYSTEM, AND TREATING IT AS ONE IS THE MAIN RISK IN USING THIS RUBRIC. Ireland admits on a points total, Germany on school-leaving grade thresholds that vary by course and year, the Netherlands by selection for capped programmes, France through a national platform with the grandes écoles running an entirely separate competitive route. What they share is that admission is led by qualifications, grades and language rather than by a rounded personal profile. Apply the shared shape; state that the specifics differ by country and must be verified for the exact course.",
    "Admission is usually a THRESHOLD, not a contest. For most courses, a student who meets the stated requirements is admitted — there is no pool to be ranked against. Do not describe an ordinary programme as competitive, and do not tell a qualified student to strengthen a profile that will not be read.",
    "The exception is restricted-entry courses, where the cap makes the mechanism decisive. Where a target is one of these, judge it on that mechanism and say which kind you believe it uses — while making clear the student must confirm it.",
    "WEIGH THE REQUIRED SUBJECTS ABOVE THE OVERALL AVERAGE. A 95 average with a weak mathematics grade is a serious problem for an engineering application here, and saying so is more useful than praising the average.",
    "LANGUAGE IS A HARD GATE AND IS ROUTINELY UNDERESTIMATED. If a target course is taught in a language the student does not have, that is the most important fact in the assessment — it is fixable, but only with years of notice. Treat it as a dated obstacle with a concrete plan, never as a footnote.",
    "Extracurricular activity counts for little to nothing in most of these admissions. When an item is unhelpful here, the reason is that THE SYSTEM DOES NOT READ IT — not that the item is weak. If the student also has US targets, say plainly that the same item is a real asset there. The honest position is almost always \"valuable there, not here\".",
    "Do not import UK reasoning either. A UK application rewards super-curricular depth argued in a personal statement; most European admissions have no equivalent document and no place to argue anything. The systems are close in that both are course-specific, and far apart in what evidence they accept.",
    "Recognition of the student's own qualification is a real and frequently decisive question, especially for applicants from outside Europe. Raise it explicitly and send them to verify it rather than assuming their diploma is accepted.",
    "Deadlines and application routes differ by country and are often much earlier than students expect. Flag the process itself as something to check, since missing it fails a student who was fully qualified.",
  ],

  cautions: [
    "Do not state any specific grade requirement, points total, numerus clausus or numerus fixus threshold, or grade-point conversion. These vary by course, by country and by year, and are exactly the kind of number that would be invented. Send the student to the official course page for their year of entry.",
    "Do not assert which courses are capped or restricted-entry in a given year, or which selection mechanism a named programme uses. Describe the possibilities and tell the student to confirm.",
    "Do not state language certificate thresholds or which certificates a university accepts.",
    "Do not state tuition fees, or assert whether a student qualifies for domestic, EU or international fee status — this depends on residency and nationality rules that change and that this profile does not fully capture.",
    "Do not assume a course is taught in English. Say it must be checked.",
    "Do not state acceptance rates or applicants-per-place figures. Saying in words how selective a course is — and it is required of you — is not the same thing and is not covered by this.",
  ],
};
