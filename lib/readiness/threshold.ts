// Threshold components: the things a course requires, and whether they are met.
//
// THE MODEL NEVER COMPUTES ANY OF THIS. Every comparison here is arithmetic
// against a researched requirement, done in code, so the model receives
// "required A*AA, predicted A*AA, met" and does interpretation only. Asking a
// language model to compare grades is asking it to recall or calculate a fact,
// which is the failure mode this whole layer exists to remove.
//
// The comparisons run against `CourseRequirement` — published entry
// requirements, each carrying the quote and URL it came from. Deliberately NOT
// against admitted-student quartiles: this app has no such data, and the
// requirement a university publishes is a threshold it actually stated, while a
// quartile is a description of who got in. Only the first can be "met".
//
// A THRESHOLD CAPS AT MET. Exceeding a stated requirement does not accumulate:
// a course asking A*AA is not more satisfied by A*A*A*, and letting it be would
// let extra depth in one place paper over an unmet prerequisite in another.
// That is the entire reason threshold and differentiation are separate outputs.
//
// Pure: takes already-loaded rows, returns a snapshot. No Prisma here.
import type { Requirements } from "@/lib/validation/course-requirements";

export const THRESHOLD_STATES = ["MET", "PARTIAL", "UNMET", "UNKNOWN"] as const;
export type ThresholdState = (typeof THRESHOLD_STATES)[number];

export type ThresholdComponent = {
  /** e.g. "gradeRequirement", "admissionsTest". */
  field: string;
  label: string;
  state: ThresholdState;
  /** What the source says is required, verbatim from the researched record. */
  required: string;
  /** What the student has, as they entered it. Null when they have not said. */
  has: string | null;
  /** Where the requirement came from, so nothing here is unattributable. */
  sourceUrl: string;
};

export type SchoolThreshold = {
  school: string;
  course: string;
  country: string;
  components: ThresholdComponent[];
  /** Counts, not a score. A ratio would be a scalar and invite blending. */
  met: number;
  unmet: number;
  unknown: number;
};

export type ThresholdSnapshot = {
  schools: SchoolThreshold[];
  /**
   * True when no target had researched requirements at all, so nothing here is
   * evidence of anything. The prompts must say "not checked" rather than
   * letting an empty snapshot read as "nothing required".
   */
  noDataForAnyTarget: boolean;
};

const LABELS: Record<string, string> = {
  gradeRequirement: "Grades",
  requiredSubjects: "Required subjects",
  admissionsTest: "Admissions test",
  languageRequirement: "Language",
  interview: "Interview",
  workExperience: "Work experience",
  restrictedEntry: "Restricted entry",
  applicationRoute: "How to apply",
};

export type StudentAcademics = {
  gpa: number | null;
  gpaScale: string | null;
  curriculum: string | null;
  /** Every score the student has recorded, predicted or sat. */
  testScores: { kind: string; label: string; score: string; predicted: boolean }[];
  /** Subjects they are taking, from coursework items. */
  subjects: string[];
};

export type ResolvedRequirementLike = {
  targetName: string;
  course: string;
  country?: string;
  requirements: Requirements;
  primarySourceUrl: string;
};

/**
 * Compare one student against one course's published requirements.
 *
 * The comparison is deliberately conservative: anything this cannot decide
 * mechanically becomes UNKNOWN rather than a guess in either direction. An
 * UNKNOWN is honest and costs the student a "check this"; a wrong MET tells
 * them they have cleared a bar they have not.
 */
export function compareToRequirements(
  student: StudentAcademics,
  record: ResolvedRequirementLike,
): SchoolThreshold {
  const components: ThresholdComponent[] = [];

  for (const [field, label] of Object.entries(LABELS)) {
    const fact = record.requirements[field as keyof Requirements];
    if (!fact) continue;

    components.push({
      field,
      label,
      state: stateFor(field, fact.value, student),
      required: fact.value,
      has: hasFor(field, student),
      sourceUrl: fact.sourceUrl,
    });
  }

  return {
    school: record.targetName,
    course: record.course,
    country: record.country ?? "",
    components,
    met: components.filter((c) => c.state === "MET").length,
    unmet: components.filter((c) => c.state === "UNMET").length,
    unknown: components.filter((c) => c.state === "UNKNOWN").length,
  };
}

/** What the student has for a given requirement field, for display. */
function hasFor(field: string, student: StudentAcademics): string | null {
  if (field === "gradeRequirement") {
    if (student.gpa == null) return null;
    return student.gpaScale
      ? `${student.gpa} (scale ${student.gpaScale})`
      : String(student.gpa);
  }
  if (field === "admissionsTest") {
    const tests = student.testScores
      .map((t) => `${t.label} ${t.score}${t.predicted ? " (predicted)" : ""}`)
      .join(", ");
    return tests || null;
  }
  if (field === "requiredSubjects") {
    return student.subjects.length > 0 ? student.subjects.join(", ") : null;
  }
  return null;
}

/**
 * The state of one component.
 *
 * Only two things are decided mechanically here, because only two can be: a
 * named admissions test the student has or has not recorded, and a required
 * subject they are or are not taking. Grade requirements are stated in a dozen
 * incompatible notations across countries ("A*AA", "IB 41 with 776", "3.9 UW",
 * "Abitur 1.3") and no honest arithmetic compares them to a single GPA field —
 * so they resolve to UNKNOWN and the model is told to say the comparison has
 * not been made rather than to make it.
 */
function stateFor(
  field: string,
  required: string,
  student: StudentAcademics,
): ThresholdState {
  const need = required.toLowerCase();

  if (field === "admissionsTest") {
    // "No admissions test" is a requirement that is met by definition.
    if (/\b(no|not required|none)\b/.test(need)) return "MET";
    const named = ["ucat", "bmat", "lnat", "esat", "tmua", "sat", "act", "mat", "pat"];
    const wanted = named.filter((t) => need.includes(t));
    if (wanted.length === 0) return "UNKNOWN";
    const held = student.testScores.map((t) =>
      `${t.kind} ${t.label}`.toLowerCase(),
    );
    return wanted.some((t) => held.some((h) => h.includes(t))) ? "MET" : "UNMET";
  }

  if (field === "requiredSubjects") {
    if (student.subjects.length === 0) return "UNKNOWN";
    const subjects = student.subjects.map((s) => s.toLowerCase());
    // Named subjects the source explicitly requires.
    const common = [
      "mathematics",
      "further mathematics",
      "chemistry",
      "biology",
      "physics",
      "english",
      "history",
    ];
    const wanted = common.filter((s) => need.includes(s));
    if (wanted.length === 0) return "UNKNOWN";
    const missing = wanted.filter(
      (w) => !subjects.some((s) => s.includes(w) || w.includes(s)),
    );
    if (missing.length === 0) return "MET";
    return missing.length < wanted.length ? "PARTIAL" : "UNMET";
  }

  // Everything else — grades in incomparable notations, interviews, language
  // certificates, application routes — is a fact to surface, not to adjudicate.
  return "UNKNOWN";
}

export function buildThresholdSnapshot(
  student: StudentAcademics,
  records: ResolvedRequirementLike[],
): ThresholdSnapshot {
  const schools = records.map((r) => compareToRequirements(student, r));
  return { schools, noDataForAnyTarget: schools.length === 0 };
}

/**
 * The headline band for a set of threshold components.
 *
 * A BAND, never a number: any scalar here would immediately be averaged with
 * differentiation by someone downstream, and the two are not commensurable.
 * Capped at "met" by construction — there is no state above it.
 */
export const THRESHOLD_BANDS = [
  "not checked",
  "gaps to close",
  "mostly met",
  "met",
] as const;
export type ThresholdBand = (typeof THRESHOLD_BANDS)[number];

export function thresholdBand(snapshot: ThresholdSnapshot): ThresholdBand {
  if (snapshot.noDataForAnyTarget) return "not checked";
  const unmet = snapshot.schools.reduce((n, s) => n + s.unmet, 0);
  const met = snapshot.schools.reduce((n, s) => n + s.met, 0);
  if (unmet === 0 && met > 0) return "met";
  if (unmet === 0) return "not checked";
  return met > unmet ? "mostly met" : "gaps to close";
}
