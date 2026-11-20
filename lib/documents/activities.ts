// The deterministic half of the Common App list: which activities, in what
// suggested order, with what gaps, mapped onto which fields.
//
// THE MODEL NEVER SEES ANY OF THIS. Ordering, gap detection, field mapping and
// the reasons shown beside a suggestion are computed here from the profile, so
// they are reproducible, explainable and free. The model's only job — see
// compress.ts — is shortening a description to fit.
//
// NO ADMISSION FRAMING. A reason says what is true of the activity in profile
// terms ("highest rung, grades 9-12"), never what it will do for an
// application.
//
// Pure: no database, no session, no model.
import {
  computeRung,
  monthsBetween,
  RUNG_LABELS,
  RUNGS,
  type Rung,
} from "@/lib/readiness/rungs";
import {
  categorizeMajor,
  groupForMajor,
  type MajorGroup,
} from "@/lib/discovery/majors";
import {
  charCount,
  COMMON_APP_ACTIVITY_TYPES,
  gradeLabel,
  TIMING_LABELS,
  TIMINGS,
  type CommonAppLimits,
  type Timing,
} from "./limits";

/** A resume item as the builder reads it. Built from the row by toActivitySource. */
export type ActivitySource = {
  id: string;
  /** The profile's own item type: extracurricular, leadership, award, ... */
  itemType: string;
  title: string;
  org: string | null;
  positionTitle: string | null;
  commonAppType: string | null;
  gradeLevels: number[];
  timing: string | null;
  hoursPerWeek: number | null;
  weeksPerYear: number | null;
  facts: string[];
  description: string | null;
  evidenceNotes: string | null;
  startDate: string | null;
  endDate: string | null;
  startGrade: number | null;
  endGrade: number | null;
  rung: Rung;
};

type ResumeItemLike = {
  id: string;
  type: string;
  title: string;
  org: string | null;
  positionTitle?: string | null;
  commonAppType?: string | null;
  gradeLevels?: number[] | null;
  timing?: string | null;
  hoursPerWeek: number | null;
  weeksPerYear?: number | null;
  facts?: string[] | null;
  description: string | null;
  evidenceNotes: string | null;
  startDate: Date | null;
  endDate: Date | null;
  startGrade?: number | null;
  endGrade?: number | null;
  rungLevel?: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toActivitySource(item: ResumeItemLike, now: Date = new Date()): ActivitySource {
  // The student's own rung when they set one; otherwise the same computation
  // the rest of the app uses, from the item's dates, hours and wording.
  const stored = (RUNGS as readonly string[]).includes(item.rungLevel ?? "")
    ? (item.rungLevel as Rung)
    : null;
  const rung =
    stored ??
    computeRung({
      months: monthsBetween(item.startDate, item.endDate, now),
      hoursPerWeek: item.hoursPerWeek,
      type: item.type,
      description: item.description,
      evidenceNotes: item.evidenceNotes,
    });

  return {
    id: item.id,
    itemType: item.type,
    title: item.title,
    org: item.org,
    positionTitle: item.positionTitle ?? null,
    commonAppType: item.commonAppType ?? null,
    gradeLevels: [...(item.gradeLevels ?? [])].sort((a, b) => a - b),
    timing: item.timing ?? null,
    hoursPerWeek: item.hoursPerWeek,
    weeksPerYear: item.weeksPerYear ?? null,
    facts: (item.facts ?? []).filter((f) => f.trim() !== ""),
    description: item.description,
    evidenceNotes: item.evidenceNotes,
    startDate: iso(item.startDate),
    endDate: iso(item.endDate),
    startGrade: item.startGrade ?? null,
    endGrade: item.endGrade ?? null,
    rung,
  };
}

/**
 * Which items belong in the Activities list at all. Coursework is the
 * transcript's job, and awards go to Honors.
 */
export function isListActivity(source: Pick<ActivitySource, "itemType">): boolean {
  return source.itemType !== "coursework" && source.itemType !== "award";
}

// ─── Gaps ─────────────────────────────────────────────────────────────────────

export type GapField =
  | "commonAppType"
  | "hoursPerWeek"
  | "weeksPerYear"
  | "gradeLevels"
  | "timing"
  | "facts";

export type Gap = { field: GapField; question: string };

/**
 * What the Common App asks that this activity does not yet answer.
 *
 * Asked as a specific question about THIS activity, answered in place, and
 * written back to the profile. Never filled in by anything else — a guess at
 * someone's hours is still a guess, and it would be on their application.
 */
export function detectGaps(source: ActivitySource): Gap[] {
  const name = source.title;
  const gaps: Gap[] = [];
  if (!source.commonAppType || !(COMMON_APP_ACTIVITY_TYPES as readonly string[]).includes(source.commonAppType)) {
    gaps.push({
      field: "commonAppType",
      question: `Which Common App activity type fits ${name} best?`,
    });
  }
  if (source.gradeLevels.length === 0) {
    gaps.push({ field: "gradeLevels", question: `Which grades did you do ${name} in?` });
  }
  if (!source.timing || !(TIMINGS as readonly string[]).includes(source.timing)) {
    gaps.push({
      field: "timing",
      question: `When does ${name} happen — during the school year, during breaks, or all year?`,
    });
  }
  if (source.hoursPerWeek == null) {
    gaps.push({
      field: "hoursPerWeek",
      question: `About how many hours a week do you spend on ${name}?`,
    });
  }
  if (source.weeksPerYear == null) {
    gaps.push({
      field: "weeksPerYear",
      question: `How many weeks a year did you do ${name}?`,
    });
  }
  if (source.facts.length === 0) {
    gaps.push({
      field: "facts",
      question: `What's one concrete thing that came out of ${name} — a result, a number, something you made or presented?`,
    });
  }
  return gaps;
}

/**
 * Whether there is anything to describe at all. With no facts, no description
 * and no evidence, a "description" could only restate the title — or invent.
 */
export function hasDescribableContent(source: ActivitySource): boolean {
  return (
    source.facts.length > 0 ||
    Boolean(source.description?.trim()) ||
    Boolean(source.evidenceNotes?.trim())
  );
}

// ─── Suggested selection and order ────────────────────────────────────────────

/**
 * Which major group an activity type plausibly belongs to. Coarse on purpose:
 * it only decides one small bonus, and only when both sides are known.
 */
const TYPE_GROUP: Partial<Record<string, MajorGroup>> = {
  "Computer/Technology": "stem",
  Robotics: "stem",
  "Science/Math": "stem",
  Research: "stem",
  Environmental: "stem",
  Art: "creative",
  Dance: "creative",
  "Music: Instrumental": "creative",
  "Music: Vocal": "creative",
  "Theater/Drama": "creative",
  "Debate/Speech": "social_science",
  "Student Govt./Politics": "social_science",
  "Social Justice": "social_science",
  "Journalism/Publication": "humanities",
  "Foreign Language": "humanities",
  Cultural: "humanities",
  "Work (Paid)": "business",
  "Career Oriented": "business",
};

export type ScoreParts = {
  rung: number;
  span: number;
  hours: number;
  coherence: number;
};

export type ActivityScore = { score: number; parts: ScoreParts; reason: string };

/** Grades the activity spans: recorded grades, else its grade range, else its dates. */
export function gradeSpan(source: ActivitySource, now: Date = new Date()): number {
  if (source.gradeLevels.length > 0) return source.gradeLevels.length;
  if (source.startGrade != null) {
    return Math.max(1, (source.endGrade ?? source.startGrade) - source.startGrade + 1);
  }
  const months = monthsBetween(
    source.startDate ? new Date(source.startDate) : null,
    source.endDate ? new Date(source.endDate) : null,
    now,
  );
  return months == null ? 0 : Math.max(1, Math.ceil(months / 12));
}

export function annualHours(source: ActivitySource): number | null {
  if (source.hoursPerWeek == null || source.weeksPerYear == null) return null;
  return Math.round(source.hoursPerWeek * source.weeksPerYear);
}

export function scoreActivity(
  source: ActivitySource,
  ctx: { majorGroup: MajorGroup | null; now?: Date },
): ActivityScore {
  const rungIdx = Math.max(0, RUNGS.indexOf(source.rung));
  const span = gradeSpan(source, ctx.now);
  const hours = annualHours(source);
  const group = source.commonAppType ? TYPE_GROUP[source.commonAppType] : undefined;
  const coherent = Boolean(ctx.majorGroup && group && group === ctx.majorGroup);

  const parts: ScoreParts = {
    rung: rungIdx * 3,
    span: Math.min(span, 4) * 2.5,
    hours: hours == null ? 0 : Math.min(hours / 100, 6),
    coherence: coherent ? 4 : 0,
  };
  const score = parts.rung + parts.span + parts.hours + parts.coherence;

  const said: string[] = [];
  if (rungIdx > 0) said.push(`rung: ${RUNG_LABELS[source.rung].toLowerCase()}`);
  if (source.gradeLevels.length > 0) {
    const g = source.gradeLevels;
    said.push(
      g.length === 1
        ? `grade ${gradeLabel(g[0]!)}`
        : `grades ${gradeLabel(g[0]!)}–${gradeLabel(g[g.length - 1]!)}`,
    );
  } else if (span > 0) {
    said.push(span === 1 ? "about a year" : `about ${span} years`);
  }
  if (hours != null) said.push(`about ${hours.toLocaleString("en-US")} hours a year`);
  if (coherent) said.push("same area as your intended major");

  return { score, parts, reason: said.length > 0 ? said.join(" · ") : "few details recorded yet" };
}

export type SelectionSuggestion = {
  /** Suggested activities, in suggested order. */
  order: string[];
  /** One line per activity, in profile terms. Covers selected and not selected. */
  reasons: Record<string, string>;
  /** Activities left out because the list is full, lowest score last. */
  notSelected: string[];
};

/**
 * A suggested selection and order. Only ever a suggestion: the student
 * confirms or changes it, and nothing applies it on their behalf afterwards.
 *
 * Ties break on title, then id, so the same profile always suggests the same
 * order.
 */
export function suggestSelection(
  sources: ActivitySource[],
  ctx: { maxActivities: number; intendedMajor: string | null; now?: Date },
): SelectionSuggestion {
  const majorGroup = groupForMajor(categorizeMajor(ctx.intendedMajor ?? ""));
  const scored = sources
    .filter(isListActivity)
    .map((s) => ({ s, ...scoreActivity(s, { majorGroup, now: ctx.now }) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.s.title.localeCompare(b.s.title) ||
        a.s.id.localeCompare(b.s.id),
    );
  const reasons: Record<string, string> = {};
  for (const x of scored) reasons[x.s.id] = x.reason;
  return {
    order: scored.slice(0, ctx.maxActivities).map((x) => x.s.id),
    reasons,
    notSelected: scored.slice(ctx.maxActivities).map((x) => x.s.id),
  };
}

// ─── Field mapping ────────────────────────────────────────────────────────────

export type MappedField = { value: string; limit: number; overLimit: boolean };

export type MappedEntry = {
  type: string;
  position: MappedField;
  organization: MappedField;
  grades: string;
  timing: string;
  hoursPerWeek: string;
  weeksPerYear: string;
};

function field(value: string, limit: number): MappedField {
  return { value, limit, overLimit: charCount(value) > limit };
}

/**
 * The fields code fills directly. Position is the student's own title or
 * nothing: an empty position is a valid answer, an invented "Member" is not.
 * A value over its limit is flagged for the student, never cut.
 */
export function mapEntryFields(source: ActivitySource, limits: CommonAppLimits): MappedEntry {
  return {
    type: source.commonAppType ?? "",
    position: field(source.positionTitle?.trim() ?? "", limits.position),
    organization: field(source.org?.trim() ?? "", limits.organization),
    grades: source.gradeLevels.map(gradeLabel).join(", "),
    timing:
      source.timing && (TIMINGS as readonly string[]).includes(source.timing)
        ? TIMING_LABELS[source.timing as Timing]
        : "",
    hoursPerWeek: source.hoursPerWeek == null ? "" : String(Math.round(source.hoursPerWeek)),
    weeksPerYear: source.weeksPerYear == null ? "" : String(source.weeksPerYear),
  };
}

// ─── What the student entered, as one text ────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function dateWords(isoDate: string | null): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Everything a generated description is allowed to draw on, as plain text.
 *
 * This is the fidelity check's notion of "the source": what the student typed
 * and the structured values they chose. The computed rung is deliberately NOT
 * in it — it is the app's reading of the activity, not something the student
 * said, so a description cannot cite it as fact.
 */
export function fidelitySourceText(source: ActivitySource): string {
  return [
    source.title,
    source.itemType,
    source.org ?? "",
    source.positionTitle ?? "",
    source.commonAppType ?? "",
    source.description ?? "",
    source.evidenceNotes ?? "",
    ...source.facts,
    source.hoursPerWeek == null ? "" : `${source.hoursPerWeek} hours per week`,
    source.weeksPerYear == null ? "" : `${source.weeksPerYear} weeks per year`,
    source.gradeLevels.length ? `grades ${source.gradeLevels.join(", ")}` : "",
    source.timing && (TIMINGS as readonly string[]).includes(source.timing)
      ? TIMING_LABELS[source.timing as Timing]
      : "",
    dateWords(source.startDate),
    dateWords(source.endDate),
  ]
    .filter(Boolean)
    .join("\n");
}
