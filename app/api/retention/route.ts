// GET/POST /api/retention — the nightly pass that deletes expired prose.
//
// SCHEDULER ONLY. Unlike the triage route, there is no signed-in fallback: the
// work here destroys data, so there must be no path to it that a logged-in
// person can reach by visiting a URL. Fails closed exactly as triage does — an
// unset CRON_SECRET means no request is the scheduler, rather than every
// request being it.
//
// It also runs the chart-point backfill first, so the ordering that keeps four
// years of scores alive is enforced by the code rather than by whoever
// remembers to run a script. The sweep refuses to delete anything until the
// backfill reports nothing left to do.
import { NextResponse } from "next/server";
import { backfillChartPoints } from "@/lib/evaluation/backfill-chart-points";
import { sweepExpiredProse } from "@/lib/evaluation/retention-sweep";

export const maxDuration = 300;

async function run() {
  // Backfill FIRST, always. Cheap when there is nothing to do (one indexed
  // count), and the only thing standing between a narrative being deleted and
  // an evaluation vanishing off a student's chart.
  const backfill = await backfillChartPoints();
  const sweep = await sweepExpiredProse();
  return NextResponse.json({ backfill, sweep });
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  return Boolean(secret && secret.trim() && header === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  return run();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  return run();
}
