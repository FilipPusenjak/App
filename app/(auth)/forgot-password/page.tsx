import Link from "next/link";
import { canSendEmail } from "@/lib/email/config";
import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * What to do when you cannot get in.
 *
 * TWO VERSIONS, chosen by whether this deployment can actually send mail.
 *
 * With a provider configured, the form: type an address, get a link. Without
 * one, the manual instructions this page has always carried — ask whoever runs
 * the instance, they mint a link with scripts/reset-link.ts and send it over.
 *
 * The fallback is not a placeholder. Sending from a domain nobody has verified
 * gets the mail rejected or filed as spam, and a form that accepts an address
 * and silently sends nothing is worse than no form at all: it leaves somebody
 * refreshing an inbox instead of asking a person who could have helped them in
 * a minute. So the honest page is whichever one matches reality — see
 * lib/email/config.ts, which fails closed for the same reason.
 *
 * What NEITHER version does is say whether an address has an account. The old
 * page managed it by never taking an address at all; the form manages it by
 * answering identically whatever happened — see RESET_REQUESTED_MESSAGE. That
 * property is the one to preserve through any future edit here, because a form
 * that answers differently is a way to enumerate who uses this app, and who
 * uses this app is mostly minors.
 */
export default function ForgotPasswordPage() {
  const contact = process.env.PASSWORD_RESET_CONTACT?.trim();

  if (canSendEmail()) {
    return (
      <div>
        <h1 className="mb-1 text-xl font-semibold">Forgot your password?</h1>
        <p className="mb-4 text-sm text-zinc-500">
          Enter the address on your account and we&apos;ll send you a link to
          choose a new password.
        </p>
        <ForgotPasswordForm />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Forgot your password?</h1>
      <p className="mb-4 text-sm text-zinc-500">
        This is a private, invite-only instance, so password resets are handled
        by whoever runs it.
      </p>

      <ol className="mb-6 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
        <li>
          1. Ask them for a reset link
          {contact ? (
            <>
              {" "}
              at{" "}
              <a
                href={`mailto:${contact}`}
                className="font-medium text-zinc-900 underline dark:text-zinc-100"
              >
                {contact}
              </a>
            </>
          ) : null}
          , mentioning the email address on your account.
        </li>
        <li>2. They&apos;ll send you a one-time link.</li>
        <li>
          3. Open it and choose a new password. The link works once, and only
          for a short time — so use it when you get it.
        </li>
      </ol>

      <p className="text-sm text-zinc-500">
        <Link
          href="/login"
          className="font-medium text-zinc-900 underline dark:text-zinc-100"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
