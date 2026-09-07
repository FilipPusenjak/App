// One pass of the check-in nudge: load candidates, apply the rules, send,
// record.
//
// Lifted out of app/api/reminders/route.ts so it has TWO callers. The Hobby
// plan allows two cron jobs and this project already had two, so the nudge
// does not get a schedule of its own — it rides along on the daily job (see
// app/api/cron/daily/route.ts). The route stays for running it by hand.
//
// Returns a summary rather than a Response, because one of its callers reports
// on two jobs at once and cannot hand back somebody else's.
import { emailConfig } from "@/lib/email/config";
import { checkInNudgeEmail } from "@/lib/email/messages";
import { remindersToSend } from "@/lib/email/reminders";
import {
  markReminderSent,
  reminderCandidates,
  unsubscribeTokenFor,
} from "@/lib/email/reminders-store";
import { sendEmail } from "@/lib/email/send";

export type ReminderPassResult =
  | { configured: false; sent: 0; considered: 0; failed: 0 }
  | { configured: true; considered: number; sent: number; failed: number };

/**
 * Safe to run every day, and that is how it is scheduled.
 *
 * Not because the job is careful about how often it is invoked, but because
 * the RULES are: a student is due only after REMIND_AFTER_DAYS of silence, and
 * cannot be reminded again inside REMIND_COOLDOWN_DAYS. Running daily rather
 * than weekly therefore does not mail anybody more often — it only means a
 * student who has gone quiet is noticed within a day instead of within a week.
 */
export async function runReminderPass(): Promise<ReminderPassResult> {
  const config = emailConfig();
  if (!config) {
    // Not an error. Reported plainly so a scheduled run on an unconfigured
    // deployment reads as "nothing to do" rather than as a silent failure.
    return { configured: false, sent: 0, considered: 0, failed: 0 };
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

  return {
    configured: true,
    considered: due.length,
    sent,
    failed: failed.length,
  };
}
