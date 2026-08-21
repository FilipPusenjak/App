// POST /api/counselor/triage — the nightly pass.
//
// Two callers, one body of work:
//
//   THE SCHEDULER, authenticated by a bearer secret. This is the normal path
//   and it recomputes every counselor's caseload.
//
//   A SIGNED-IN COUNSELOR, recomputing their own. Useful when a student has
//   just updated something and the counselor does not want to wait for
//   tonight, and safe to expose because runTriage calls no model — the entire
//   cost of a manual run is a bounded number of Postgres queries.
//
// The distinction is enforced by scope, not by trust: a counselor-authenticated
// request always passes its own account id, so it cannot recompute anybody
// else's caseload no matter what it sends.
import { NextResponse } from "next/server";
import { runTriage } from "@/lib/counselor/triage/run";
import { getCounselorAccount } from "@/lib/counselor/access";

export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  const isScheduler = Boolean(
    // Fails closed. An unset CRON_SECRET means no request is the scheduler,
    // rather than every request being it.
    secret && secret.trim() && header === `Bearer ${secret}`,
  );

  if (isScheduler) {
    const result = await runTriage();
    return NextResponse.json(result);
  }

  const account = await getCounselorAccount().catch(() => null);
  if (!account) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const result = await runTriage({ counselorAccountId: account.id });
  return NextResponse.json(result);
}

/**
 * Vercel Cron issues GET, so the same work is reachable that way — but ONLY for
 * the scheduler. A GET without the secret is not a way to trigger a caseload
 * recompute by visiting a URL.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !secret.trim() || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  return NextResponse.json(await runTriage());
}
