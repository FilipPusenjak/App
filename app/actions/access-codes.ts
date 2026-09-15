"use server";

// Minting access codes from the browser, for the operator who used to need a
// terminal and a production DATABASE_URL for this.
//
// createAccessCode() itself is unchanged and still lives in lib/billing/codes.ts
// — scripts/make-access-code.ts and this action are two callers of the same
// function, not two implementations. What this file adds is the gate: only
// isOperator() may reach it, checked here rather than trusted from the client,
// the same rule as every other server action in this app.
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { isOperator } from "@/lib/counselor/economics";
import { createAccessCode } from "@/lib/billing/codes";
import { RUN_KINDS } from "@/lib/billing/quota";
import { GRANTABLE_PLAN_CODES } from "@/lib/billing/plans";

export type MintCodeResult = {
  ok?: boolean;
  error?: string;
  codes?: string[];
  /** Echoed back so the form knows whether to show run- or plan-shaped copy. */
  isPlanKind?: boolean;
  /** ISO, or null for a code that never expires. Rendered under the codes. */
  expiresAt?: string | null;
};

function positiveInt(raw: FormDataEntryValue | null, fallback: number): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Mint one or more codes. Operator-only — checked against the session, never
 * against anything the form submits, so there is no field a non-operator could
 * forge their way past.
 */
export async function mintAccessCodeAction(
  _prev: MintCodeResult,
  fd: FormData,
): Promise<MintCodeResult> {
  const user = await getCurrentUser();
  if (!isOperator(user?.email)) {
    // Same story as the page itself: do not confirm to a non-operator that
    // this exists or explain why it refused.
    return { error: "Not available." };
  }

  const kind = String(fd.get("kind") ?? "");
  const isPlanKind = (GRANTABLE_PLAN_CODES as readonly string[]).includes(kind);
  if (!(RUN_KINDS as readonly string[]).includes(kind) && !isPlanKind) {
    return { error: "Choose what the code grants." };
  }

  const count = positiveInt(fd.get("count"), 1);
  const uses = positiveInt(fd.get("uses"), 1);
  // A plan-kind code always grants one subscription period per redemption —
  // "how many runs" has no meaning for it, so the form's grants field is
  // ignored rather than trusted for this kind.
  const grants = isPlanKind ? 1 : positiveInt(fd.get("grants"), 1);
  if (count === null || uses === null || grants === null) {
    return { error: "Count, uses and grants must be positive numbers." };
  }
  if (count > 50) {
    return { error: "Mint at most 50 at a time." };
  }

  const expiry = readExpiry(fd);
  if ("error" in expiry) return { error: expiry.error };
  const expiresAt = expiry.at;

  const note = String(fd.get("note") ?? "").trim() || null;

  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const { code } = await createAccessCode({
      kind,
      grantsCount: grants,
      maxRedemptions: uses,
      expiresAt,
      note,
    });
    codes.push(code);
  }

  revalidatePath("/operations");
  return {
    ok: true,
    codes,
    isPlanKind,
    // Echoed back so the operator reads the date the code ACTUALLY carries
    // rather than the one they meant to type. "Expires 31 Oct" under a freshly
    // minted code is the only cheap check on a field that is otherwise
    // invisible until the day it bites somebody.
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

/**
 * When the codes expire: in N days, on a given date, or never.
 *
 * TWO FIELDS, ONE ANSWER, and both filled in is an error rather than a
 * precedence rule. "Days wins over date" is the sort of thing that is true in
 * the code and not in anybody's head, and the failure it produces — a code that
 * dies on a date nobody chose — surfaces weeks later in front of whoever was
 * handed it.
 */
function readExpiry(
  fd: FormData,
): { at: Date | null } | { error: string } {
  const daysRaw = String(fd.get("days") ?? "").trim();
  const onRaw = String(fd.get("expiresOn") ?? "").trim();

  if (daysRaw && onRaw) {
    return {
      error: "Set a number of days or a date, not both.",
    };
  }

  if (daysRaw) {
    const days = Number.parseInt(daysRaw, 10);
    if (!Number.isFinite(days) || days < 1) {
      return { error: "Days until expiry must be a positive number." };
    }
    return { at: new Date(Date.now() + days * 24 * 60 * 60 * 1000) };
  }

  if (!onRaw) return { at: null };

  // Strict, because a date input gives exactly this and anything else arrived
  // from somewhere that is not the form.
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(onRaw);
  if (!parts) return { error: "That is not a date the form can read." };
  const [, y, m, d] = parts.map(Number) as [number, number, number, number];

  // THE END OF THAT DAY WHERE THE OPERATOR IS, not where the server is.
  //
  // A date input carries no timezone, and a code minted from California for
  // "31 October" that died at 5pm on the 31st would be the one failure this
  // field can produce — during the event it was minted for. The browser sends
  // its own offset; UTC is the fallback when it did not, which is late rather
  // than early and so fails in the harmless direction.
  const offset = tzOffsetMinutes(fd.get("tzOffset"));
  const at = new Date(
    Date.UTC(y, m - 1, d, 23, 59, 59, 999) + offset * 60_000,
  );
  if (!Number.isFinite(at.getTime())) {
    return { error: "That is not a date the form can read." };
  }
  if (at.getTime() <= Date.now()) {
    return { error: "That date has already passed." };
  }
  return { at };
}

/**
 * The browser's timezone offset, in minutes behind UTC, as Date#getTimezoneOffset
 * reports it. Clamped because it arrives from a form field: the real range is
 * ±14 hours, and anything outside it is not a timezone.
 */
function tzOffsetMinutes(raw: FormDataEntryValue | null): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || Math.abs(n) > 840) return 0;
  return n;
}
