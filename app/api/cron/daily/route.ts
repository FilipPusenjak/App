// GET/POST /api/cron/daily — the one scheduled job that runs every day.
//
// WHY TWO JOBS SHARE ONE SCHEDULE. Vercel's Hobby plan caps a project at two
// cron entries, and this project already spends both: counselor triage daily
// and the retention sweep weekly. The check-in nudge would have been a third,
// and the way you discover that cap is a FAILED DEPLOYMENT. So the nudge rides
// along here instead of getting a schedule of its own.
//
// That is a hosting constraint rather than a design, and it should be undone
// rather than built upon if the plan ever allows a third: give the nudge its
// own entry and drop it from this route. Nothing else depends on the two
// running together.
//
// EACH JOB IS ISOLATED FROM THE OTHER'S FAILURE, which is the whole risk of
// combining them. A triage query that throws must not mean nobody gets a
// reminder for a week, and a mail provider outage must not stop caseloads
// being recomputed. So both run, both report, and the response says what each
// one did. A failure is recorded in the response rather than thrown, because
// a 500 here tells the scheduler nothing about which half worked.
//
// SCHEDULER ONLY, failing closed exactly as the other two do: an unset
// CRON_SECRET means no request is the scheduler, rather than every request
// being it. Both jobs remain reachable on their own routes — /api/counselor/
// triage for a counselor recomputing their own caseload, /api/reminders for
// running the nudge by hand.
import { NextResponse } from "next/server";
import { runTriage } from "@/lib/counselor/triage/run";
import { runReminderPass } from "@/lib/email/reminders-pass";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  return Boolean(secret && secret.trim() && header === `Bearer ${secret}`);
}

/** Run one job without letting its failure reach the other. */
async function attempt<T>(
  name: string,
  job: () => Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    return { ok: true, result: await job() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    console.error(`Daily cron: ${name} failed:`, error);
    return { ok: false, error: message };
  }
}

async function run() {
  // Sequential, not parallel. Both touch the same database on a small
  // connection pool, and nothing here is urgent enough to be worth contending
  // for it — the whole job runs against a handful of accounts.
  const triage = await attempt("triage", () => runTriage());
  const reminders = await attempt("reminders", () => runReminderPass());

  return NextResponse.json({
    triage: triage.ok ? triage.result : { error: triage.error },
    reminders: reminders.ok ? reminders.result : { error: reminders.error },
  });
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
