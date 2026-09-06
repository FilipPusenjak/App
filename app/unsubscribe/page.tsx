import Link from "next/link";
import { unsubscribeByToken } from "@/lib/email/reminders-store";

/**
 * Stop the check-in reminders.
 *
 * DELIBERATELY OUTSIDE EVERY ROUTE GROUP, so it needs no session. Someone
 * unsubscribing has usually decided they are done with the app; requiring them
 * to remember a password and log in first is how an unsubscribe link becomes a
 * spam report instead.
 *
 * The token in the URL is the whole authorization, and it can do exactly one
 * thing — see the note on User.unsubscribeToken. Acting on GET is intentional:
 * mail clients follow these links directly, and a page that only offered a
 * confirm button would leave the click doing nothing for anybody whose client
 * strips forms.
 *
 * It always renders something calm. An unrecognised token gets an explanation
 * and a way to reach the settings page rather than an error, because the most
 * likely cause is a mangled or truncated URL from a mail client, not an
 * attack.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const done = token ? await unsubscribeByToken(token) : false;

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-2 text-xl font-semibold">
        {done ? "Unsubscribed" : "That link didn't work"}
      </h1>

      {done ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You won&apos;t get check-in reminders any more. Nothing else has
          changed — your account, your profile and your evaluations are all
          exactly as they were, and you can still run a check-in whenever you
          want to.
        </p>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          We couldn&apos;t match that unsubscribe link to an account. Mail
          programs sometimes cut long links in half — if you can, try opening it
          again from the original message. Otherwise you can turn reminders off
          in your settings.
        </p>
      )}

      <p className="mt-6 text-sm text-zinc-500">
        <Link
          href="/settings"
          className="font-medium text-zinc-900 underline dark:text-zinc-100"
        >
          Go to settings
        </Link>
      </p>
    </div>
  );
}
