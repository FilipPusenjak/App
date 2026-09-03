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

  const daysRaw = String(fd.get("days") ?? "").trim();
  let expiresAt: Date | null = null;
  if (daysRaw) {
    const days = Number.parseInt(daysRaw, 10);
    if (!Number.isFinite(days) || days < 1) {
      return { error: "Days until expiry must be a positive number." };
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

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
  return { ok: true, codes, isPlanKind };
}
