// Builds the immutable input snapshot for an evaluation.
//
// The snapshot is what gets sent to the model AND what gets stored on the
// Evaluation row. Storing it means a saved evaluation still makes sense months
// later, after the profile it described has been edited — the history view can
// show exactly what was assessed.
import { countryName } from "@/lib/data/countries";
import {
  CURRICULUM_LABELS,
  RESUME_ITEM_TYPE_LABELS,
  TEST_SCORE_KIND_LABELS,
  type Curriculum,
  type ResumeItemType,
  type TestScoreKind,
} from "@/lib/validation/enums";

export type EvaluationSnapshot = {
  capturedAt: string;
  student: {
    gradeLevel: string | null;
    curriculum: string | null;
    gpa: number | null;
    gpaScale: string | null;
    intendedMajor: string | null;
    careerGoal: string | null;
    countryOfOrigin: string | null;
  };
  testScores: {
    kind: string;
    label: string;
    score: string;
    maxScore: string | null;
    predicted: boolean;
  }[];
  resumeItems: {
    /** Short stable handle ("R1", "R2") the model uses to key its per-item
     *  assessments. Deliberately short: far harder for a model to mangle than
     *  a cuid, and the ordering is fixed by this snapshot. */
    ref: string;
    /** The real ResumeItem id, so a saved evaluation can still link to the
     *  live item when it still exists. */
    id: string;
    type: string;
    title: string;
    org: string | null;
    description: string | null;
    startDate: string | null;
    endDate: string | null;
    hoursPerWeek: number | null;
    evidenceNotes: string | null;
  }[];
  targets: {
    name: string;
    country: string;
    countryName: string;
    course: string | null;
    classification: string;
    priority: number | null;
    notes: string | null;
  }[];
};

type ProfileLike = {
  gradeLevel: string | null;
  curriculum: string | null;
  gpa: number | null;
  gpaScale: string | null;
  intendedMajor: string | null;
  careerGoal: string | null;
  testScores: {
    kind: string;
    label: string;
    score: string;
    maxScore: string | null;
    predicted: boolean;
  }[];
  resumeItems: {
    id: string;
    type: string;
    title: string;
    org: string | null;
    description: string | null;
    startDate: Date | null;
    endDate: Date | null;
    hoursPerWeek: number | null;
    evidenceNotes: string | null;
  }[];
  targetSchools: {
    name: string;
    country: string;
    course: string | null;
    classification: string;
    priority: number | null;
    notes: string | null;
  }[];
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const label = <T extends string>(
  map: Record<T, string>,
  value: string | null,
): string | null => (value ? (map[value as T] ?? value) : null);

export function buildSnapshot(
  profile: ProfileLike,
  countryOfOrigin: string | null,
): EvaluationSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    student: {
      gradeLevel: profile.gradeLevel,
      curriculum: label(CURRICULUM_LABELS, profile.curriculum as Curriculum),
      gpa: profile.gpa,
      gpaScale: profile.gpaScale,
      intendedMajor: profile.intendedMajor,
      careerGoal: profile.careerGoal,
      countryOfOrigin: countryOfOrigin ? countryName(countryOfOrigin) : null,
    },
    testScores: profile.testScores.map((s) => ({
      kind: label(TEST_SCORE_KIND_LABELS, s.kind as TestScoreKind) ?? s.kind,
      label: s.label,
      score: s.score,
      maxScore: s.maxScore,
      predicted: s.predicted,
    })),
    resumeItems: profile.resumeItems.map((i, index) => ({
      ref: `R${index + 1}`,
      id: i.id,
      type:
        label(RESUME_ITEM_TYPE_LABELS, i.type as ResumeItemType) ?? i.type,
      title: i.title,
      org: i.org,
      description: i.description,
      startDate: iso(i.startDate),
      endDate: iso(i.endDate),
      hoursPerWeek: i.hoursPerWeek,
      evidenceNotes: i.evidenceNotes,
    })),
    targets: profile.targetSchools.map((t) => ({
      name: t.name,
      country: t.country,
      countryName: countryName(t.country) || t.country,
      course: t.course,
      classification: t.classification,
      priority: t.priority,
      notes: t.notes,
    })),
  };
}
