// How a triage signal's facts read on the counselor's screen.
//
// Pure, so it can be tested without the session and database that the rest of
// lib/counselor/caseload.ts needs.

/**
 * How a signal's basis reads to a professional in a hurry.
 *
 * Rendered beside every signal as INSPECTABLE rather than hidden behind a
 * disclosure, because the counselor has to vet what they are about to repeat.
 * Returns the raw pairs rather than prose: a counselor reading
 * `daysOverdue: 40` can check it against what they remember, where a sentence
 * saying "significantly overdue" gives them nothing to check.
 */
export function describeBasis(
  basis: Record<string, unknown>,
): { key: string; value: string }[] {
  const SKIP = new Set(["signal"]);
  return Object.entries(basis)
    .filter(([k, v]) => !SKIP.has(k) && v != null && v !== "")
    // Row ids are for the code that links a signal to its record. A counselor
    // cannot check "cmw2z2…" against anything they remember, so it is noise
    // on the one screen they read in a hurry.
    .filter(([k]) => !/Id$/.test(k))
    .map(([key, value]) => ({
      key: key
        .replace(/([A-Z])/g, " $1")
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase())
        .trim(),
      value: basisValue(value),
    }));
}

/**
 * A fact's value in the form a person checks it in.
 *
 * Still the raw fact — a date stays that date, a count stays that count — but
 * not in machine form: "2026-06-02T03:14:51.077Z" is the same fact as
 * "2 Jun 2026" and much harder to hold against a memory of when you last met.
 */
function basisValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(basisValue).join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    }
  }
  if (typeof value === "string" && /^[A-Z_]+$/.test(value)) {
    return value.toLowerCase().replace(/_/g, " ");
  }
  return String(value);
}
