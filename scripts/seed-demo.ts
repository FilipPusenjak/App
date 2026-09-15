// A demo counselor account with a caseload you can actually click through.
//
//   npx tsx scripts/seed-demo.ts --yes
//   npx tsx scripts/seed-demo.ts --remove
//
// WHY THIS IS NOT A FIXTURE FILE. Nothing here writes a triage signal. The
// script seeds students — grades, activities with real dates, target schools
// that exist in the researched requirements data — and then runs the REAL
// triage pass over them. What you see on the caseload screen is what the
// detectors actually produced from that data, which is the only version of this
// worth looking at: a hand-written signal would show you a screen the product
// cannot produce.
//
// The same goes for the evaluations. Their threshold and differentiation
// snapshots come from scoreProfile(), the same function the student's own
// dashboard calls, compared against CourseRequirement rows carrying real quotes
// and real source URLs. The numbers are computed, not invented.
//
// WHAT IS INVENTED is the roster: eight people who do not exist, at schools they
// do not attend. They are written to be plausible rather than obviously fake —
// that is the point of the exercise — so every row is tagged, `--remove` deletes
// exactly what was added, and the account name says DEMO where a counselor
// would read it.
//
// EVERY DEMO STUDENT IS FULLY CONSENTED, because an unconsented caseload renders
// as an empty screen and that is not what anyone is trying to look at. On a real
// account both timestamps arrive from two different people.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { parseGradeLevel, scoreProfile } from "@/lib/readiness/score";
import { findRequirementsForTargets } from "@/lib/requirements/lookup";
import { runTriage } from "@/lib/counselor/triage/run";
import {
  sessionPrepNarrativeSchema,
  type SessionPrepNarrative,
} from "@/lib/validation/counselor";

/**
 * The tag on everything this script writes.
 *
 * An email domain rather than a boolean column, because it needs no migration
 * and because `--remove` can then be an exact match rather than a heuristic.
 * `.invalid` is reserved by RFC 2606 precisely so it can never be a real
 * address — nothing seeded here can be mailed, even by accident.
 */
const DEMO_DOMAIN = "coursechart-demo.invalid";
const COUNSELOR_EMAIL = `advisor@${DEMO_DOMAIN}`;
const DEFAULT_PASSWORD = "demo-caseload-2026";
const BCRYPT_COST = 12;

const DAY = 86_400_000;
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const ahead = (days: number) => new Date(now.getTime() + days * DAY);
/** A date at a fixed point in a past year, for activity start dates. */
const on = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

type Item = {
  type: string;
  title: string;
  org?: string;
  description?: string;
  evidenceNotes?: string;
  startDate?: Date;
  endDate?: Date;
  hoursPerWeek?: number;
  rungLevel?: string;
  /** Backdated, so "nobody has touched this in eight months" can be true. */
  updatedDaysAgo?: number;
};

type DemoStudent = {
  key: string;
  name: string;
  gradeLevel: string;
  gradeStatus: string;
  graduationYear: number;
  country: string;
  schoolName: string;
  schoolContext: string;
  curriculum: string;
  gpa: number | null;
  gpaScale: string | null;
  intendedMajor: string;
  careerGoal: string;
  /** Backdates every profile/item/target row, which is what STALE_PROFILE reads. */
  lastStudentEditDaysAgo: number;
  items: Item[];
  scores: { kind: string; label: string; score: string; maxScore?: string; predicted?: boolean }[];
  targets: { name: string; country: string; course: string }[];
  commitments: {
    description: string;
    status: string;
    dueInDays: number | null;
    targetRung?: string;
  }[];
  /** null = no session has ever been held, which is itself a signal. */
  lastSessionHeldDaysAgo: number | null;
  /**
   * Subjects this student was taking at the EARLIER evaluation but is not now.
   *
   * Exists for one detector. THRESHOLD_NEWLY_BINDING is a diff — it fires when
   * a component that was met stops being met — which cannot happen while both
   * snapshots read the same academics.
   *
   * A DROPPED SUBJECT rather than a revised grade, because of what is actually
   * in the researched data: compareToRequirements only adjudicates
   * requiredSubjects and admissionsTest, and the UK records here carry no grade
   * requirement at all. Dropping English in senior year against a school that
   * recommends four years of it is both the realistic case and the one this
   * data can express.
   */
  droppedSubjects?: string[];
  counselorNote?: string;
};

/* ── The roster ────────────────────────────────────────────────────────────
   Eight students chosen so the caseload screen shows its actual range: a few
   who need something this week, and a majority who do not. A demo where
   everyone is flagged teaches the wrong thing about the product — the
   reassurance count is half of what the screen is for. */
const STUDENTS: DemoStudent[] = [
  {
    key: "okonkwo",
    name: "Maya Okonkwo",
    gradeLevel: "Grade 12",
    gradeStatus: "in_progress",
    graduationYear: 2027,
    country: "US",
    schoolName: "East Chapel Hill High School",
    schoolContext:
      "Public magnet, 1,400 students. Offers 22 AP courses; no class rank published. Roughly 40% of the year group takes at least three APs.",
    curriculum: "ap",
    gpa: 4.3,
    gpaScale: "4.0",
    intendedMajor: "Computer Science",
    careerGoal: "Machine learning research, ideally in a lab before graduate school",
    lastStudentEditDaysAgo: 6,
    // Dropped at the start of senior year for a second CS course. Duke
    // recommends four years of English, so this is the change that moves a
    // component — and exactly what a counselor wants to hear about in September
    // rather than in January.
    droppedSubjects: ["AP English Literature and Composition"],
    items: [
      {
        type: "coursework",
        title: "AP Computer Science A",
        org: "East Chapel Hill High School",
        startDate: on(2025, 8, 20),
        endDate: on(2026, 6, 5),
      },
      {
        type: "coursework",
        title: "AP Calculus BC",
        org: "East Chapel Hill High School",
        startDate: on(2026, 8, 19),
      },
      {
        type: "coursework",
        title: "AP Physics C: Mechanics",
        org: "East Chapel Hill High School",
        startDate: on(2026, 8, 19),
      },
      {
        type: "research",
        title: "Undergraduate lab assistant, computer vision group",
        org: "UNC Chapel Hill, Department of Computer Science",
        description:
          "Labelling and cleaning a training set for a gesture-recognition project; wrote the script that de-duplicates frames.",
        evidenceNotes:
          "Named in the acknowledgements of the group's 2026 workshop paper. Supervisor: Dr. Reyes-Whitfield.",
        startDate: on(2025, 6, 16),
        hoursPerWeek: 8,
        rungLevel: "contributor",
        updatedDaysAgo: 12,
      },
      {
        type: "leadership",
        title: "Co-president, Girls Who Code chapter",
        org: "East Chapel Hill High School",
        description:
          "Runs the Tuesday session; grew the chapter from 11 to 34 members over two years and started a Saturday workshop at the public library.",
        startDate: on(2024, 9, 10),
        hoursPerWeek: 4,
        rungLevel: "leader",
        updatedDaysAgo: 20,
      },
      {
        type: "award",
        title: "First place, North Carolina Science Olympiad (Detector Building)",
        org: "NC Science Olympiad",
        startDate: on(2026, 4, 18),
        endDate: on(2026, 4, 18),
        rungLevel: "recognized",
      },
      {
        type: "work",
        title: "Weekend shifts, Foster's Market",
        org: "Foster's Market",
        startDate: on(2025, 3, 1),
        hoursPerWeek: 10,
        rungLevel: "sustained",
        updatedDaysAgo: 30,
      },
    ],
    scores: [
      { kind: "sat", label: "SAT Total", score: "1510", maxScore: "1600" },
      { kind: "ap", label: "AP Computer Science A", score: "5", maxScore: "5" },
      { kind: "ap", label: "AP US History", score: "4", maxScore: "5" },
    ],
    targets: [
      { name: "Duke University", country: "US", course: "Computer Science B.S." },
      { name: "Georgia Institute of Technology", country: "US", course: "Computer Science B.S." },
      { name: "University of Michigan-Ann Arbor", country: "US", course: "Computer Science B.S.E." },
    ],
    commitments: [
      {
        description:
          "Ask Dr. Reyes-Whitfield whether the workshop paper can be cited in the Common App activities list, and how to describe the contribution accurately.",
        status: "COMPLETED",
        dueInDays: -21,
      },
      {
        description: "Draft the Duke supplemental essay about the library workshop.",
        status: "IN_PROGRESS",
        dueInDays: 9,
      },
    ],
    lastSessionHeldDaysAgo: 19,
    counselorNote:
      "Very capable, badly underestimates herself. Do not let her drop Michigan — she brought it up again as 'probably not worth an application'. Mother is the one pushing for early decision; Maya is not sure.",
  },
  {
    key: "reyes",
    name: "Daniel Reyes",
    gradeLevel: "Grade 11",
    gradeStatus: "in_progress",
    graduationYear: 2028,
    country: "US",
    schoolName: "Alhambra High School",
    schoolContext:
      "Large public high school in the San Gabriel Valley. Strong maths department; no research programme.",
    curriculum: "ap",
    gpa: 3.7,
    gpaScale: "4.0",
    intendedMajor: "Mechanical Engineering",
    careerGoal: "Automotive or aerospace design",
    lastStudentEditDaysAgo: 22,
    items: [
      {
        type: "coursework",
        title: "AP Physics 1",
        org: "Alhambra High School",
        startDate: on(2026, 8, 12),
      },
      {
        type: "coursework",
        title: "AP Calculus AB",
        org: "Alhambra High School",
        startDate: on(2026, 8, 12),
      },
      {
        type: "extracurricular",
        title: "FIRST Robotics, mechanical and drivetrain subteam",
        org: "FIRST Robotics Team 5124",
        description:
          "Build season member for two years. Machined the 2025 and 2026 drivetrain; has not moved off the subteam.",
        // Long-running and untouched for eight months: this is what
        // RUNG_STALLED is looking for, and it is a fair thing to raise.
        startDate: on(2024, 10, 7),
        hoursPerWeek: 9,
        rungLevel: "participant",
        updatedDaysAgo: 250,
      },
      {
        type: "volunteering",
        title: "Saturday bike repair clinic",
        org: "Alhambra Community Center",
        startDate: on(2025, 2, 8),
        hoursPerWeek: 3,
        rungLevel: "sustained",
        updatedDaysAgo: 60,
      },
      {
        type: "work",
        title: "Counter and stockroom, Ruiz Hardware",
        org: "Ruiz Hardware",
        startDate: on(2025, 6, 20),
        hoursPerWeek: 12,
        rungLevel: "sustained",
        updatedDaysAgo: 45,
      },
    ],
    scores: [
      { kind: "sat", label: "SAT Total", score: "1290", maxScore: "1600" },
      { kind: "ap", label: "AP World History", score: "3", maxScore: "5" },
    ],
    targets: [
      { name: "University of California, Berkeley", country: "US", course: "Mechanical Engineering B.S." },
      { name: "University of California, Los Angeles", country: "US", course: "Mechanical Engineering B.S." },
      { name: "University of California, San Diego", country: "US", course: "Mechanical Engineering B.S." },
    ],
    commitments: [
      {
        description:
          "Email the robotics mentor about leading the drivetrain subteam next season, rather than building on it again.",
        status: "ACCEPTED",
        // Overdue by five weeks: COMMITMENT_OVERDUE, and the kind a counselor
        // actually wants raised, because the window to ask closes.
        dueInDays: -37,
        targetRung: "leader",
      },
      {
        description: "Register for the October SAT sitting.",
        status: "IN_PROGRESS",
        dueInDays: 11,
      },
    ],
    lastSessionHeldDaysAgo: 41,
    counselorNote:
      "Works twelve hours a week because the family needs it — do not frame the robotics stall as a motivation problem, he has no Saturdays. Worth talking about whether the hardware job is the stronger story anyway.",
  },
  {
    key: "raman",
    name: "Priya Raman",
    gradeLevel: "Year 13",
    gradeStatus: "in_progress",
    graduationYear: 2027,
    country: "GB",
    schoolName: "Watford Grammar School for Girls",
    schoolContext:
      "Selective state grammar. Further Maths available; UCAS applications handled by the sixth-form team.",
    curriculum: "a_levels",
    gpa: null,
    gpaScale: null,
    intendedMajor: "Mathematics",
    careerGoal: "Quantitative research",
    lastStudentEditDaysAgo: 4,
    items: [
      {
        type: "coursework",
        title: "A-Level Mathematics",
        org: "Watford Grammar School for Girls",
        startDate: on(2025, 9, 3),
      },
      {
        type: "coursework",
        title: "A-Level Further Mathematics",
        org: "Watford Grammar School for Girls",
        startDate: on(2025, 9, 3),
      },
      {
        type: "coursework",
        title: "A-Level Physics",
        org: "Watford Grammar School for Girls",
        startDate: on(2025, 9, 3),
      },
      {
        type: "award",
        title: "Gold, UK Senior Mathematical Challenge",
        org: "UK Mathematics Trust",
        startDate: on(2025, 11, 4),
        endDate: on(2025, 11, 4),
        rungLevel: "recognized",
        updatedDaysAgo: 15,
      },
      {
        type: "extracurricular",
        title: "Mathematics olympiad training group",
        org: "UK Mathematics Trust",
        description: "Weekly problem sessions; sat BMO1 in November 2025.",
        startDate: on(2025, 9, 20),
        hoursPerWeek: 3,
        rungLevel: "contributor",
        updatedDaysAgo: 18,
      },
      {
        type: "volunteering",
        title: "Maths tutoring, Year 9 catch-up scheme",
        org: "Watford Grammar School for Girls",
        startDate: on(2026, 1, 12),
        hoursPerWeek: 2,
        rungLevel: "sustained",
        updatedDaysAgo: 25,
      },
    ],
    scores: [
      { kind: "predicted_grade", label: "Mathematics", score: "A*", predicted: true },
      { kind: "predicted_grade", label: "Further Mathematics", score: "A*", predicted: true },
      { kind: "predicted_grade", label: "Physics", score: "A", predicted: true },
      { kind: "gcse", label: "GCSE (grade 9s)", score: "8", maxScore: "10" },
    ],

    targets: [
      { name: "Imperial College London", country: "GB", course: "Mathematics B.Sc." },
      { name: "University of Warwick", country: "GB", course: "Mathematics B.Sc." },
      { name: "University College London (UCL)", country: "GB", course: "Mathematics B.Sc." },
    ],
    commitments: [
      {
        description: "Finish the personal statement draft covering the BMO1 problem she got stuck on.",
        status: "IN_PROGRESS",
        dueInDays: 6,
      },
    ],
    lastSessionHeldDaysAgo: 13,
    counselorNote:
      "On top of everything. Needs STEP II/III practice more than she needs me — check she has actually booked the sitting.",
  },
  {
    key: "ricci",
    name: "Sofia Ricci",
    gradeLevel: "Grade 10",
    gradeStatus: "in_progress",
    graduationYear: 2029,
    country: "US",
    schoolName: "Newton North High School",
    schoolContext: "Large suburban public school outside Boston. Wide arts programme.",
    curriculum: "other",
    gpa: 3.5,
    gpaScale: "4.0",
    intendedMajor: "Undecided",
    careerGoal: "",
    // Nothing touched since the spring. On a 10th grader that is ordinary
    // enough not to be an emergency, which is why severity is grade-aware.
    lastStudentEditDaysAgo: 156,
    items: [
      {
        type: "coursework",
        title: "Honors Biology",
        org: "Newton North High School",
        startDate: on(2026, 9, 2),
      },
      {
        type: "extracurricular",
        title: "Concert band, clarinet",
        org: "Newton North High School",
        startDate: on(2024, 9, 5),
        hoursPerWeek: 4,
        rungLevel: "sustained",
        updatedDaysAgo: 156,
      },
      {
        type: "volunteering",
        title: "Animal shelter weekend shifts",
        org: "Newton Animal Rescue",
        startDate: on(2025, 6, 14),
        hoursPerWeek: 3,
        rungLevel: "participant",
        updatedDaysAgo: 156,
      },
    ],
    scores: [],
    targets: [
      { name: "Boston University", country: "US", course: "Biology B.A." },
      { name: "Northeastern University", country: "US", course: "Biology B.S." },
    ],
    commitments: [],
    // Never met. With no held session at all this raises NO_RECENT_SESSION,
    // which is the signal that catches the student who quietly goes missing.
    lastSessionHeldDaysAgo: null,
  },
  {
    key: "brooks",
    name: "Ethan Brooks",
    gradeLevel: "Grade 11",
    gradeStatus: "in_progress",
    graduationYear: 2028,
    country: "US",
    schoolName: "Shaker Heights High School",
    schoolContext: "Public, strong debate and music programmes, IB diploma offered.",
    curriculum: "ib",
    gpa: 3.9,
    gpaScale: "4.0",
    intendedMajor: "Biology",
    // Says medicine; the portfolio is entirely music and debate. That gap is
    // the observation — GOAL_TRAJECTORY_MISMATCH names it without judging it,
    // because the honest reading might be that the goal is wrong, not the
    // activities.
    careerGoal: "Medicine",
    lastStudentEditDaysAgo: 11,
    items: [
      {
        type: "coursework",
        title: "IB Biology HL",
        org: "Shaker Heights High School",
        startDate: on(2026, 8, 24),
      },
      {
        type: "coursework",
        title: "IB Chemistry HL",
        org: "Shaker Heights High School",
        startDate: on(2026, 8, 24),
      },
      {
        type: "leadership",
        title: "Captain, varsity policy debate",
        org: "Shaker Heights High School",
        startDate: on(2024, 9, 16),
        hoursPerWeek: 10,
        rungLevel: "leader",
        updatedDaysAgo: 14,
      },
      {
        type: "extracurricular",
        title: "Principal cellist, youth symphony",
        org: "Cleveland Youth Orchestra",
        startDate: on(2023, 9, 11),
        hoursPerWeek: 7,
        rungLevel: "contributor",
        updatedDaysAgo: 22,
      },
      {
        type: "extracurricular",
        title: "Model United Nations",
        org: "Shaker Heights High School",
        startDate: on(2025, 9, 15),
        hoursPerWeek: 3,
        rungLevel: "participant",
        updatedDaysAgo: 40,
      },
      {
        type: "work",
        title: "Summer camp counsellor",
        org: "Camp Wise",
        startDate: on(2026, 6, 22),
        endDate: on(2026, 8, 7),
        hoursPerWeek: 40,
        rungLevel: "sustained",
        updatedDaysAgo: 35,
      },
    ],
    scores: [
      { kind: "sat", label: "SAT Total", score: "1440", maxScore: "1600" },
      { kind: "ib_subject", label: "Biology HL (predicted)", score: "6", maxScore: "7", predicted: true },
    ],
    targets: [
      { name: "University of Michigan-Ann Arbor", country: "US", course: "Biology, Health, and Society Major" },
      { name: "Duke University", country: "US", course: "Biology B.S." },
    ],
    commitments: [
      {
        description:
          "Shadow or interview someone working in medicine before choosing between the BS/MD applications and a straight biology route.",
        status: "ACCEPTED",
        dueInDays: 24,
      },
    ],
    lastSessionHeldDaysAgo: 27,
    counselorNote:
      "The medicine answer came from his father. Worth asking, gently, whether he has ever actually been in a hospital — everything he lights up about is the debate room.",
  },
  {
    key: "diallo",
    name: "Amara Diallo",
    gradeLevel: "Grade 12",
    gradeStatus: "in_progress",
    graduationYear: 2027,
    country: "US",
    schoolName: "Benjamin Banneker Academic High School",
    schoolContext: "Selective public magnet in Washington DC. All students take at least four APs.",
    curriculum: "ap",
    gpa: 4.0,
    gpaScale: "4.0",
    intendedMajor: "Public Policy",
    careerGoal: "Housing policy",
    lastStudentEditDaysAgo: 9,
    items: [
      {
        type: "coursework",
        title: "AP Government and Politics",
        org: "Benjamin Banneker Academic High School",
        startDate: on(2026, 8, 25),
      },
      {
        type: "coursework",
        title: "AP Statistics",
        org: "Benjamin Banneker Academic High School",
        startDate: on(2026, 8, 25),
      },
      {
        type: "leadership",
        title: "Policy lead, DC Youth Advisory Council",
        org: "DC Youth Advisory Council",
        description:
          "Wrote the council's testimony on the 2026 tenant-protection bill and delivered it at the Council hearing.",
        startDate: on(2024, 10, 2),
        // Ended this summer. The activity that carried the profile has stopped,
        // which is what the differentiation band falling actually reflects.
        endDate: on(2026, 6, 30),
        hoursPerWeek: 6,
        rungLevel: "leader",
        updatedDaysAgo: 70,
      },
      {
        type: "volunteering",
        title: "Tenant clinic intake volunteer",
        org: "Bread for the City",
        startDate: on(2025, 7, 7),
        endDate: on(2026, 5, 30),
        hoursPerWeek: 4,
        rungLevel: "sustained",
        updatedDaysAgo: 80,
      },
      {
        type: "extracurricular",
        title: "School newspaper, city desk",
        org: "Benjamin Banneker Academic High School",
        startDate: on(2026, 9, 8),
        hoursPerWeek: 2,
        rungLevel: "participant",
        updatedDaysAgo: 9,
      },
    ],
    scores: [
      { kind: "sat", label: "SAT Total", score: "1470", maxScore: "1600" },
      { kind: "ap", label: "AP US History", score: "5", maxScore: "5" },
    ],
    targets: [
      { name: "Duke University", country: "US", course: "Public Policy B.A." },
      { name: "University of Michigan-Ann Arbor", country: "US", course: "Political Science Major" },
      { name: "University of California, Berkeley", country: "US", course: "Political Science B.A." },
    ],
    commitments: [
      {
        description: "Ask the council chair for a recommendation letter before applications open.",
        status: "ACCEPTED",
        dueInDays: -9,
      },
    ],
    lastSessionHeldDaysAgo: 33,
    counselorNote:
      "Her strongest thread ended when she aged out of the council. She knows. The question for Tuesday is what replaces it in senior year, not whether it was her fault.",
  },
  {
    key: "chen",
    name: "Liam Chen",
    gradeLevel: "Grade 9",
    gradeStatus: "in_progress",
    graduationYear: 2030,
    country: "US",
    schoolName: "Lowell High School",
    schoolContext: "Selective public school in San Francisco.",
    curriculum: "other",
    gpa: 3.8,
    gpaScale: "4.0",
    intendedMajor: "Undecided",
    careerGoal: "",
    lastStudentEditDaysAgo: 8,
    items: [
      {
        type: "coursework",
        title: "Geometry",
        org: "Lowell High School",
        startDate: on(2026, 8, 17),
      },
      {
        type: "extracurricular",
        title: "Junior varsity swimming",
        org: "Lowell High School",
        startDate: on(2026, 9, 1),
        hoursPerWeek: 8,
        rungLevel: "participant",
        updatedDaysAgo: 8,
      },
    ],
    scores: [],
    targets: [],
    commitments: [],
    lastSessionHeldDaysAgo: 30,
    counselorNote:
      "Ninth grade. Nothing to do here but keep the door open — his sister was a client and the parents are anxious three years early.",
  },
  {
    key: "haddad",
    name: "Noor Haddad",
    gradeLevel: "Grade 11",
    gradeStatus: "in_progress",
    graduationYear: 2028,
    country: "US",
    schoolName: "Dearborn High School",
    schoolContext: "Public high school in Dearborn, Michigan. Large Arabic-speaking student body.",
    curriculum: "ap",
    gpa: 3.95,
    gpaScale: "4.0",
    intendedMajor: "Environmental Science",
    careerGoal: "Water policy in the Great Lakes basin",
    lastStudentEditDaysAgo: 5,
    items: [
      {
        type: "coursework",
        title: "AP Environmental Science",
        org: "Dearborn High School",
        startDate: on(2026, 8, 31),
      },
      {
        type: "coursework",
        title: "AP Chemistry",
        org: "Dearborn High School",
        startDate: on(2026, 8, 31),
      },
      {
        type: "research",
        title: "Rouge River water-quality monitoring",
        org: "Friends of the Rouge",
        description:
          "Monthly sampling at three sites; built the spreadsheet the volunteer group now uses to log results.",
        startDate: on(2025, 4, 12),
        hoursPerWeek: 5,
        rungLevel: "contributor",
        updatedDaysAgo: 10,
      },
      {
        type: "leadership",
        title: "Founder, school environmental council",
        org: "Dearborn High School",
        startDate: on(2025, 9, 22),
        hoursPerWeek: 4,
        rungLevel: "builder",
        updatedDaysAgo: 16,
      },
    ],
    scores: [{ kind: "sat", label: "SAT Total", score: "1380", maxScore: "1600" }],
    targets: [
      { name: "Duke University", country: "US", course: "Environmental Sciences and Policy B.S." },
      { name: "University of Chicago", country: "US", course: "Environmental Science Major" },
    ],
    commitments: [
      {
        description: "Write up the sampling method as a short abstract for the state science fair.",
        status: "IN_PROGRESS",
        dueInDays: 18,
      },
    ],
    lastSessionHeldDaysAgo: 21,
    counselorNote:
      "The river project is the whole application. Make sure she describes building the spreadsheet — she keeps leaving it out because it 'isn't science'.",
  },
];

/* ── Prep narratives ───────────────────────────────────────────────────────
   The one thing here a model would normally write. Hand-written for the three
   students whose detail page is worth opening, and validated against the real
   schema before it is stored — a narrative that does not parse renders as a
   blank card, which is a confusing way to find out about a typo.

   Written to the prompt's own rules rather than to make the product look
   clever: every discussion point carries the computed basis behind it, every
   option states what it costs, and the questions are things only a person in
   the room can find out. */
const NARRATIVES: Record<string, SessionPrepNarrative> = {
  okonkwo: {
    headline:
      "Dropping AP English Literature put two of her three targets below their recommended subject coverage, six weeks before the deadline.",
    sinceLastSession:
      "The schedule change went in on 2 September. Duke and Georgia Tech both recommend four years of English; the requirement check moved from partial to unmet at both, and the Michigan application is unaffected. Nothing else on the profile changed: the lab work continues at eight hours a week and the Science Olympiad result is unchanged.",
    discussionPoints: [
      {
        point:
          "Ask what the schedule change was actually for. If it was to take a second CS course, that is a defensible trade she should be ready to explain; if it was to lighten the load, that is a different conversation.",
        basis: "threshold.component_newly_unmet — Duke, Required subjects, PARTIAL to UNMET",
        urgency: "NOW",
      },
      {
        point:
          "The counsellor's letter is the only place this can be contextualised before the deadline. Decide today whether it needs a line about the schedule.",
        basis: "cycle.application_deadline_with_unmet_components — 46 days, 2 components unmet",
        urgency: "NOW",
      },
      {
        point:
          "She has raised dropping Michigan twice. It is the one target the change does not affect.",
        basis: "counselor note, session of 27 Aug",
        urgency: "THIS_TERM",
      },
    ],
    questionsToAsk: [
      "Whose decision was the schedule change — hers, or the school's timetable?",
      "Does she know Duke states a four-year English recommendation, or did she read it as optional?",
      "Is the early-decision plan hers or her mother's? She has answered differently on different days.",
      "Has the lab supervisor agreed to write anything, and by when?",
    ],
    optionsToConsider: [
      {
        option: "Ask the lab supervisor how to describe the paper contribution accurately.",
        tradeoff:
          "Costs her a slightly awkward email and may come back as 'acknowledgements only', which is less than she hopes it is.",
        feasibility: "FEASIBLE",
        basis: "activity.rung — research, contributor, 15 months",
      },
      {
        option:
          "Pick up an English course in the spring semester, even pass/fail, to close the coverage gap.",
        tradeoff:
          "Spring grades reach very few of these schools in time, so this fixes the record rather than the application. It also costs the second CS course she moved for.",
        feasibility: "TIGHT",
        basis: "threshold.component_newly_unmet — 2 schools, Required subjects",
      },
    ],
    whatIMayHaveMissed:
      "Both unmet components are the same component at two schools, so it reads as two problems and is one. The underlying fact is a single schedule change, and one sentence in the letter answers it for both.",
  },
  reyes: {
    headline:
      "Two years on the same robotics subteam, and the commitment to ask about leading it is five weeks past its date.",
    sinceLastSession:
      "Nothing has moved on the robotics entry since January. The season starts in eight weeks, which is when subteam leads are decided. The hardware-store hours went up over the summer and are now twelve a week.",
    discussionPoints: [
      {
        point:
          "The ask has a deadline attached to it that is not on the commitment: leads are picked before the season, not during it.",
        basis: "commitment.past_due_unresolved — 37 days overdue, status ACCEPTED",
        urgency: "NOW",
      },
      {
        point:
          "Twenty-three months at participant on a two-year activity is the observation. Whether it matters depends on what else those hours bought.",
        basis: "activity.rung_stalled — 23 months running, 8 since updated",
        urgency: "THIS_TERM",
      },
    ],
    questionsToAsk: [
      "Did he not send the email, or did he send it and hear nothing back?",
      "Does he want to lead the subteam, or did he agree because it was suggested?",
      "How many hours is the store actually taking in a normal week now?",
      "Is the money his own or the household's? It changes what can be suggested.",
    ],
    optionsToConsider: [
      {
        option: "Suggest dropping the hardware-store job to free up Saturdays for robotics.",
        tradeoff:
          "Assumes the income is discretionary. If it is not, raising it costs trust and gains nothing.",
        feasibility: "FEASIBLE",
        basis: "activity.rung_stalled — drivetrain subteam, 23 months at participant",
      },
      {
        option:
          "Write the store work up as the primary thread instead, with the responsibility it actually carries.",
        tradeoff:
          "Reads as less conventionally impressive to a reader skimming for robotics, and he may resist it.",
        feasibility: "FEASIBLE",
        basis: "resume.work — 15 months, 12 hours per week",
      },
    ],
    whatIMayHaveMissed:
      "The stall and the job are almost certainly the same fact. A student working twelve hours a week does not have the Saturdays that subteam leads are expected to give, and reading the first without the second would land on the wrong conversation.",
  },
  diallo: {
    headline:
      "Her strongest thread ended in June when she aged out of the youth council, and the recommendation letter ask is nine days past its date.",
    sinceLastSession:
      "The council role and the tenant clinic both ended before the summer. The newspaper role started this month and is two hours a week. Nothing on the record has replaced the council work, and the letter request has not gone out.",
    discussionPoints: [
      {
        point:
          "The letter is the urgent half. The chair is hardest to reach once the autumn session starts.",
        basis: "commitment.past_due_unresolved — 9 days overdue, status ACCEPTED",
        urgency: "NOW",
      },
      {
        point:
          "Two targets show unmet subject coverage with the deadline inside seven weeks.",
        basis: "cycle.application_deadline_with_unmet_components — 46 days, 2 unmet",
        urgency: "NOW",
      },
      {
        point:
          "Senior year has no continuation of the housing work on the record. That is a question about the application's shape, not about her effort.",
        basis: "resume — council and clinic both ended before 30 Jun",
        urgency: "THIS_TERM",
      },
    ],
    questionsToAsk: [
      "Has she spoken to the chair at all since June, or does the ask have to start cold?",
      "Is there an alumni or advisory route back into the council she has not considered?",
      "Does she want to keep doing housing work, or was it the council she liked?",
      "Who else saw the testimony work closely enough to write about it?",
    ],
    optionsToConsider: [
      {
        option: "Name what replaces the youth council in senior year before applications open.",
        tradeoff:
          "Anything started now is two months old at submission, and a reader can tell. The honest version treats it as continuation, not as a new thread.",
        feasibility: "TIGHT",
        basis: "resume — council ended 30 Jun, nothing since",
      },
    ],
    whatIMayHaveMissed:
      "The testimony at the Council hearing is the single most distinctive thing on this record and it appears as one line inside an activity that has ended. It is doing far less work on the page than it did in life.",
  },
};

/* ── Removal ───────────────────────────────────────────────────────────────
   Exact, not heuristic: every account this script creates is on one reserved
   domain, and deleting those users cascades to profiles, links, signals,
   evaluations and everything else hanging off them. */
async function remove() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${DEMO_DOMAIN}` } },
    select: { id: true, email: true },
  });
  if (users.length === 0) {
    console.log("Nothing to remove — no demo accounts found.");
    return;
  }
  const { count } = await prisma.user.deleteMany({
    where: { id: { in: users.map((u) => u.id) } },
  });
  console.log(`Removed ${count} demo account(s):`);
  for (const u of users) console.log(`  ${u.email}`);
}

async function seed(password: string) {
  const existing = await prisma.user.count({
    where: { email: { endsWith: `@${DEMO_DOMAIN}` } },
  });
  if (existing > 0) {
    console.error(
      `There are already ${existing} demo accounts in this database.\n` +
        "Run with --remove first if you want to start clean.",
    );
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const counselorUser = await prisma.user.create({
    data: {
      email: COUNSELOR_EMAIL,
      passwordHash,
      name: "Rachel Nwosu",
      countryOfOrigin: "US",
      dateOfBirth: new Date("1986-03-14"),
    },
  });
  const account = await prisma.counselorAccount.create({
    data: {
      userId: counselorUser.id,
      // Says DEMO where a counselor reads their own org name, so a screenshot
      // of this cannot be mistaken for a real caseload.
      orgName: "DEMO — Northside College Advising",
      type: "INDEPENDENT",
      caseloadLimit: 40,
    },
  });

  console.log(`Counselor: ${COUNSELOR_EMAIL}`);

  for (const s of STUDENTS) {
    await seedStudent(s, account.id, passwordHash);
    console.log(`  + ${s.name} (${s.gradeLevel})`);
  }

  /* ── The real triage pass ────────────────────────────────────────────────
     Everything above is student data. This is where the signals come from, and
     it is the same function the nightly job calls. */
  const result = await runTriage({ counselorAccountId: account.id });
  console.log(
    `\nTriage: ${result.signalsWritten} signals across ${result.linksExamined} students, ` +
      `${result.modelCalls} model calls.`,
  );

  const signals = await prisma.triageSignal.findMany({
    where: { counselorAccountId: account.id, resolvedAt: null },
    select: { kind: true, severity: true, caseloadLink: { select: { studentProfile: { select: { studentName: true } } } } },
    orderBy: { severity: "desc" },
  });
  for (const sig of signals) {
    console.log(
      `  [${sig.severity}] ${sig.kind} — ${sig.caseloadLink.studentProfile.studentName}`,
    );
  }

  console.log(`\nSign in at /login as ${COUNSELOR_EMAIL} with the password above.`);
  console.log("Remove it all again with: npx tsx scripts/seed-demo.ts --remove");
}

async function seedStudent(s: DemoStudent, accountId: string, passwordHash: string) {
  const studentUser = await prisma.user.create({
    data: {
      email: `${s.key}@${DEMO_DOMAIN}`,
      passwordHash,
      name: s.name,
      countryOfOrigin: s.country,
    },
  });

  const profile = await prisma.profile.create({
    data: {
      userId: studentUser.id,
      studentName: s.name,
      countryOfOrigin: s.country,
      gradeLevel: s.gradeLevel,
      gradeStatus: s.gradeStatus,
      graduationYear: s.graduationYear,
      schoolName: s.schoolName,
      schoolContext: s.schoolContext,
      curriculum: s.curriculum,
      gpa: s.gpa,
      gpaScale: s.gpaScale,
      intendedMajor: s.intendedMajor,
      careerGoal: s.careerGoal || null,
    },
  });

  for (const item of s.items) {
    const row = await prisma.resumeItem.create({
      data: {
        profileId: profile.id,
        type: item.type,
        title: item.title,
        org: item.org ?? null,
        description: item.description ?? null,
        evidenceNotes: item.evidenceNotes ?? null,
        startDate: item.startDate ?? null,
        endDate: item.endDate ?? null,
        hoursPerWeek: item.hoursPerWeek ?? null,
        rungLevel: item.rungLevel ?? null,
      },
    });
    // EVERY item, not only the ones carrying an explicit age. lastStudentEditAt
    // is the MAX across the profile and all its items, so one row left at "now"
    // makes the whole profile look edited this morning — which silently
    // disables STALE_PROFILE for every student in the seed.
    await backdate(
      "ResumeItem",
      row.id,
      ago(item.updatedDaysAgo ?? s.lastStudentEditDaysAgo),
    );
  }

  for (const t of s.scores) {
    await prisma.testScore.create({
      data: {
        profileId: profile.id,
        kind: t.kind,
        label: t.label,
        score: t.score,
        maxScore: t.maxScore ?? null,
        predicted: t.predicted ?? false,
      },
    });
  }

  for (const t of s.targets) {
    const row = await prisma.targetSchool.create({
      data: {
        profileId: profile.id,
        name: t.name,
        country: t.country,
        course: t.course,
      },
    });
    await backdate("TargetSchool", row.id, ago(s.lastStudentEditDaysAgo));
  }

  const link = await prisma.caseloadLink.create({
    data: {
      counselorAccountId: accountId,
      studentUserId: studentUser.id,
      studentProfileId: profile.id,
      status: "ACTIVE",
      invitedBy: "STUDENT",
      scope: "FULL",
      studentConsentAt: ago(s.lastStudentEditDaysAgo + 30),
      guardianConsentAt: ago(s.lastStudentEditDaysAgo + 29),
      startedAt: ago(s.lastStudentEditDaysAgo + 29),
    },
  });

  const commitmentRows = [];
  for (const c of s.commitments) {
    commitmentRows.push(
      await prisma.commitment.create({
        data: {
          profileId: profile.id,
          description: c.description,
          status: c.status,
          targetRung: c.targetRung ?? null,
          dueDate: c.dueInDays == null ? null : ahead(c.dueInDays),
          resolvedAt: c.status === "COMPLETED" ? ago(18) : null,
        },
      }),
    );
  }

  await seedEvaluations(s, profile.id);

  if (s.lastSessionHeldDaysAgo != null) {
    const prep = await prisma.sessionPrep.create({
      data: {
        caseloadLinkId: link.id,
        counselorAccountId: accountId,
        generatedAt: ago(s.lastSessionHeldDaysAgo),
        rubricVersion: "demo-seed",
        promptVersion: "demo-seed",
        outcome: "HELD",
        counselorNotes: s.counselorNote ?? null,
        triageSignalIds: [],
        // Parsed before it is stored. An unparseable narrative renders as an
        // empty card rather than an error, which is a slow way to find a typo.
        narrative: NARRATIVES[s.key]
          ? sessionPrepNarrativeSchema.parse(NARRATIVES[s.key])
          : undefined,
      },
    });

    // What the counselor did with the advice. DECLINED_BY_COUNSELOR is the row
    // that makes the follow-through panel say anything interesting — it is the
    // only place a professional's judgement about the app's own suggestion is
    // recorded.
    if (s.key === "reyes") {
      await prisma.counselorRecommendation.create({
        data: {
          sessionPrepId: prep.id,
          caseloadLinkId: link.id,
          text: "Suggest dropping the hardware-store job to free up Saturdays for robotics.",
          basis: "activity.rung_stalled — drivetrain subteam, 23 months at participant",
          source: "MODEL_SUGGESTED",
          status: "DECLINED_BY_COUNSELOR",
          declineReason:
            "The job is not optional for this family. Raising it would have cost me his trust for nothing.",
        },
      });
    }
    if (s.key === "okonkwo" && commitmentRows[0]) {
      await prisma.counselorRecommendation.create({
        data: {
          sessionPrepId: prep.id,
          caseloadLinkId: link.id,
          text: "Ask the lab supervisor how to describe the paper contribution accurately.",
          basis: "activity.rung — research, contributor, 15 months",
          source: "MODEL_SUGGESTED",
          status: "ACCEPTED_BY_STUDENT",
          deliveredAt: ago(s.lastSessionHeldDaysAgo),
          linkedCommitmentId: commitmentRows[0].id,
        },
      });
    }
    if (s.key === "diallo") {
      await prisma.counselorRecommendation.create({
        data: {
          sessionPrepId: prep.id,
          caseloadLinkId: link.id,
          text: "Name what replaces the youth council in senior year before applications open.",
          basis: "differentiation.band_fell — distinctive to competitive",
          source: "COUNSELOR_AUTHORED",
          status: "DELIVERED",
          deliveredAt: ago(s.lastSessionHeldDaysAgo),
        },
      });
    }
  }

  await backdate("Profile", profile.id, ago(s.lastStudentEditDaysAgo));
}

/**
 * Two evaluations, so the diff detectors have something to read.
 *
 * The snapshots are COMPUTED by scoreProfile against the researched
 * requirements, not written by hand — which means THRESHOLD_NEWLY_BINDING and
 * TRAJECTORY_DROP fire only when this student's data genuinely produces them.
 * If the roster changes and a signal stops appearing, that is the detector
 * being right, not the seed being broken.
 */
async function seedEvaluations(s: DemoStudent, profileId: string) {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: { resumeItems: true, testScores: true, targetSchools: true },
  });

  const requirements = await findRequirementsForTargets(
    profile.targetSchools.map((t) => ({
      name: t.name,
      country: t.country,
      course: t.course,
    })),
  );

  const subjects = profile.resumeItems
    .filter((i) => i.type === "coursework")
    .map((i) => i.title);
  const academics = {
    gpa: profile.gpa,
    gpaScale: profile.gpaScale,
    curriculum: profile.curriculum,
    testScores: profile.testScores.map((t) => ({
      kind: t.kind,
      label: t.label,
      score: t.score,
      predicted: t.predicted,
    })),
    subjects,
  };
  // What was on record at the earlier evaluation, when it differs.
  const earlierAcademics = s.droppedSubjects?.length
    ? { ...academics, subjects: [...subjects, ...s.droppedSubjects] }
    : academics;
  const asScoreItem = (i: (typeof profile.resumeItems)[number]) => ({
    id: i.id,
    title: i.title,
    type: i.type,
    description: i.description,
    evidenceNotes: i.evidenceNotes,
    startDate: i.startDate,
    endDate: i.endDate,
    hoursPerWeek: i.hoursPerWeek,
  });
  const resolved = requirements.map((r) => ({
    targetName: r.targetName,
    course: r.course,
    requirements: r.requirements,
    primarySourceUrl: r.primarySourceUrl,
  }));

  // The EARLIER evaluation, scored as of three months ago. Activities that had
  // not started yet are excluded, which is what makes the two snapshots differ
  // for the right reason rather than by fiat.
  const earlierAt = ago(96);
  const earlier = scoreProfile({
    gradeLevel: parseGradeLevel(profile.gradeLevel),
    academics: earlierAcademics,
    resumeItems: profile.resumeItems
      .filter((i) => !i.startDate || i.startDate <= earlierAt)
      .map(asScoreItem),
    requirements: resolved,
    now: earlierAt,
  });

  // The LATER one, as of today. For Amara the council thread has since ended,
  // so her band falls between the two on its own.
  const later = scoreProfile({
    gradeLevel: parseGradeLevel(profile.gradeLevel),
    academics,
    resumeItems: profile.resumeItems.map(asScoreItem),
    requirements: resolved,
    now,
  });

  const first = await prisma.evaluation.create({
    data: {
      profileId,
      status: "completed",
      type: "DEEP_REVIEW",
      rubricVersion: earlier.rubricVersion,
      thresholdSnapshotJson: JSON.stringify(earlier.threshold),
      differentiationSnapshotJson: JSON.stringify(earlier.differentiation),
      paceStatus: earlier.pace.status,
      overallScore: bandScore(earlier.differentiation.band),
      // NOT flagged as a sample: a sample evaluation is excluded from triage by
      // design, and an excluded evaluation would make half the caseload screen
      // blank. The snapshots here are real computations over real requirement
      // data — what is fictional is the student, not the arithmetic.
      isSample: false,
      promptVersion: "demo-seed",
      chartPointJson: JSON.stringify({
        overallScore: bandScore(earlier.differentiation.band),
        schoolFits: [],
      }),
    },
  });
  await backdate("Evaluation", first.id, earlierAt);

  const second = await prisma.evaluation.create({
    data: {
      profileId,
      status: "completed",
      type: "CHECK_IN",
      rubricVersion: later.rubricVersion,
      thresholdSnapshotJson: JSON.stringify(later.threshold),
      differentiationSnapshotJson: JSON.stringify(later.differentiation),
      paceStatus: later.pace.status,
      overallScore: bandScore(later.differentiation.band),
      materialChange: true,
      precedingEvaluationId: first.id,
      isSample: false,
      promptVersion: "demo-seed",
      chartPointJson: JSON.stringify({
        overallScore: bandScore(later.differentiation.band),
        schoolFits: [],
      }),
    },
  });
  await backdate("Evaluation", second.id, ago(7));
}

/** A headline number for the chart, derived from the band rather than invented. */
function bandScore(band: string): number {
  const at = ["emerging", "developing", "competitive", "distinctive"].indexOf(band);
  return at < 0 ? 50 : [38, 54, 71, 86][at]!;
}

/**
 * Move a row's timestamps into the past.
 *
 * Raw SQL because `updatedAt` is `@updatedAt`: Prisma owns that column and
 * overwrites whatever you pass. Backdating matters more than it looks — half
 * these detectors are asking "how long has this been true", and a seed where
 * everything happened three seconds ago produces a caseload with nothing on it.
 */
async function backdate(table: string, id: string, at: Date) {
  // Which timestamp columns this table actually has, asked once per table.
  // Evaluation carries createdAt and no updatedAt — an immutable row has
  // nothing to update — so a fixed statement would work everywhere except the
  // one table whose dates the diff detectors read.
  let columns = timestampColumns.get(table);
  if (!columns) {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = ${table} AND column_name IN ('createdAt', 'updatedAt')
    `;
    columns = rows.map((r) => r.column_name);
    timestampColumns.set(table, columns);
  }
  if (columns.length === 0) return;

  const sets = columns
    .map((c) => (c === "createdAt" ? `"createdAt" = LEAST("createdAt", $1)` : `"${c}" = $1`))
    .join(", ");
  await prisma.$executeRawUnsafe(
    `UPDATE "${table}" SET ${sets} WHERE "id" = $2`,
    at,
    id,
  );
}
const timestampColumns = new Map<string, string[]>();

async function main() {
  const args = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  // Printed before anything happens, every time. This script writes eight
  // fictional students into whatever database it is pointed at, and the only
  // thing standing between a demo and a production caseload is knowing which
  // one is which.
  const target = new URL(url);
  console.log(`Database: ${target.hostname}${target.pathname}\n`);

  if (args.includes("--remove")) {
    await remove();
    return;
  }

  if (!args.includes("--yes")) {
    console.log(
      "This writes a demo counselor account and 8 fictional students to the database above.\n" +
        "Re-run with --yes to go ahead, or --remove to delete a previous run.",
    );
    return;
  }

  const passwordArg = args.find((a) => a.startsWith("--password="));
  const password = passwordArg ? passwordArg.slice("--password=".length) : DEFAULT_PASSWORD;
  console.log(`Password: ${password}\n`);

  await seed(password);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
