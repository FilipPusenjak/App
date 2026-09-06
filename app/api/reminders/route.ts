// GET/POST /api/reminders — the pass that sends check-in reminders.
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
// WHO GETS MAILED is decided in lib/email/reminders.ts, which is pure and is
// the file to read (or argue with) rather than this one. This route is the
// plumbing: load candidates, apply the rules, send, record.
import { NextResponse } from "next/server";
import { emailConfig } from "@/lib/email/config";
import { checkInNudgeEmail } from "@/lib/email/messages";
import { remindersToSend } from "@/lib/email/reminders";
import {
  markReminderSent,
  reminderCandidates,
  unsubscribeTokenFor,
} from "@/lib/email/reminders-store";
import { sendEmail } from "@/lib/email/send";

export const maxDuration = 300;

async function run() {
  const config = emailConfig();
  if (!config) {
    // Not an error. Reported plainly so a scheduled run on an unconfigured
    // deployment reads as "nothing to do" rather than as a silent failure.
    return NextResponse.json({ configured: false, sent: 0, skipped: 0 });
  }

  const due = remindersToSend(await reminderCandidates());

  let sent = 0;
  const failed: string[] = [];

  for (const { candidate, daysSince } of due) {
    // Minted BEFORE the send, so no reminder can go out without a working way
    // to stop the next one.
    const token = await unsubscribeTokenFor(candidate.userId);

    const result = await sendEmail(
      checkInNudgeEmail({
        to: candidate.email,
        name: candidate.name,
        daysSince,
        appUrl: config.appUrl,
        unsubscribeToken: token,
      }),
    );

    if (result.ok) {
      // Only now. A send that failed leaves the timestamp untouched and is
      // retried on the next pass; one that succeeded is never repeated inside
      // the cooling-off window. That ordering is what makes this job safe to
      // run twice or to die halfway through.
      await markReminderSent(candidate.userId);
      sent += 1;
    } else {
      failed.push(result.reason);
    }
  }

  return NextResponse.json({
    configured: true,
    considered: due.length,
    sent,
    failed: failed.length,
  });
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
