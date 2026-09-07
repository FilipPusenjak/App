// GET/POST /api/reminders — the check-in nudge, run by hand.
//
// SCHEDULER ONLY, and fails closed exactly as the retention sweep does: an
// unset CRON_SECRET means no request is the scheduler, rather than every
// request being it. There is no signed-in fallback, because this sends mail to
// other people and no path to it should exist that someone can reach by
// visiting a URL.
//
// It sends nothing at all on a deployment with no email provider configured,
// which is most of them and is the correct behaviour rather than a degraded
// one — see lib/email/config.ts.
//
// THIS ROUTE HAS NO CRON ENTRY OF ITS OWN, and that is deliberate rather than
// forgotten. Vercel's Hobby plan caps a project at two cron jobs and this one
// already spends both, so the nudge rides along on the daily job instead —
// see app/api/cron/daily/route.ts, which calls the same pass. Give it its own
// entry (and drop it from there) if the plan ever allows a third.
//
// So this route exists for running the pass BY HAND:
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     https://your-app/api/reminders
//
// WHO GETS MAILED is decided in lib/email/reminders.ts, which is pure and is
// the file to read (or argue with) rather than this one. The pass itself is
// lib/email/reminders-pass.ts.
import { NextResponse } from "next/server";
import { runReminderPass } from "@/lib/email/reminders-pass";

export const maxDuration = 300;

async function run() {
  return NextResponse.json(await runReminderPass());
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
