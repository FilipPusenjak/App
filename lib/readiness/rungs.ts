// How far up an activity a student has actually climbed.
//
// Admissions reading is not "did you do a thing" but "how far did you take it",
// and a profile is worth more for depth in a few places than presence in many.
// Rungs make that explicit and, crucially, COMPUTABLE — so the model is handed
// a position on a ladder rather than asked to judge one.
//
// The ladder is deliberately generic across activity types. A subject-specific
// ladder per category would be more precise and would also be a large body of
// judgement calls masquerading as data; this is coarse, defensible, and the
// same for everyone.
//
// Pure: no database, no model.

/**
 * The ladder, lowest first. Order IS the ranking — `RUNGS.indexOf` is the
 * score, so nothing may be inserted in the middle without moving every stored
 * comparison with it.
 */
export const RUNGS = [
  "none",
  "participant",
  "sustained",
  "contributor",
  "leader",
  "builder",
  "recognized",
] as const;

export type Rung = (typeof RUNGS)[number];

/** What each rung means, in the words used to explain it to a student. */
export const RUNG_LABELS: Record<Rung, string> = {
  none: "Not started",
  participant: "Taking part",
  sustained: "Kept it up",
  contributor: "Doing real work in it",
  leader: "Running part of it",
  builder: "Made something that outlasts you",
  recognized: "Recognized beyond your school",
};

export function rungIndex(rung: Rung): number {
  return RUNGS.indexOf(rung);
}

/** Is `a` further up than `b`? */
export function isHigherRung(a: Rung, b: Rung): boolean {
  return rungIndex(a) > rungIndex(b);
}

/** The next rung up, or null at the top. */
export function nextRung(rung: Rung): Rung | null {
  const index = rungIndex(rung);
  return index >= 0 && index < RUNGS.length - 1 ? RUNGS[index + 1]! : null;
}

export type RungInput = {
  /** Months between start and end (or now), from the item's dates. */
  months: number | null;
  hoursPerWeek: number | null;
  /** The item's own type, e.g. "leadership", "award", "research". */
  type: string;
  /** Free text the student wrote. Read only for explicit, unambiguous markers. */
  description: string | null;
  evidenceNotes: string | null;
};

/**
 * Where an activity sits, from the structured fields.
 *
 * The one place this reads free text is for markers that are unambiguous in any
 * context — "founded", "national", "published". Inferring a leadership rung
 * from prose generally would be the model's job, and the whole point of this
 * layer is that the model is not asked to compute anything. When the text says
 * nothing definite, the rung comes from duration and item type alone, which
 * cannot be gamed by adjectives.
 */
export function computeRung(input: RungInput): Rung {
  const text = `${input.description ?? ""} ${input.evidenceNotes ?? ""}`.toLowerCase();
  const months = input.months ?? 0;

  // Recognition beyond the school is the only rung a duration cannot reach.
  if (/\b(national|international|published|patent)\b/.test(text)) return "recognized";
  if (input.type === "award" && /\b(state|regional|national)\b/.test(text)) {
    return "recognized";
  }

  if (/\b(founded|co-founded|started the|launched)\b/.test(text)) return "builder";

  if (
    /\b(president|captain|editor|chair|director|head of|led the)\b/.test(text) ||
    input.type === "leadership"
  ) {
    return "leader";
  }

  if (input.type === "research" || input.type === "work") {
    // A real placement is contributor-level by nature; length moves it up.
    return months >= 12 ? "leader" : "contributor";
  }

  if (months >= 24) return "contributor";
  if (months >= 9) return "sustained";
  if (months > 0 || (input.hoursPerWeek ?? 0) > 0) return "participant";
  return "none";
}

/** Whole months between two dates, or null when the span is unknowable. */
export function monthsBetween(
  start: Date | null,
  end: Date | null,
  now: Date = new Date(),
): number | null {
  if (!start) return null;
  const to = end ?? now;
  if (to.getTime() < start.getTime()) return null;
  let months =
    (to.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - start.getUTCMonth());
  if (to.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}
