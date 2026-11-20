// The content of an application document, and the rules for changing it.
//
// Two rules live here because they are the ones a careless edit elsewhere
// would break, and they are easiest to guarantee — and test — as pure
// functions:
//
//   STUDENT EDITS ALWAYS WIN. A field key in editedFieldKeys is the student's.
//   Nothing generated is ever written to it again.
//
//   NEVER REORDER SILENTLY. Until the student confirms, the order shown is the
//   suggestion and may follow the profile. Once confirmed, the order is theirs:
//   it changes only when they change it. An activity deleted from the profile
//   drops out of it (it no longer exists to list); nothing is ever moved,
//   inserted or re-ranked on their behalf.
//
// Pure: no database.
import type { ActivitySource, SelectionSuggestion } from "./activities";
import type { EntryFlag } from "./compress";
import { charCount, type CommonAppLimits } from "./limits";

export type DocumentType = "COMMON_APP_ACTIVITIES" | "BRAG_SHEET" | "RESUME_PDF";

export type DescriptionStatus = "empty" | "generated" | "edited" | "flagged";

export type CommonAppEntryFields = {
  position: string;
  organization: string;
  description: string;
  descriptionStatus: DescriptionStatus;
  /** Hash of what the description was generated from, to spot a stale one. */
  descriptionSourceHash: string | null;
  flag: EntryFlag | null;
};

export type CommonAppFields = {
  kind: "COMMON_APP_ACTIVITIES";
  /** The list, in order: confirmed by the student, or the current suggestion. */
  order: string[];
  suggestion: SelectionSuggestion;
  entries: Record<string, CommonAppEntryFields>;
};

export type BragSheetStory = {
  /** Exactly what the student typed. Never altered by anything but them. */
  text: string;
  /** A grammar-only correction they asked for and have not yet accepted. */
  grammarSuggestion: string | null;
};

export type BragSheetFields = {
  kind: "BRAG_SHEET";
  templateId: string;
  /** Opt-in for grammar fixes. Off by default; stories stay verbatim. */
  grammarOptIn: boolean;
  stories: Record<string, BragSheetStory>;
};

export type ResumeFields = {
  kind: "RESUME_PDF";
  skills: string[];
  /** GPA is printed only when the student says so. */
  includeGpa: boolean;
};

export type DocumentFields = CommonAppFields | BragSheetFields | ResumeFields;

export const entryKey = (activityId: string, field: "description" | "position" | "organization") =>
  `${activityId}.${field}`;

export function emptyCommonAppFields(suggestion: SelectionSuggestion): CommonAppFields {
  return { kind: "COMMON_APP_ACTIVITIES", order: suggestion.order, suggestion, entries: {} };
}

/**
 * Bring a Common App draft up to date with the profile.
 *
 * Position and organization follow the profile unless the student edited them
 * here. The order follows the suggestion only until it is confirmed.
 */
export function reconcileCommonApp(input: {
  fields: CommonAppFields;
  activities: ActivitySource[];
  mapped: Record<string, { position: string; organization: string }>;
  suggestion: SelectionSuggestion;
  orderConfirmed: boolean;
  editedFieldKeys: string[];
}): CommonAppFields {
  const edited = new Set(input.editedFieldKeys);
  const exists = new Set(input.activities.map((a) => a.id));

  const order = input.orderConfirmed
    ? input.fields.order.filter((id) => exists.has(id))
    : input.suggestion.order;

  const entries: Record<string, CommonAppEntryFields> = {};
  for (const a of input.activities) {
    const prev = input.fields.entries[a.id];
    const mapped = input.mapped[a.id] ?? { position: "", organization: "" };
    entries[a.id] = {
      position: prev && edited.has(entryKey(a.id, "position")) ? prev.position : mapped.position,
      organization:
        prev && edited.has(entryKey(a.id, "organization")) ? prev.organization : mapped.organization,
      description: prev?.description ?? "",
      descriptionStatus: prev?.descriptionStatus ?? "empty",
      descriptionSourceHash: prev?.descriptionSourceHash ?? null,
      flag: prev?.flag ?? null,
    };
  }

  return { kind: "COMMON_APP_ACTIVITIES", order, suggestion: input.suggestion, entries };
}

/** A generated description for one entry, as compress.ts returns it. */
export type GeneratedDescription = {
  entryId: string;
  description: string;
  sourceHash: string;
  flag: EntryFlag | null;
};

/**
 * Write generated descriptions into the fields — except where the student has
 * edited the description. Returns the ids actually written, so a caller can
 * say which ones were left alone.
 */
export function applyGenerated(
  fields: CommonAppFields,
  editedFieldKeys: string[],
  generated: GeneratedDescription[],
): { fields: CommonAppFields; written: string[]; skipped: string[] } {
  const edited = new Set(editedFieldKeys);
  const entries = { ...fields.entries };
  const written: string[] = [];
  const skipped: string[] = [];
  for (const g of generated) {
    const current = entries[g.entryId];
    if (!current) continue;
    if (edited.has(entryKey(g.entryId, "description"))) {
      skipped.push(g.entryId);
      continue;
    }
    entries[g.entryId] = {
      ...current,
      description: g.description,
      descriptionStatus: g.flag ? "flagged" : g.description ? "generated" : "empty",
      descriptionSourceHash: g.sourceHash,
      flag: g.flag,
    };
    written.push(g.entryId);
  }
  return { fields: { ...fields, entries }, written, skipped };
}

/** The student editing one field: it becomes theirs from now on. */
export function applyEdit(
  fields: CommonAppFields,
  editedFieldKeys: string[],
  activityId: string,
  field: "description" | "position" | "organization",
  value: string,
): { fields: CommonAppFields; editedFieldKeys: string[] } {
  const current = fields.entries[activityId];
  if (!current) throw new Error("No such entry in this document.");
  const next: CommonAppEntryFields =
    field === "description"
      ? { ...current, description: value, descriptionStatus: "edited", flag: null }
      : { ...current, [field]: value };
  const key = entryKey(activityId, field);
  return {
    fields: { ...fields, entries: { ...fields.entries, [activityId]: next } },
    editedFieldKeys: editedFieldKeys.includes(key) ? editedFieldKeys : [...editedFieldKeys, key],
  };
}

/**
 * The student's own order. Validated, not adjusted: ids must be activities in
 * this document, without repeats, and within the cycle's maximum.
 */
export function validateOrder(
  order: string[],
  activityIds: string[],
  maxActivities: number,
): { ok: true } | { ok: false; message: string } {
  const known = new Set(activityIds);
  if (new Set(order).size !== order.length) return { ok: false, message: "An activity appears twice." };
  if (order.some((id) => !known.has(id))) return { ok: false, message: "That list includes something that isn't one of your activities." };
  if (order.length > maxActivities) {
    return { ok: false, message: `The Common App takes at most ${maxActivities} activities.` };
  }
  return { ok: true };
}

/** Why a Common App draft cannot be exported yet, or null when it can. */
export function commonAppExportProblems(
  fields: CommonAppFields,
  limits: CommonAppLimits,
  orderConfirmed: boolean,
): string[] {
  const problems: string[] = [];
  if (!orderConfirmed) problems.push("Confirm the list and its order first.");
  for (const id of fields.order) {
    const e = fields.entries[id];
    if (!e) continue;
    if (charCount(e.description) > limits.description) {
      problems.push(`A description is ${charCount(e.description)} characters; the limit is ${limits.description}.`);
    }
    if (charCount(e.position) > limits.position) {
      problems.push(`A position is ${charCount(e.position)} characters; the limit is ${limits.position}.`);
    }
    if (charCount(e.organization) > limits.organization) {
      problems.push(`An organization name is ${charCount(e.organization)} characters; the limit is ${limits.organization}.`);
    }
  }
  return problems;
}
