import Link from "next/link";

/**
 * What to do when you cannot get in.
 *
 * This page explains a manual process instead of offering a "send me a link"
 * form, and that is a deliberate choice rather than an unfinished one.
 *
 * There is no email provider configured for this instance, and adding one is
 * not just a dependency: sending to an address the owner does not control
 * requires a verified sending domain, and without one the mail either fails or
 * lands in spam — which is worse than no button, because the person waits for
 * something that is never arriving.
 *
 * A form that silently does nothing would be the dishonest version of this
 * page. The instance is invite-only and its users know who runs it, so the
 * owner minting a link (scripts/reset-link.ts) and sending it over is a path
 * that actually works today.
 *
 * Note what this page does NOT do: it never takes an address and never says
 * whether one has an account. That is the property to preserve if a self-serve
 * form is added later — the response must be identical for a registered and an
 * unregistered address, or the form becomes a way to enumerate who is here.
 */
export default function ForgotPasswordPage() {
  const contact = process.env.PASSWORD_RESET_CONTACT?.trim();

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
