// What the dashboard says about a student, decided here rather than in JSX.
//
// Pure: no Prisma, no session. The interesting decisions are which gaps are
// worth nagging about and whether two scores can honestly be compared, and both
// deserve to be tested directly.
import { SCORE_LABELS, scoresRedefinedSince } from "@/lib/prompts/evaluation/versions";

/**
 * Something missing from the profile that measurably changes the evaluation.
 *
 * The bar for appearing here is deliberately high. This app's whole posture is
 * that a student should not be told to fix things they cannot act on, and a
 * dashboard that lists every empty field turns into a nag screen that gets
 * ignored — taking the one item that actually mattered with it.
 */
export type ProfileGap = {
  id: string;
  /** What is missing, in the student's words. */
  label: string;
  /** What it costs the evaluation. Never a scolding, always a consequence. */
  why: string;
  href: string;
  /**
   * True when the evaluation cannot meaningfully run at all without it, as
   * opposed to running with a known blind spot.
   */
  blocking: boolean;
};

export type GapInput = {
  gradeLevel: string | null;
  schoolContext: string | null;
  targets: { name: string; country: string; course: string | null }[];
  resumeItemCount: number;
};

/**
 * The gaps worth showing, most consequential first.
 *
 * Notably ABSENT: test scores. A Grade 9 student has not sat an SAT and will
 * not for two years, and prompting them for one is exactly the "fix something
 * you cannot touch" failure the rubrics' stage model exists to prevent. Same
 * for GPA on a curriculum that does not produce one. Emptiness is only a gap
 * when it is a gap for THIS student.
 */
export function findProfileGaps(input: GapInput): ProfileGap[] {
  const gaps: ProfileGap[] = [];

  if (input.targets.length === 0) {
    gaps.push({
      id: "no-targets",
      label: "No target universities yet",
      why: "An evaluation is scored against the schools you name, so without any there is nothing concrete to judge you against.",
      href: "/targets/new",
      blocking: true,
    });
  }

  if (input.resumeItemCount === 0) {
    gaps.push({
      id: "no-items",
      label: "Nothing on your resume yet",
      why: "Clubs, jobs, projects, volunteering — anything you do outside class. This is most of what an evaluation actually reads.",
      href: "/profile/items/new",
      blocking: true,
    });
  }

  if (!input.gradeLevel?.trim()) {
    gaps.push({
      id: "no-grade",
      label: "Grade level not set",
      why: "It decides what you are compared against. Without it your work gets judged against students years ahead of you.",
      href: "/profile",
      blocking: false,
    });
  }

  if (!input.schoolContext?.trim()) {
    gaps.push({
      id: "no-school-context",
      label: "No school context",
      why: "Which advanced courses your school offers, how it grades, whether it ranks. The same GPA means different things at different schools, and without this the evaluation has to say so rather than judge it.",
      href: "/profile",
      blocking: false,
    });
  }

  // Course-specific admissions make this materially worse outside the US, so
  // the wording says which targets are affected rather than making a general
  // complaint the student has to decode.
  const courseless = input.targets.filter((t) => !t.course?.trim());
  if (courseless.length > 0) {
    const names = courseless.slice(0, 3).map((t) => t.name).join(", ");
    const more = courseless.length > 3 ? ` and ${courseless.length - 3} more` : "";
    gaps.push({
      id: "targets-without-course",
      label: `${courseless.length} target${courseless.length === 1 ? "" : "s"} without a course`,
      why: `${names}${more}. Entry requirements are published per course, so naming one lets the evaluation use the real published requirements instead of guessing.`,
      href: "/targets",
      blocking: false,
    });
  }

  return gaps;
}

export type ScoreMove =
  | { kind: "first" }
  | { kind: "rescaled"; label: string }
  | { kind: "moved"; delta: number; from: number; to: number }
  | { kind: "held"; at: number };

/**
 * How a score moved between two runs — or why that question has no answer.
 *
 * The `rescaled` case is the one that matters. Scores are anchored across runs
 * precisely so a number cannot drift without a reason, and a prompt version
 * that REDEFINES a score breaks that comparison: the old number measured
 * something else, so subtracting them produces a change that never happened to
 * the student. Showing "+8" there would be inventing a result, which is the one
 * thing this app must not do with its own numbers.
 */
export function scoreMovement(
  latest: { score: number | null; promptVersion: string | null },
  previous: { score: number | null; promptVersion: string | null } | null,
  scoreKey: "overallScore" | "gradeRelativeScore" = "overallScore",
): ScoreMove {
  if (!previous || previous.score == null || latest.score == null) {
    return { kind: "first" };
  }

  if (scoresRedefinedSince(previous.promptVersion).includes(scoreKey)) {
    return { kind: "rescaled", label: SCORE_LABELS[scoreKey] };
  }

  const delta = latest.score - previous.score;
  // A point either way is noise on a 0-100 judgement, and dressing it up as
  // movement invites a student to read progress into rounding.
  if (Math.abs(delta) <= 1) return { kind: "held", at: latest.score };
  return { kind: "moved", delta, from: previous.score, to: latest.score };
}

/** How the movement should read on screen. */
export function describeMovement(move: ScoreMove): string {
  switch (move.kind) {
    case "first":
      return "Your first evaluation — this is the baseline everything later is measured against.";
    case "rescaled":
      return `How ${move.label} is defined changed since your last evaluation, so the two numbers measure different things and are not comparable.`;
    case "held":
      return "About the same as last time.";
    case "moved":
      return move.delta > 0
        ? `Up ${move.delta} from ${move.from} last time.`
        : `Down ${Math.abs(move.delta)} from ${move.from} last time.`;
  }
}

/**
 * Is the newest evaluation still describing the profile as it stands?
 *
 * An evaluation is a snapshot. Once the profile has moved on, the scores on
 * screen describe a student who no longer exists, and saying so is more useful
 * than quietly showing a stale number as if it were current.
 */
export function isEvaluationStale(
  evaluatedAt: Date | null,
  profileUpdatedAt: Date | null,
): boolean {
  if (!evaluatedAt || !profileUpdatedAt) return false;
  return profileUpdatedAt.getTime() > evaluatedAt.getTime();
}
